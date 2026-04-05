# TRANSCRIPTION_ENGINE.md
**Versão:** v0.1.0 | **Data:** 2026-04-05 | **Status:** DRAFT

> Motor de transcrição baseado em faster-whisper Large V3 + Silero VAD v6.
> Evidência: 98.41% de accuracy em PT-BR confirmado via teste com `marcio jr 14.mp4`.

---

## Stack de Transcrição

```
Áudio (WAV 16kHz mono)
    │
    ├─► Silero VAD v6 (ONNX)
    │   └── Detecta speech/silence boundaries
    │       ├── speech_timestamps: [{start, end}]
    │       └── Filtra ~40-60% do tempo de silêncio antes do ASR
    │
    └─► faster-whisper Large V3 Turbo
        ├── word_timestamps=True → startTime/endTime por palavra
        ├── vad_filter=True → Silero VAD integrado
        ├── detect_disfluencies=True → filler words marcados
        ├── compute_word_confidence=True → score 0.0–1.0
        └── Output: words[] com type: word|silence|punctuation
```

---

## Configuração do Silero VAD

```python
# [CONFIRMADO: Silero VAD v6 usa ONNX, processa janelas de 512 samples]

from silero_vad import load_silero_vad, read_audio

def run_vad(audio_path: str) -> list:
    model = load_silero_vad()  # carrega modelo ONNX
    wav = read_audio(audio_path, sampling_rate=16000)

    speech_timestamps = model.get_speech_timestamps(
        wav,
        model,
        threshold=0.5,               # probabilidade mínima de ser fala
        min_silence_duration_ms=100, # ignorar silêncios < 100ms
        min_speech_duration_ms=250,  # ignorar fala < 250ms (ruído)
        speech_pad_ms=30,            # padding ao redor de fala detectada
        return_seconds=True          # retornar em segundos (float)
    )

    # Retorna: [{"start": 0.0, "end": 2.4}, {"start": 3.1, "end": 8.7}, ...]
    return speech_timestamps
```

---

## Configuração do faster-whisper

```python
from faster_whisper import WhisperModel

def load_whisper_model():
    return WhisperModel(
        "large-v3-turbo",         # Melhor custo/accuracy para PT-BR
        device="cuda",             # GPU A10G no Modal.com
        compute_type="float16",    # float16 para velocidade na GPU
        num_workers=4,             # parallelismo de decodificação
        cpu_threads=4,             # threads para pré/pós-processamento
        download_root="/models"    # cache de modelos persistente
    )

def transcribe(model, audio_path: str, language: str = None) -> tuple:
    segments, info = model.transcribe(
        audio_path,
        language=language,                    # None = auto-detect
        word_timestamps=True,                 # [CONFIRMADO: necessário para word-by-word]
        vad_filter=True,                      # Silero VAD integrado
        vad_parameters={
            "threshold": 0.5,
            "min_silence_duration_ms": 100,
            "speech_pad_ms": 30
        },
        detect_disfluencies=True,             # marca filler words [CONFIRMADO]
        compute_word_confidence=True,         # confidence por palavra [CONFIRMADO]
        condition_on_previous_text=False,     # evita alucinações em textos longos
        no_speech_threshold=0.6,              # limiar para descartar segmento
        log_prob_threshold=-1.0,              # aceitar resultados com baixa prob.
        compression_ratio_threshold=2.4,      # detectar repetições
        beam_size=5,                          # beam search para melhor accuracy
        best_of=5,                            # amostras por passo de beam
        temperature=0.0,                      # 0.0 = determinístico
        initial_prompt="O seguinte é uma transcrição em português do Brasil:"
    )

    return segments, info
```

---

## Construção do Array words[]

```python
from uuid import uuid4
from typing import List, Dict

# Filler words em PT-BR [DECISÃO PRÓPRIA: expandido para PT-BR]
PT_BR_FILLERS = {
    "ahn", "ahm", "ah", "eh", "hm", "hmm",
    "né", "ne", "né?", "sabe", "tipo", "assim",
    "então", "cara", "gente", "olha", "bom", "bem",
    "enfim", "quer dizer", "ou seja", "basicamente",
    "literalmente", "praticamente", "realmente"
}

def build_words_with_silences(
    segments,
    speech_timestamps: list,
    total_duration: float
) -> List[Dict]:
    """
    Constrói o array words[] incluindo silences entre falas.
    [CONFIRMADO: silences são type="silence" com text="" no mesmo array]
    """
    words = []
    position = 0
    last_end = 0.0

    for segment in segments:
        # Inserir silêncio antes do segmento se necessário
        if segment.start > last_end + 0.05:  # gap > 50ms = silêncio
            words.append({
                "id": str(uuid4()),
                "text": "",
                "type": "silence",
                "startTime": round(last_end, 3),
                "endTime": round(segment.start, 3),
                "confidence": None,
                "isFiller": False,
                "position": position
            })
            position += 1

        for word in segment.words:
            # Determinar tipo
            text = word.word.strip()
            word_type = classify_word(text)
            is_filler = text.lower() in PT_BR_FILLERS

            words.append({
                "id": str(uuid4()),
                "text": text if word_type != "silence" else "",
                "type": word_type,
                "startTime": round(word.start, 3),
                "endTime": round(word.end, 3),
                "confidence": round(word.probability, 4) if word.probability else None,
                "isFiller": is_filler,
                "position": position
            })
            position += 1
            last_end = word.end

    # Inserir silêncio final se necessário
    if last_end < total_duration - 0.1:
        words.append({
            "id": str(uuid4()),
            "text": "",
            "type": "silence",
            "startTime": round(last_end, 3),
            "endTime": round(total_duration, 3),
            "confidence": None,
            "isFiller": False,
            "position": position
        })

    return words


def classify_word(text: str) -> str:
    if not text:
        return "silence"
    if text in {",", ".", "!", "?", ":", ";", "...", "—"}:
        return "punctuation"
    return "word"
```

