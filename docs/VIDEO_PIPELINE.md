# VIDEO_PIPELINE.md
**Versão:** v0.1.0 | **Data:** 2026-04-05 | **Status:** DRAFT

> Pipeline completo de processamento de vídeo em 4 fases.
> Baseado no pipeline confirmado via análise dinâmica do Submagic.

---

## Diagrama de Estado do Projeto

```
        ┌──────────┐
        │  CREATE  │
        └────┬─────┘
             │ POST /api/projects
             ▼
        ┌──────────┐
        │uploading │ ← Browser faz PUT direto para R2/S3
        └────┬─────┘
             │ upload concluído
             ▼
        ┌──────────┐
        │processing│ ← Job enfileirado, worker pegou
        └────┬─────┘
             │ extração de áudio
             ▼
        ┌────────────┐
        │transcribing│ ← Silero VAD + faster-whisper em execução
        └─────┬──────┘
              │ words[] salvo no banco
              ▼
        ┌─────────────┐
        │ready_to_edit│ ← Usuário pode editar captions
        └──────┬──────┘
               │ POST /api/projects/:id/export
               ▼
        ┌──────────┐
        │ exporting│ ← FFmpeg + libass renderizando
        └──────┬───┘
               │
      ┌────────┴────────┐
      ▼                 ▼
┌──────────┐       ┌────────┐
│completed │       │ failed │
└──────────┘       └───┬────┘
                       │ failure_reason salvo
                       │ Pusher event enviado
                       │ créditos devolvidos (se ai-broll)
```

---

## Fase 1 — Ingestão

**Objetivo:** Receber o arquivo de vídeo com segurança e eficiência, sem sobrecarregar o servidor.

### 1.1 Geração de Presigned URL

```
Cliente                     API Server                  Cloudflare R2
   │                            │                             │
   │ POST /api/upload/presign   │                             │
   │ { filename, contentType,   │                             │
   │   fileSize, duration,      │                             │
   │   width, height, fps }     │                             │
   │──────────────────────────►│                             │
   │                            │ Validar:                    │
   │                            │ - fileSize ≤ 2GB            │
   │                            │ - contentType ∈ {mp4,mov}  │
   │                            │ - duration ≤ 7200s          │
   │                            │                             │
   │                            │ Gerar multipart upload      │
   │                            │──────────────────────────►│
   │                            │◄── { uploadId, parts[] }───│
   │◄── { uploadId, key,        │                             │
   │      parts[] }             │                             │
```

### 1.2 Upload Multipart Direto

```bash
# O cliente faz PUT direto para R2 — sem passar pelo servidor
# Cada parte: 5MB–100MB (exceto última parte)

for part in parts:
  PUT https://{bucket}.r2.cloudflarestorage.com/{key}
    ?uploadId={id}&partNumber={n}
  Content-Type: application/octet-stream
  [binary chunk]
  → Response: ETag: "abc123"
```

### 1.3 Conclusão e Criação do Projeto

```javascript
// Cliente envia quando todas as partes foram enviadas
POST /api/upload/complete
{ uploadId, key, parts: [{ partNumber, etag }] }

// Seguido imediatamente por:
POST /api/projects
{
  sourceKey: "inputs/user-uuid/proj-uuid/original.mp4",
  language: "pt",
  templateName: "Karl",
  removeSilencePace: "fast",
  // ... outros parâmetros
}
```

**Status:** `uploading → processing`

**Job enfileirado:** `transcription` no BullMQ

**Tempo estimado:** 30s–3min (depending on file size and network)

---

## Fase 2 — Transcrição

**Objetivo:** Converter áudio em array estruturado de words com timestamps word-level.

> Ver detalhes completos em [TRANSCRIPTION_ENGINE.md](./TRANSCRIPTION_ENGINE.md)

### 2.1 Sequência do Worker

