# FEATURE_SPECS.md
**Versão:** v0.1.0 | **Data:** 2026-04-05 | **Status:** DRAFT

> Especificação técnica de cada feature com endpoints, jobs e créditos.
> Baseado em 18+ features mapeadas via engenharia reversa do Submagic.

---

## Feature Map

| # | Feature | Sprint | Jobs Disparados | Créditos | Plano Mínimo |
|---|---------|--------|-----------------|----------|--------------|
| 1 | Upload de Vídeo | 1 | — | 0 | beta/free |
| 2 | Transcrição + Captions | 1 | transcription | 0 | beta/free |
| 3 | Editor de Captions | 1 | — | 0 | beta/free |
| 4 | Templates de Caption | 1 | — | 0 | beta/free |
| 5 | Export com Burn-in | 1 | export | 0 | beta/free |
| 6 | Remove Silence | 2 | silence_removal | 0 | beta/free |
| 7 | Remove Bad Takes | 2 | bad_takes | 0 | beta/free |
| 8 | Clean Audio | 2 | clean_audio | 0 | beta/free |
| 9 | B-Roll Automático | 2 | broll_generation | 3/item | pro |
| 10 | Magic Zooms | 2 | magic_zooms | 0 | pro |
| 11 | Hook Title | 2 | hook_title | 0 | pro |
| 12 | Música de Fundo | 2 | — (no export) | 0 | pro |
| 13 | Magic Clips | 2 | magic_clips | 5/proj | pro |
| 14 | User Media Library | 1 | — | 0 | beta/free |
| 15 | Auto-Publish | 3 | — (webhook) | 0 | business |
| 16 | Video Translator | 3 | — futuro | 5/proj | business |
| 17 | Eye Contact | 3 | — futuro | 3/proj | business |
| 18 | AI Avatars | 3 | — futuro | — | business |

---

## 1. Upload de Vídeo

**Descrição:** Usuário faz upload de arquivo MP4 ou MOV (até 2GB / 2h) diretamente para o storage.

**Endpoints:**
```
POST /api/upload/presign    → gera presigned URL para R2
POST /api/upload/complete   → finaliza multipart
POST /api/projects          → cria projeto e inicia pipeline
```

**Fluxo:**
1. Cliente extrai metadados via `MediaInfoModule.wasm` (codec, fps, resolução, duração)
2. Requisita presigned URL com metadados
3. Faz upload multipart direto para Cloudflare R2 (chunks de 10MB)
4. Reporta progresso em % via callback
5. Ao completar, cria projeto com `sourceKey` do R2

**Validações:**
- `fileSize` ≤ 2.147.483.648 bytes [CONFIRMADO]
- `contentType` ∈ `['video/mp4', 'video/quicktime']` [CONFIRMADO]
- `duration` ≤ 7200 segundos [CONFIRMADO]

**Estado UI:** Barra de progresso multipart com % real-time.

---

## 2. Transcrição + Captions

**Descrição:** Transcrição automática com word-level timestamps em 100+ idiomas. PT-BR com 98%+ accuracy.

**Endpoints:**
```
GET /api/projects/:id       → polling de status + words[]
```

**Jobs:** `transcription` (automático ao criar projeto)

**Output confirmado:**
```json
{
  "words": [
    { "id": "uuid", "text": "Escritório", "type": "word", "startTime": 0.0, "endTime": 0.84, "confidence": 0.97 },
    { "id": "uuid", "text": "", "type": "silence", "startTime": 0.84, "endTime": 1.10, "confidence": null }
  ],
  "transcriptionStatus": "COMPLETED",
  "language": "pt"
}
```

**Tempo estimado:** ~3s por minuto de vídeo (GPU A10G)

**Estado UI:** Spinner "Transcribing..." → evento Pusher `transcription.completed` → editor carrega

---

## 3. Editor de Captions

**Descrição:** Editor inline de legendas geradas — editar texto, split, merge, hide, delete captions.

**Endpoints:**
```
PUT /api/projects/:id       → { words: [{ id, text, isRemoved }] }
```

**Operações por caption:**
- ✏️ **Edit text** — Editar texto da palavra
- ✂️ **Split** — Dividir caption em 2
- 👁️ **Hide** — Esconder temporariamente (`isRemoved: true`)
- 🗑️ **Delete** — Remover permanentemente
- ↩️ **Undo** — Soft delete → restored (graças ao `isRemoved`)

**Preview:** Canvas 2D renderiza captions animadas em tempo real sobre o frame do vídeo.

**Grupamento de palavras:** 3 palavras por linha default (configurável por template).

---

## 4. Templates de Caption

**Descrição:** 20+ templates visuais com estilos pré-configurados. Aplicação em tempo real no preview.

**Endpoints:**
```
GET /api/templates          → lista todos os templates
PUT /api/projects/:id       → { templateName: "Karl" }
```

**Templates mapeados:**