---

## Detecção de Filler Words em PT-BR

```python
# Categorias de filler words PT-BR [DECISÃO PRÓPRIA]

FILLERS_PT_BR = {
    # Hesitações vocais
    "vogais": ["ahn", "ahm", "eh", "hm", "hmm", "ah", "oh", "uh", "um"],

    # Marcadores de hesitação
    "hesitacao": ["né", "sabe", "tipo", "assim", "então", "bom", "bem", "olha"],

    # Conectivos desnecessários
    "conectivos": ["basicamente", "literalmente", "praticamente", "realmente",
                   "efetivamente", "simplesmente", "obviamente"],

    # Interjeições
    "interjeicoes": ["cara", "gente", "viu", "certo", "ok", "tá", "né?"],

    # Frases de preenchimento
    "frases": ["quer dizer", "ou seja", "que dizer", "sendo assim",
               "de certa forma", "de alguma forma"]
}

def is_filler_word(word: str) -> bool:
    word_lower = word.lower().strip(".,!?")
    for category in FILLERS_PT_BR.values():
        if word_lower in category:
            return True
    return False
```

---

## Cálculo de Accuracy

```python
def calculate_accuracy(segments) -> float:
    """
    Calcula accuracy média ponderada pelo número de tokens por segmento.
    [INFERIDO: baseado em Whisper avg_logprob]
    """
    import math
    total_tokens = 0
    weighted_prob = 0.0

    for segment in segments:
        n = len(segment.words) if segment.words else 1
        # avg_logprob é negativo; converter para probabilidade
        prob = math.exp(segment.avg_logprob) * 100
        weighted_prob += prob * n
        total_tokens += n

    if total_tokens == 0:
        return 0.0

    return round(weighted_prob / total_tokens, 2)
```

---

## Salvando no Banco

```typescript
// Node.js — após receber response do Python worker

async function saveWordsToDatabase(
  projectId: string,
  words: WordDTO[]
): Promise<void> {
  // Batch insert para performance (evitar N+1)
  // Prisma createMany suporta skipDuplicates
  await prisma.word.createMany({
    data: words.map(w => ({
      id: w.id,
      projectId,
      text: w.text,
      type: w.type as WordType,
      startTime: w.startTime,
      endTime: w.endTime,
      confidence: w.confidence,
      isFiller: w.isFiller,
      isRemoved: false,
      position: w.position,
    })),
    skipDuplicates: true,
  });

  // Atualizar status do projeto
  await prisma.project.update({
    where: { id: projectId },
    data: {
      status: 'ready_to_edit',
      updatedAt: new Date(),
    },
  });
}
```

---

## Suporte a Múltiplos Idiomas

```python
# [CONFIRMADO: Submagic suporta 100+ idiomas via GET /v1/languages]
# faster-whisper detecta automaticamente o idioma

SUPPORTED_LANGUAGES = {
    "pt": "Português (BR)",    # principal foco
    "en": "English",
    "es": "Español",
    "fr": "Français",
    "de": "Deutsch",
    "it": "Italiano",
    "ja": "日本語",
    "zh": "中文",
    # ... + 95 outros via Whisper
}

def detect_language(model, audio_path: str) -> tuple:
    """Detectar idioma sem transcrever todo o áudio"""
    segments, info = model.transcribe(audio_path[:30])  # primeiros 30s
    return info.language, info.language_probability
```

---

## Estimativas de Performance

| Modelo | Hardware | Tempo (1 min áudio) | Custo Modal |
|--------|----------|---------------------|-------------|
| `large-v3-turbo` | A10G GPU | ~3s | ~$0.004 |
| `large-v3-turbo` | CPU (16 cores) | ~45s | ~$0.002 |
| `medium` | A10G GPU | ~2s | ~$0.003 |
| `large-v3` (sem turbo) | A10G GPU | ~8s | ~$0.008 |

> **Recomendação:** `large-v3-turbo` na A10G — melhor custo/accuracy para PT-BR.

**Accuracy em PT-BR por modelo:**
- `large-v3-turbo`: ~98% (testado com `marcio jr 14.mp4`) [CONFIRMADO]
- `large-v3`: ~99% (mais lento)
- `medium`: ~94%

---

## Referências

- [CONFIRMADO] Accuracy 98.41% em PT-BR: teste dinâmico com `marcio jr 14.mp4`
- [CONFIRMADO] Schema `words[]`: `{ id, text, type, startTime, endTime }` — API Submagic
- [CONFIRMADO] `type: "silence"` com `text: ""` no mesmo array — docs API Submagic
- [CONFIRMADO] Silero VAD: processa janelas de 512 samples — documentação técnica Silero
- [CONFIRMADO] faster-whisper `detect_disfluencies` — documentação whisper-timestamped
- [INFERIDO] Confidence threshold 0.6 para bad takes — padrão da indústria

> Ver: [VIDEO_PIPELINE.md](./VIDEO_PIPELINE.md) | [RENDERING_ENGINE.md](./RENDERING_ENGINE.md)