```python
# Worker Python na GPU (Modal.com A10G)

def run_transcription(project_id: str, s3_key: str):
    # 1. Download do vídeo do R2/S3
    local_video = download_from_s3(s3_key)

    # 2. Extração de áudio
    # [CONFIRMADO: FFmpeg extrai áudio antes da transcrição]
    local_audio = f"/tmp/{project_id}/audio.wav"
    run_ffmpeg([
        "-i", local_video,
        "-ac", "1",           # mono
        "-ar", "16000",       # 16kHz (Whisper requirement)
        "-vn",                # sem vídeo
        local_audio
    ])

    # 3. Silero VAD — detecta segmentos de fala
    vad_model = load_silero_vad()
    speech_timestamps = vad_model.get_speech_timestamps(
        local_audio,
        threshold=0.5,
        min_silence_duration_ms=100,
        speech_pad_ms=30
    )

    # 4. faster-whisper Large V3 Turbo
    model = WhisperModel("large-v3-turbo", device="cuda", compute_type="float16")
    segments, info = model.transcribe(
        local_audio,
        language="pt",                    # detectado ou explícito
        word_timestamps=True,             # [CONFIRMADO]
        vad_filter=True,                  # Silero VAD integrado
        detect_disfluencies=True,         # filler words
        compute_word_confidence=True,     # confiança por palavra
        condition_on_previous_text=False,
    )

    # 5. Construir words[] com silences
    words = build_words_with_silences(segments, speech_timestamps)

    # 6. Salvar no PostgreSQL
    save_words_to_db(project_id, words)

    # 7. Atualizar status e disparar Pusher
    update_project_status(project_id, "ready_to_edit")
    pusher.trigger(f"private-user-{user_id}", "transcription.completed", {
        "projectId": project_id,
        "wordCount": len(words),
        "language": info.language,
        "accuracy": info.language_probability * 100
    })
```

### 2.2 Output — Array words[]

```json
[
  { "id": "uuid", "text": "Escritório", "type": "word",        "startTime": 0.00, "endTime": 0.84, "confidence": 0.97, "isFiller": false, "position": 0 },
  { "id": "uuid", "text": "",           "type": "silence",     "startTime": 0.84, "endTime": 1.10, "confidence": null, "isFiller": false, "position": 1 },
  { "id": "uuid", "text": "não",        "type": "word",        "startTime": 1.10, "endTime": 1.24, "confidence": 0.98, "isFiller": false, "position": 2 },
  { "id": "uuid", "text": ",",          "type": "punctuation", "startTime": 1.24, "endTime": 1.24, "confidence": null, "isFiller": false, "position": 3 }
]
```

**Status:** `processing → transcribing → ready_to_edit`

**Estimativa de tempo:** ~3s por minuto de áudio na A10G

---

## Fase 3 — Processamento de AI Edits

**Objetivo:** Aplicar todas as operações de IA antes do export, baseado nos parâmetros do projeto.

> Esta fase é opcional e somente executada se os parâmetros correspondentes foram configurados.

### 3.1 Silence Removal

```python
# Identificar words do tipo silence acima do threshold
def compute_silence_cuts(words: list, pace: str) -> list:
    thresholds = {
        "extra_fast": 0.1,  # remove silêncios > 0.1s [CONFIRMADO]
        "fast":       0.2,  # remove silêncios > 0.2s [CONFIRMADO]
        "natural":    0.6   # remove silêncios > 0.6s [CONFIRMADO]
    }
    threshold = thresholds[pace]
    cuts = []
    for word in words:
        if word["type"] == "silence":
            duration = word["endTime"] - word["startTime"]
            if duration > threshold:
                cuts.append({
                    "start": word["startTime"],
                    "end": word["endTime"]
                })
                word["isRemoved"] = True  # soft delete
    return cuts
```

### 3.2 Bad Takes Removal