| Template | Fonte | Cor | Destaque | Tier |
|----------|-------|-----|----------|------|
| **Karl** | Montserrat 900 | Branco | Laranja `#FF6B00` | Free |
| **Hormozi 2** | Oswald 700 | Amarelo | Branco box preto | Premium |
| **Matt** | — | — | — | Free |
| **Bob** | — | — | — | Free |
| **Molly** | — | — | — | Free |
| **Sara** | — | — | — | Premium |
| **Jack** | — | — | — | Free |
| **Doug** | BebasNeue | — | All caps | Free |
| **Dan** | — | Italic | — | Free |
| **Kendrick** | — | — | Verde | Free |
| **Devin** | — | — | — | Free |

**Customização:** Usuário pode ajustar cor, tamanho, posição e salvar como tema próprio.

---

## 5. Export com Burn-in

**Descrição:** Renderização final server-side com FFmpeg + libass. Gera MP4 com captions queimadas.

**Endpoints:**
```
POST /api/projects/:id/export   → dispara job de export
GET  /api/projects/:id          → polling de status/URLs
```

**Jobs:** `export` (enfileirado na `video-export` queue, GPU)

**Pipeline:** Ver [RENDERING_ENGINE.md](./RENDERING_ENGINE.md)

**Output:**
```json
{
  "downloadUrl": "https://app.[DOMINIO].com/download/signed-token",
  "directUrl": "https://dqu1p08d61fh.cloudfront.net/outputs/..."
}
```

**Evento Pusher:** `export.completed` → frontend exibe botão de download

---

## 6. Remove Silence

**Descrição:** Remove silêncios automaticamente em 3 velocidades. [CONFIRMADO via API]

**Endpoints:**
```
POST /api/projects          → { removeSilencePace: "fast" }
```

**Jobs:** `silence_removal`

**Thresholds confirmados:**
```
extra-fast → remove silêncios > 0.1s  [CONFIRMADO]
fast       → remove silêncios > 0.2s  [CONFIRMADO] ← default
natural    → remove silêncios > 0.6s  [CONFIRMADO]
```

**Implementação:** Words com `type: "silence"` e duração > threshold recebem `isRemoved: true`. No export, esses segmentos são cortados via FFmpeg `trim` + `concat`.

**Preview:** Timeline mostra visualmente os segmentos removidos (escurecidos).

---

## 7. Remove Bad Takes

**Descrição:** IA detecta e remove takes com baixa qualidade de fala automaticamente.

**Endpoints:**
```
POST /api/projects          → { removeBadTakes: true }
```

**Jobs:** `bad_takes`

**Pipeline:**
```
1. Whisper confidence < 0.6 → palavra marcada como bad
2. Sequências de 3+ palavras bad consecutivas → segmento removido
3. Silero VAD speech_probability < 0.4 → segmento removido
4. SNR baixo (noisereduce análise) → take marcado
```

**Tempo:** ~1-2min por vídeo [CONFIRMADO: documentação API Submagic]

---

## 8. Clean Audio

**Descrição:** Redução de ruído de fundo no áudio.

**Endpoints:**
```
POST /api/projects          → { cleanAudio: true }
```

**Jobs:** `clean_audio`

**Implementação:**
```python
import noisereduce as nr
# Usa primeiro 1s de áudio como amostra de ruído
# Aplica spectral gating para redução
```

**Output:** Áudio limpo substituído no pipeline FFmpeg final.

---

## 9. B-Roll Automático

**Descrição:** IA busca e insere vídeos B-roll do Pexels automaticamente em segmentos relevantes.

**Endpoints:**
```
POST /api/projects          → { magicBrolls: true, magicBrollsPercentage: 75 }
GET  /api/projects/:id      → projectItems[] com assetUrl
```

**Jobs:** `broll_generation`

**Créditos:** 3 por item de B-roll [CONFIRMADO]

**Pipeline:**
1. GPT-4o-mini gera query visual (3-5 palavras) por segmento de texto
2. Busca no Pexels API (free tier, 200 req/h) [CONFIRMADO]
3. Seleciona vídeo mais relevante
4. Salva em `project_items` com `layout` e `assetUrl`
5. No export: FFmpeg `overlay` filter com timing exato

**Layouts disponíveis:** `cover | contain | rounded | square | split-50-50 | split-35-65 | split-50-50-bordered | split-35-65-bordered | pip-top-right | pip-bottom-right` [CONFIRMADO]

**Limite:** 12 segundos por item de B-roll [CONFIRMADO]

**Cobertura:** Define % do vídeo coberta por B-roll (10%–100%)

---

## 10. Magic Zooms

**Descrição:** Auto-zoom suave em momentos de fala enfática.

**Endpoints:**
```
POST /api/projects          → { magicZooms: true }
```

**Jobs:** `magic_zooms`

**Implementação:** Detecta picos de energia de áudio + palavras com alta confidence → aplica `zoompan` FFmpeg com fator 1.2–1.5x nos timestamps marcados.

---

## 11. Hook Title

**Descrição:** GPT-4o-mini gera um título viral para o início do vídeo.