```python
# [CONFIRMADO: Whisper confidence < threshold + VAD speech_probability]
CONFIDENCE_THRESHOLD = 0.6

def mark_bad_takes(words: list) -> list:
    cuts = []
    # Identificar sequências de palavras com baixo confidence
    low_conf_seq = []
    for word in words:
        if word["type"] == "word" and word["confidence"] < CONFIDENCE_THRESHOLD:
            low_conf_seq.append(word)
        else:
            if len(low_conf_seq) >= 3:  # sequência de 3+ palavras ruins = take ruim
                cuts.append({
                    "start": low_conf_seq[0]["startTime"],
                    "end": low_conf_seq[-1]["endTime"],
                    "reason": "low_confidence"
                })
                for w in low_conf_seq:
                    w["isRemoved"] = True
            low_conf_seq = []
    return cuts
```

### 3.3 Clean Audio

```python
import noisereduce as nr
import soundfile as sf

def clean_audio(audio_path: str, output_path: str):
    data, rate = sf.read(audio_path)
    # Usar primeiro 1s como referência de ruído (silêncio inicial)
    noise_sample = data[:rate]
    reduced = nr.reduce_noise(y=data, y_noise=noise_sample, sr=rate)
    sf.write(output_path, reduced, rate)
```

### 3.4 B-Roll Generation

```python
# GPT-4o-mini gera query contextual → Pexels search → asset_url
# [CONFIRMADO: Pexels mencionado explicitamente no FAQ]
# [CONFIRMADO: 3 créditos por ai-broll item]

def generate_broll(project_id: str, percentage: int):
    words = get_project_words(project_id)
    segments = group_words_into_segments(words, segment_duration=15)

    broll_count = int(len(segments) * (percentage / 100))
    selected_segments = select_best_segments_for_broll(segments, broll_count)

    for segment in selected_segments:
        # GPT-4o-mini gera prompt visual baseado no texto
        prompt = openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": f"Generate a 3-5 word Pexels search query for this spoken text: '{segment['text']}'. Return only the search query, no explanation."
            }]
        ).choices[0].message.content

        # Buscar no Pexels
        pexels_result = search_pexels(query=prompt, per_page=5)
        asset_url = pexels_result["videos"][0]["video_files"][0]["link"]

        # Verificar duração ≤ 12s [CONFIRMADO]
        end_time = min(segment["startTime"] + 12, segment["endTime"])

        save_project_item(project_id, {
            "type": "ai_broll",
            "prompt": prompt,
            "assetUrl": asset_url,
            "startTime": segment["startTime"],
            "endTime": end_time,
            "layout": "cover",
            "creditsConsumed": 3
        })
```

### 3.5 Hook Title Generation

```python
def generate_hook_title(project_id: str, config):
    words = get_first_30_seconds_words(project_id)
    text_context = " ".join([w["text"] for w in words if w["type"] == "word"])

    generated_text = openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{
            "role": "user",
            "content": f"Create a viral hook title in PT-BR for this video content: '{text_context}'. Maximum 8 words. Make it compelling and curiosity-driven."
        }]
    ).choices[0].message.content if config is True else config.get("text")

    return {
        "text": generated_text,
        "template": config.get("template", "tiktok") if isinstance(config, dict) else "tiktok",
        "top": config.get("top", 45) if isinstance(config, dict) else 45,
        "size": config.get("size", 32) if isinstance(config, dict) else 32
    }
```

---

## Fase 4 — Export / Rendering

**Objetivo:** Renderizar o vídeo final com todos os elementos, fazer upload para S3 e entregar via CloudFront.

> Ver detalhes completos em [RENDERING_ENGINE.md](./RENDERING_ENGINE.md)

### 4.1 Sequência de Rendering