**Endpoints:**
```
POST /api/projects   → { hookTitle: true | { text, template, top, size } }
GET  /api/hook-title-templates  → lista de templates
```

**Jobs:** `hook_title`

**Modos:**
- `hookTitle: true` → IA gera baseado nos primeiros 30s de fala
- `hookTitle: { text: "Meu título" }` → texto fixo
- `hookTitle: { text: "...", template: "tiktok", top: 45, size: 32 }` → customizado

**Parâmetros:** `top` e `size` são 0–80 (valores percentuais) [CONFIRMADO]

**Output:** Drawtext overlay no vídeo final (via FFmpeg ou ASS separado)

---

## 12. Música de Fundo

**Descrição:** Upload de música e mix automático com o áudio do vídeo.

**Endpoints:**
```
POST /api/user-media/upload → upload da música
POST /api/projects → { music: { userMediaId, volume: 30, startFromTime: 0, fade: true } }
```

**Parâmetros:** [CONFIRMADO via API docs]
- `volume`: 0–100 (% do volume da música vs. voz)
- `startFromTime`: timestamp de início na música
- `fade`: fade in/out automático

**Implementação:** FFmpeg `amix` filter no export.

---

## 13. Magic Clips

**Descrição:** Corta automaticamente os melhores clipes de vídeos longos com score de viralidade.

**Endpoints:**
```
POST /api/projects/magic-clips          → por URL
POST /api/projects/magic-clips/upload   → por upload direto
GET  /api/projects/:id                  → clips[] com viralityScores
```

**Jobs:** `magic_clips`

**Parâmetros:** [CONFIRMADO]
- `minClipLength`: 15–300 segundos
- `maxClipLength`: 15–300 segundos
- `faceTracking`: boolean — centraliza no rosto detectado

**Virality Scores:** [CONFIRMADO via webhook docs Submagic]
```json
{
  "total": 87,
  "shareability": 90,
  "hook_strength": 82,
  "story_quality": 85,
  "emotional_impact": 91
}
```

**Pipeline:**
1. Transcrição completa do vídeo longo
2. Segmentação em janelas de `minClipLength`–`maxClipLength`
3. Score de viralidade por segmento (modelo fine-tuned ou heurística)
4. Ranqueamento e seleção dos N melhores clips
5. Export individual de cada clip

---

## 14. User Media Library

**Descrição:** Biblioteca pessoal de vídeos/imagens/músicas para uso em B-roll ou fundo.

**Endpoints:**
```
GET  /api/user-media                → lista mídia
POST /api/user-media                → adiciona por URL
POST /api/user-media/upload         → upload direto
DELETE /api/user-media/:id          → remove
```

**Tipos:** VIDEO | IMAGE | AUDIO [CONFIRMADO: enums do schema]

**Uso:** User media pode ser usada como:
- B-roll overlay em `project_items`
- Música de fundo em `project_music`

---

## 15. Auto-Publish (Sprint 3)

**Descrição:** Publica diretamente para TikTok, Instagram Reels e YouTube Shorts após export.

**Integrações planejadas:**
- TikTok Creator API
- Instagram Graph API
- YouTube Data API v3

**Plano mínimo:** business [DECISÃO PRÓPRIA]

---

## 16. Video Translator (Sprint 3)

**Descrição:** Traduz e re-dubla vídeos automaticamente (PT-BR ↔ EN ↔ ES).

**Pipeline planejado:**
1. Transcrição original
2. Tradução via GPT-4o
3. Text-to-speech (ElevenLabs ou OpenAI TTS)
4. Lip-sync (SadTalker ou Wav2Lip)
5. Export com áudio traduzido

**Créditos:** 5 por projeto [DECISÃO PRÓPRIA]

---

## 17. Eye Contact Correction (Sprint 3)

**Descrição:** Corrige direção do olhar para a câmera usando IA.

**Modelo planejado:** MediaPipe Face Landmarker + warping

**Créditos:** 3 por projeto [DECISÃO PRÓPRIA]

---

## 18. AI Avatars (Sprint 3)

**Descrição:** Gera apresentador virtual baseado em texto ou roteiro.

**Tecnologia planejada:** HeyGen API ou D-ID API

**Plano mínimo:** business [DECISÃO PRÓPRIA]

---

## Referências

- [CONFIRMADO] B-roll threshold 12s, 3 créditos/item — API Submagic
- [CONFIRMADO] Layouts B-roll × 10 — docs API Submagic
- [CONFIRMADO] Magic Clips: minClipLength/maxClipLength/faceTracking — API Submagic
- [CONFIRMADO] viralityScores: total/shareability/hook_strength/story_quality/emotional_impact — webhook Submagic
- [CONFIRMADO] hookTitle: top/size 0–80 — API Submagic
- [CONFIRMADO] music: volume/startFromTime/fade — API Submagic

> Ver: [API_SPECIFICATION.md](./API_SPECIFICATION.md) | [VIDEO_PIPELINE.md](./VIDEO_PIPELINE.md) | [CREDITS_SYSTEM.md](./CREDITS_SYSTEM.md)