```python
def run_export(project_id: str):
    project = get_project_full(project_id)
    words = get_active_words(project_id)  # isRemoved = false
    items = get_project_items(project_id)

    # 1. Download do vídeo original
    local_input = download_from_s3(project["sourceKey"])

    # 2. Aplicar cuts de silêncio/bad takes no vídeo
    cuts = compute_final_cuts(words, project)
    trimmed = apply_cuts_ffmpeg(local_input, cuts)

    # 3. Gerar arquivo .ass
    theme = get_project_theme(project)
    ass_content = generate_ass_file(words, theme)
    ass_path = f"/tmp/{project_id}/captions.ass"
    write_file(ass_path, ass_content)

    # 4. Baixar assets de B-roll
    broll_paths = download_broll_assets(items)

    # 5. Baixar música (se configurado)
    music_path = download_music(project.get("music"))

    # 6. Montar e executar FFmpeg filter_complex
    output_path = f"/tmp/{project_id}/output.mp4"
    run_ffmpeg_render(
        input_path=trimmed,
        ass_path=ass_path,
        broll_paths=broll_paths,
        music_path=music_path,
        hook_title=project.get("hookTitle"),
        output_path=output_path,
        resolution="1080p"
    )

    # 7. Upload para AWS S3
    output_key = f"outputs/{project['userId']}/{project_id}/output.mp4"
    upload_to_s3(output_path, output_key)

    # 8. Gerar URLs
    direct_url = f"https://dqu1p08d61fh.cloudfront.net/{output_key}"
    download_url = generate_s3_signed_url(output_key, expires=86400)

    # 9. Atualizar projeto
    update_project(project_id, {
        "status": "completed",
        "outputKey": output_key,
        "directUrl": direct_url,
        "downloadUrl": download_url
    })

    # 10. Pusher + Webhook
    pusher.trigger(f"private-user-{project['userId']}", "export.completed", {
        "projectId": project_id,
        "downloadUrl": download_url,
        "directUrl": direct_url
    })

    if project.get("webhookUrl"):
        post_webhook(project["webhookUrl"], {
            "projectId": project_id,
            "status": "completed",
            "downloadUrl": download_url,
            "directUrl": direct_url,
            "timestamp": datetime.utcnow().isoformat()
        })
```

---

## Estimativas de Tempo e Custo

| Fase | Duração para 1min de vídeo | Custo |
|------|---------------------------|-------|
| Ingestão (upload) | Depende da rede do usuário | $0.001 (R2 storage) |
| Extração de áudio | ~5s | Incluso |
| Silero VAD | ~1s | ~$0.0001 |
| faster-whisper (GPU A10G) | ~3s | ~$0.004 |
| Silence/Bad Takes | ~1s | ~$0.001 |
| Clean Audio (noisereduce) | ~2s | ~$0.001 |
| B-roll generation (GPT-4o-mini) | ~5s | ~$0.001 |
| Hook Title (GPT-4o-mini) | ~2s | ~$0.0005 |
| generate_ass.py | < 1s | ~$0.000 |
| FFmpeg render (A10G) | ~18s | ~$0.02 |
| Upload output S3 | ~5s | ~$0.001 |
| **TOTAL** | **~40-60s** | **~$0.03–$0.09** |

---

## Error Handling

| Cenário | Tratamento |
|---------|-----------|
| Upload falha no R2 | Cliente retry automático (3x) |
| Whisper timeout (> 5min) | Job falha, status → `failed`, Pusher event |
| FFmpeg render falha | Retry 1x, depois `failed` + `failure_reason` |
| Pexels API indisponível | Skip B-roll, continuar sem |
| OpenAI timeout | Skip hookTitle/broll query, usar fallback |
| S3 upload falha | Retry 3x com exponential backoff |
| Sem créditos para B-roll | Retornar `INSUFFICIENT_CREDITS` (402) sem iniciar job |

---

## Referências

- [CONFIRMADO] `removeSilencePace` thresholds: `extra-fast: 0.1s / fast: 0.2s / natural: 0.6s` — docs API Submagic
- [CONFIRMADO] B-roll máximo 12s por item — docs API Submagic
- [CONFIRMADO] `directUrl` via CloudFront: `dqu1p08d61fh.cloudfront.net`
- [CONFIRMADO] Webhook payload: `{ projectId, status, downloadUrl, directUrl, timestamp }`
- [INFERIDO] Confidence threshold 0.6 para bad takes — baseado em Whisper docs e padrão da indústria

> Ver: [TRANSCRIPTION_ENGINE.md](./TRANSCRIPTION_ENGINE.md) | [RENDERING_ENGINE.md](./RENDERING_ENGINE.md) | [JOBS_SYSTEM.md](./JOBS_SYSTEM.md)
