# MASTER_PLAN.md — Plano Mestre de Desenvolvimento
**Versão:** v1.0.0 | **Data:** 2026-04-05 | **Status:** ACTIVE
**Produto:** [NOME_DO_PRODUTO] — SaaS de Edição de Vídeo com IA

> ⚡ **Este é o arquivo de contexto-raiz do projeto.**
> Toda vez que iniciar uma nova conversa com a IA, compartilhe este arquivo.
> Ele contém TUDO que foi descoberto, decidido e planejado — do zero ao deploy.

---

## 🗺️ Índice de Documentação

| Arquivo | Conteúdo | Quando Consultar |
|---------|----------|-----------------|
| [PRODUCT_VISION.md](./PRODUCT_VISION.md) | Visão, público-alvo, diferenciais | Início de sessão, decisões de produto |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Diagrama completo do sistema | Antes de qualquer novo componente |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | Prisma schema completo (14 models) | Antes de criar/alterar tabelas |
| [API_SPECIFICATION.md](./API_SPECIFICATION.md) | 18 endpoints REST + Pusher events | Antes de criar rotas de API |
| [VIDEO_PIPELINE.md](./VIDEO_PIPELINE.md) | 4 fases do pipeline com código | Qualquer trabalho no pipeline |
| [TRANSCRIPTION_ENGINE.md](./TRANSCRIPTION_ENGINE.md) | faster-whisper + Silero VAD | Transcrição e words[] |
| [RENDERING_ENGINE.md](./RENDERING_ENGINE.md) | generate_ass.py + FFmpeg | Export e burn-in de legendas |
| [JOBS_SYSTEM.md](./JOBS_SYSTEM.md) | BullMQ workers + Pusher events | Jobs assíncronos |
| [CREDITS_SYSTEM.md](./CREDITS_SYSTEM.md) | Ledger append-only + feature flags | Créditos e planos |
| [FEATURE_SPECS.md](./FEATURE_SPECS.md) | 18 features com endpoints e jobs | Implementar qualquer feature |
| [FRONTEND_ARCHITECTURE.md](./FRONTEND_ARCHITECTURE.md) | Next.js 14 + Zustand + Canvas | Frontend e editor |
| [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md) | 3 sprints, ~389h estimadas | Planejamento de sessão |

---

## 🧠 Contexto Crítico — Leia Primeiro

### De onde vieram as decisões técnicas

Este projeto é baseado em **engenharia reversa forense do Submagic.co** realizada em 2026-04-05.
Todas as decisões técnicas estão marcadas com:

- `[CONFIRMADO]` — evidência direta capturada da API/rede do Submagic
- `[INFERIDO]` — lógica baseada em evidências (alta confiança)
- `[DECISÃO PRÓPRIA]` — nossa escolha de implementação

### As 5 descobertas mais importantes

1. **FFmpeg + libass** (não drawtext, não Remotion) — burn-in via arquivo `.ass` com tags `{\k}` karaoke
2. **words[] = tudo no mesmo array** — silences são `type: "silence"` com `text: ""` no array principal
3. **Silence removal = soft delete** — `isRemoved: true` no banco, corte via FFmpeg `trim+concat`
4. **B-roll = Pexels** [CONFIRMADO] — 3 AI credits por item, máximo 12s por item
5. **CloudFront** [CONFIRMADO] — `dqu1p08d61fh.cloudfront.net` para entrega de vídeos

### Custo operacional real (uso próprio)

```
Por vídeo de 1 minuto (A10G Modal.com):
├── Silero VAD:          ~$0.0001
├── faster-whisper:      ~$0.004
├── FFmpeg silence:      ~$0.001
├── cleanAudio:          ~$0.001
├── GPT-4o-mini (hooks): ~$0.001
├── generate_ass.py:     ~$0.000
├── FFmpeg + libass:     ~$0.02
├── R2 + S3 + CF:        ~$0.002
└── TOTAL:               ~$0.03–$0.09
```

---

## ⚙️ Stack Definitiva (Não Alterar)

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND                                                    │
│  Next.js 14 App Router + TypeScript                         │
│  shadcn/ui + Tailwind CSS                                   │
│  Zustand (estado) + Pusher JS (realtime)                    │
│  HTML5 <video> + Canvas 2D (preview captions)               │
├─────────────────────────────────────────────────────────────┤
│  BACKEND                                                    │
│  Node.js 20 + TypeScript + Hono framework                   │
│  Prisma v5.22 + PostgreSQL (Supabase)                       │
│  BullMQ + Upstash Redis (jobs assíncronos)                  │
│  NextAuth v5 Beta (Google OAuth)                            │
├─────────────────────────────────────────────────────────────┤
│  PYTHON ML WORKER (Modal.com A10G GPU)                      │
│  faster-whisper Large-V3 Turbo (transcrição)                │
│  Silero VAD v6 ONNX (detecção de voz)                       │
│  noisereduce (clean audio)                                  │
│  generate_ass.py (karaoke .ass writer)                      │
│  FFmpeg + libass (burn-in + B-roll + zooms)                 │
├─────────────────────────────────────────────────────────────┤
│  STORAGE                                                    │
│  Cloudflare R2 (upload ingestão — sem egress fee)           │
│  AWS S3 + CloudFront (entrega final)                        │
├─────────────────────────────────────────────────────────────┤
│  SERVIÇOS EXTERNOS                                          │
│  Pusher Channels (realtime updates)                         │
│  OpenAI GPT-4o-mini (hook titles + broll queries)           │
│  Pexels API (B-roll stock gratuito, 200 req/h)              │
│  Supabase (PostgreSQL + Auth + RLS)                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 🗄️ Schemas Críticos (Memorize)

### Word Object [CONFIRMADO via API Submagic]

```typescript
interface Word {
  id: string           // UUID v4
  projectId: string
  text: string         // "" para silences
  type: "word" | "silence" | "punctuation"
  startTime: number    // float, segundos
  endTime: number      // float, segundos
  confidence: number | null  // 0.0–1.0 (null para silence/punctuation)
  isFiller: boolean    // "ahn", "né", "tipo", etc.
  isRemoved: boolean   // soft delete (preserve para undo)
  position: number     // ordem na transcrição
}
```

### Project Status Flow [CONFIRMADO]

```
uploading → processing → transcribing → ready_to_edit → exporting → completed
                                                                    ↘ failed
```

### Pusher Events [CONFIRMADO: channel = private-user-{userId}]

```typescript
// Eventos emitidos pelo servidor durante o pipeline:
"project.status.updated"    → { projectId, status, previousStatus }
"transcription.completed"   → { projectId, wordCount, accuracy, language }
"job.progress"              → { projectId, jobType, progress: 0-100 }
"export.completed"          → { projectId, downloadUrl, directUrl }
"export.failed"             → { projectId, error }
"magic_clips.completed"     → { projectId, clips[] }
```

### removeSilencePace Thresholds [CONFIRMADO]

```
extra-fast → silêncios > 0.1s são removidos
fast       → silêncios > 0.2s são removidos  ← default
natural    → silêncios > 0.6s são removidos
```

### Créditos por Operação [CONFIRMADO]

```
ai-broll (1 item)     = 3 AI credits
magic-clips (1 proj)  = 5 credits (inferido)
export padrão         = 0 credits
Business plan         = "unlimited" (sem validação)
```

---

## 🏗️ Estrutura de Arquivos do Projeto

```
[NOME_DO_PRODUTO]/
├── docs/                          ← Documentação (você está aqui)
│   ├── MASTER_PLAN.md             ← Este arquivo
│   ├── PRODUCT_VISION.md
│   ├── ARCHITECTURE.md
│   ├── DATABASE_SCHEMA.md
│   ├── API_SPECIFICATION.md
│   ├── VIDEO_PIPELINE.md
│   ├── TRANSCRIPTION_ENGINE.md
│   ├── RENDERING_ENGINE.md
│   ├── JOBS_SYSTEM.md
│   ├── CREDITS_SYSTEM.md
│   ├── FEATURE_SPECS.md
│   ├── FRONTEND_ARCHITECTURE.md
│   └── DEVELOPMENT_ROADMAP.md
│
├── app/                           ← Next.js 14 App Router
│   ├── layout.tsx
│   ├── page.tsx                   ← Landing
│   ├── (auth)/login/page.tsx
│   ├── (app)/
│   │   ├── dashboard/page.tsx
│   │   ├── upload/page.tsx
│   │   ├── editor/[id]/
│   │   │   ├── layout.tsx
│   │   │   ├── captions/page.tsx
│   │   │   ├── broll/page.tsx
│   │   │   ├── trim/page.tsx
│   │   │   └── export/page.tsx
│   │   ├── magic-clips/page.tsx
│   │   └── media/page.tsx
│   └── api/
│       ├── auth/[...nextauth]/route.ts
│       ├── upload/presign/route.ts
│       ├── upload/complete/route.ts
│       ├── projects/route.ts
│       ├── projects/[id]/route.ts
│       ├── projects/[id]/export/route.ts
│       ├── projects/magic-clips/route.ts
│       ├── user-media/route.ts
│       ├── templates/route.ts
│       ├── languages/route.ts
│       ├── pusher/auth/route.ts
│       └── health/route.ts
│
├── components/
│   ├── editor/
│   │   ├── VideoPlayer.tsx        ← 60fps via requestAnimationFrame
│   │   ├── CaptionCanvas.tsx      ← Canvas 2D preview word-by-word
│   │   ├── CaptionList.tsx
│   │   ├── CaptionItem.tsx
│   │   ├── TemplateGrid.tsx
│   │   ├── BrollPanel.tsx
│   │   ├── TrimTimeline.tsx
│   │   └── ExportModal.tsx
│   ├── upload/
│   │   ├── DropZone.tsx
│   │   └── UploadProgress.tsx
│   └── dashboard/
│       ├── ProjectGrid.tsx
│       └── ProjectCard.tsx
│
├── stores/
│   ├── projectStore.ts            ← words[], theme, status
│   ├── editorStore.ts             ← currentTime, isPlaying, panel
│   └── uploadStore.ts             ← multipart progress
│
├── lib/
│   ├── prisma.ts                  ← singleton client
│   ├── bullmq.ts                  ← queue instances
│   ├── pusher.ts                  ← server-side trigger
│   ├── pusher-client.ts           ← browser subscription
│   ├── s3.ts                      ← AWS SDK v3
│   └── pythonWorker.ts            ← HTTP client para Modal.com
│
├── workers/                       ← BullMQ handlers (Node.js)
│   ├── transcriptionWorker.ts
│   ├── exportWorker.ts
│   ├── silenceRemovalWorker.ts
│   ├── brollGenerationWorker.ts
│   └── magicClipsWorker.ts
│
├── python/                        ← Python ML Workers (Modal.com)
│   ├── transcription.py           ← Silero VAD + faster-whisper
│   ├── audio_processing.py        ← noisereduce
│   ├── ass_generator.py           ← words[] → .ass karaoke
│   ├── ffmpeg_render.py           ← filter_complex completo
│   ├── broll_search.py            ← GPT-4o-mini + Pexels
│   ├── magic_clips.py             ← segmentação + virality scoring
│   └── hook_title.py              ← GPT-4o-mini
│
├── prisma/
│   ├── schema.prisma              ← Schema completo (ver DATABASE_SCHEMA.md)
│   ├── seed.ts                    ← Presets: Karl, Hormozi, etc.
│   └── migrations/
│
├── fonts/                         ← Fontes para FFmpeg (CRÍTICO)
│   ├── Montserrat-Black.ttf       ← Karl template
│   ├── Montserrat-Bold.ttf
│   ├── Oswald-Bold.ttf            ← Hormozi templates
│   └── BebasNeue-Regular.ttf
│
├── Dockerfile.worker              ← FFmpeg + libass + Python
├── docker-compose.yml
├── .env.local                     ← (não commitar)
└── .env.example                   ← Template de vars (ver abaixo)
```

---

## 🔑 Variáveis de Ambiente Completas

```env
# ═══ APP ═══
NEXT_PUBLIC_APP_URL=https://[DOMINIO].com
NODE_ENV=production
BETA_MODE=true

# ═══ AUTH ═══
NEXTAUTH_SECRET=                   # openssl rand -base64 32
NEXTAUTH_URL=https://[DOMINIO].com
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# ═══ DATABASE ═══
DATABASE_URL=postgresql://postgres.[ref]:[pass]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
DIRECT_URL=postgresql://postgres.[ref]:[pass]@aws-0-us-east-1.pooler.supabase.com:5432/postgres

# ═══ REDIS (Upstash) ═══
UPSTASH_REDIS_REST_URL=https://...-us1-rest.upstash.io
UPSTASH_REDIS_REST_TOKEN=

# ═══ AWS S3 + CLOUDFRONT ═══
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-1
AWS_S3_BUCKET=
CLOUDFRONT_DOMAIN=                 # ex: d1234abc.cloudfront.net
CLOUDFRONT_KEY_PAIR_ID=
CLOUDFRONT_PRIVATE_KEY=            # RSA private key para signed URLs

# ═══ CLOUDFLARE R2 (upload ingestão) ═══
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=                     # ex: https://pub-xxx.r2.dev

# ═══ PUSHER ═══
PUSHER_APP_ID=
PUSHER_KEY=
PUSHER_SECRET=
PUSHER_CLUSTER=mt1                 # us-east
NEXT_PUBLIC_PUSHER_KEY=            # mesmo que PUSHER_KEY
NEXT_PUBLIC_PUSHER_CLUSTER=mt1

# ═══ OPENAI ═══
OPENAI_API_KEY=sk-...              # para GPT-4o-mini (hooks + broll queries)

# ═══ PEXELS ═══
PEXELS_API_KEY=                    # gratuito em pexels.com/api

# ═══ PYTHON WORKER ═══
WORKER_API_SECRET=                 # UUID aleatório — callback auth
MODAL_TOKEN_ID=                    # modal.com
MODAL_TOKEN_SECRET=
WORKER_BASE_URL=https://...modal.run  # URL do worker Modal deployado
```

---

## 📋 Checklist de Setup Inicial (Semana 1)

> Execute nesta ordem exata. Cada item desbloqueia o próximo.

### 1. Contas e Chaves de API
- [ ] Criar projeto no Supabase → copiar `DATABASE_URL` e `DIRECT_URL`
- [ ] Criar conta Modal.com → configurar GPU A10G
- [ ] Criar projeto Pusher → copiar `APP_ID`, `KEY`, `SECRET`, `CLUSTER`
- [ ] Criar conta Upstash → criar Redis → copiar `REST_URL` e `REST_TOKEN`
- [ ] Criar bucket AWS S3 + distribuição CloudFront (região `us-east-1`)
- [ ] Criar bucket Cloudflare R2 (upload temporário)
- [ ] Criar projeto Google Cloud → OAuth 2.0 credentials → copiar `CLIENT_ID` e `SECRET`
- [ ] Gerar API key Pexels em pexels.com/api
- [ ] Copiar API key OpenAI

### 2. Projeto Next.js

```bash
# Na pasta do projeto:
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*"

# Instalar dependências principais:
npm install @prisma/client prisma
npm install next-auth@beta
npm install bullmq
npm install hono @hono/node-server
npm install pusher pusher-js
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
npm install zustand
npm install @upstash/redis

# shadcn/ui:
npx shadcn@latest init
npx shadcn@latest add button card input label toast progress badge
```

### 3. Banco de Dados

```bash
# Copiar schema de DATABASE_SCHEMA.md para prisma/schema.prisma

npx prisma generate
npx prisma db push            # ou prisma migrate dev --name init
npx prisma db seed            # seeds dos presets (Karl, Hormozi, etc.)
```

### 4. Python Worker (Modal.com)

```bash
pip install modal faster-whisper silero-vad noisereduce soundfile

# Deploy inicial:
modal deploy python/transcription.py
modal deploy python/ffmpeg_render.py
```

### 5. Docker (FFmpeg + libass)

```bash
# Copiar Dockerfile.worker do RENDERING_ENGINE.md
# CRÍTICO: incluir as fontes em /fonts/

docker build -f Dockerfile.worker -t video-worker .
docker run -e WORKER_API_SECRET=... video-worker
```

---

## 🚦 Pipeline de Implementação (10 Semanas)

```
SEMANA 01  ████████████░░░░░░░░░░░░░░░░░░░░  Setup + Auth + DB + S3
SEMANA 02  ░░░░░░░░████████████░░░░░░░░░░░░  Transcrição + Editor UI
SEMANA 03  ░░░░░░░░░░░░░░░░████████████░░░░  Rendering + Export
           ─────────── MVP COMPLETO ───────────────────────────────

SEMANA 04  ░░░░░░░░░░░░░░░░░░░░████████░░░░  Silence + Bad Takes
SEMANA 05  ░░░░░░░░░░░░░░░░░░░░░░░░████████  B-Roll + Pexels
SEMANA 06  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░████  Clean Audio + Zooms + Hooks
SEMANA 07  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░████  Magic Clips
           ─────────── CORE AI COMPLETO ────────────────────────────

SEMANA 08  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██  API Pública + Teams
SEMANA 09  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██  Publishing
SEMANA 10  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██  Polish + Créditos
           ─────────── PRONTO PARA LANÇAMENTO ───────────────────────
```

---

## ✅ Critérios de Aceitação por Feature

### Sprint 1 — MVP
```
[ ] Login com Google funciona (NextAuth v5)
[ ] Upload MP4/MOV até 2GB com progresso multipart
[ ] Transcrição PT-BR com > 95% accuracy em < 5min
[ ] Editor exibe captions editáveis (edit/delete/hide/split)
[ ] Preview Canvas 2D mostra highlight word-by-word em tempo real
[ ] Export gera MP4 com legendas burned-in (FFmpeg + libass)
[ ] Download via CloudFront URL funciona
[ ] Pusher atualiza UI sem polling (transcription + export)
[ ] Template "Karl" aplicado corretamente (Montserrat 900 + laranja)
```

### Sprint 2 — Core AI
```
[ ] Remove silence: 3 velocidades (0.1/0.2/0.6s) com preview na timeline
[ ] Remove bad takes: confidence < 0.6 detectado e marcado
[ ] Clean audio: ruído reduzido sem distorção de voz
[ ] B-roll: Pexels busca automaticamente e aplica em 10 layouts
[ ] Créditos debitados: 3 por item de B-roll, sem ultrapassar saldo
[ ] Hook title: GPT-4o-mini gera em PT-BR e aparece no vídeo
[ ] Música: upload + mix com fade in/out via FFmpeg amix
[ ] Magic Clips: virality score 5D exibido e clips ranqueados
```

### Sprint 3 — Scale
```
[ ] API pública com x-api-key funcional e documentada
[ ] Rate limiting: 60 req/min por API key
[ ] Webhook delivery com 3 retries + exponential backoff
[ ] Sistema de créditos com reset mensal automático
[ ] Paywall retorna 402/403 com upgrade_url correto
[ ] LCP < 2.5s, CLS < 0.1 (Core Web Vitals)
[ ] Mobile responsive no editor
```

---

## 🔄 Fluxo de Trabalho com a IA

### Como iniciar cada sessão de desenvolvimento

```markdown
1. Compartilhe este arquivo: docs/MASTER_PLAN.md
2. Diga qual sprint/semana/tarefa vai implementar
3. A IA vai ler o doc relevante automaticamente

Exemplo de prompt:
"Estamos na semana 2 do Sprint 1. Preciso implementar o
transcriptionHandler no BullMQ que chama o Python worker e
salva o words[] no banco. Ver JOBS_SYSTEM.md e VIDEO_PIPELINE.md."
```

### Regras para não perder contexto

1. **Nunca criar tabela** sem consultar `DATABASE_SCHEMA.md` primeiro
2. **Nunca criar endpoint** sem consultar `API_SPECIFICATION.md`
3. **Nunca criar job** sem consultar `JOBS_SYSTEM.md`
4. **Toda mudança no pipeline** → atualizar `VIDEO_PIPELINE.md`
5. **Toda nova feature** → adicionar em `FEATURE_SPECS.md`

---

## 🏛️ Decisões Arquiteturais Imutáveis

> Estas decisões NÃO devem ser questionadas ou alteradas durante o desenvolvimento.
> Foram derivadas de evidências concretas da engenharia reversa.

| Decisão | Valor | Razão |
|---------|-------|-------|
| Burn-in de legendas | **FFmpeg + libass** | Único método para karaoke word-by-word |
| Schema words[] | **type: word\|silence\|punctuation** | Confirmado via API pública |
| Silences no array | **Mesmo array words[]** | Não há endpoint separado |
| Storage entrega | **AWS S3 + CloudFront** | Confirmado via directUrl dos webhooks |
| Realtime | **Pusher Channels** | Confirmado via window.Pusher |
| Transcrição | **faster-whisper Large-V3 Turbo** | 98.41% PT-BR confirmado em teste |
| B-roll stock | **Pexels API** | Confirmado explicitamente no FAQ |
| Upload ingestão | **Cloudflare R2** | Sem egress fee para computação |
| Karaoke tag | **`{\\kf N}`** | ASS karaoke fill com highlight progressivo |
| Créditos | **Append-only ledger** | Auditabilidade + sem UPDATE/DELETE |

---

## 🚨 Armadilhas Conhecidas

| Armadilha | Como Evitar |
|-----------|-------------|
| `drawtext` vs `libass` | SEMPRE usar `libass` com arquivo `.ass` — drawtext não suporta highlight por palavra |
| Silences como array separado | NÃO criar endpoint/tabela separada — silences ficam em `words[]` com `type: "silence"` |
| Polling vs Pusher | NUNCA fazer polling de status — usar eventos Pusher `private-user-{id}` |
| Credits UPDATE | NUNCA fazer UPDATE no `credits_ledger` — somente INSERT (append-only) |
| FFmpeg timeout | Setar `timeout=600` no subprocess — render de 5min+ é esperado |
| Pexels rate limit | Cachear resultados no Redis com TTL 1h — free tier = 200 req/h |
| Whisper alucinações | Usar `condition_on_previous_text=False` — evita loops de texto |
| B-roll > 12s | SEMPRE limitar `endTime = min(startTime + 12, endTime)` — confirmado pela API |

---

## 📊 Monitoramento e Custos

### Limites de Alerta (Modal.com)

```python
# Configurar no Modal.com dashboard:
DAILY_SPEND_LIMIT = $5.00     # alerta se passar $5/dia
GPU_CONCURRENCY_LIMIT = 3     # máximo 3 jobs simultâneos na GPU
TIMEOUT_PER_JOB = 600         # 10 minutos máximo por job
```

### Estimativa de Custos Beta (100 usuários, 500 vídeos/mês)

```
Transcrição (500 vídeos × 1min avg × $0.004):  $2.00
FFmpeg render (500 × $0.02):                    $10.00
S3 storage (50GB × $0.023):                     $1.15
CloudFront egress (50GB × $0.085):              $4.25
Upstash Redis (messages):                       $0.00
Pusher (< 1M messages/dia free tier):           $0.00
OpenAI (GPT-4o-mini hooks):                     $1.00
Pexels API:                                     $0.00
Supabase (free tier até 500MB DB):              $0.00
TOTAL ESTIMADO BETA:                           ~$18.40/mês
```

---

## 🎯 Próxima Ação Imediata

**Status atual:** Documentação 100% completa. Pronto para implementação.

**Próximo passo:** Iniciar Sprint 1, Semana 1 — Setup da Fundação.

```
TAREFA IMEDIATA:
1. Criar contas nos serviços (ver Checklist de Setup acima)
2. Executar: npx create-next-app@latest . --typescript --tailwind --app
3. Configurar .env.local com todas as variáveis
4. Rodar: npx prisma db push (schema de DATABASE_SCHEMA.md)
5. Testar: npx prisma db seed (presets Karl, Hormozi)
6. Criar primeiro endpoint: POST /api/upload/presign
```

---

## 🎼 Orchestration Report

### Agentes Aplicados neste Plano

| # | Agente | Contribuição |
|---|--------|-------------|
| 1 | `project-planner` | Estrutura de sprints, dependências, critérios de aceitação |
| 2 | `backend-specialist` | API specs, jobs system, pipeline técnico, schemas |
| 3 | `documentation-writer` | Consolidação dos 12 docs em plano coeso e navegável |

### Documentos que Alimentaram Este Plano
- `PRODUCT_VISION.md` → visão e roadmap de 3 fases
- `ARCHITECTURE.md` → stack e diagrama de componentes
- `DATABASE_SCHEMA.md` → 14 models Prisma completos
- `API_SPECIFICATION.md` → 18 endpoints REST
- `VIDEO_PIPELINE.md` → 4 fases com código Python/TS
- `TRANSCRIPTION_ENGINE.md` → Silero VAD + Whisper config
- `RENDERING_ENGINE.md` → generate_ass.py + FFmpeg filter_complex
- `JOBS_SYSTEM.md` → BullMQ workers + retry logic
- `CREDITS_SYSTEM.md` → ledger append-only + feature flags
- `FEATURE_SPECS.md` → 18 features + jobs + créditos
- `FRONTEND_ARCHITECTURE.md` → Next.js 14 + Zustand + Canvas 2D
- `DEVELOPMENT_ROADMAP.md` → 3 sprints, ~389h, riscos

### Evidências Base (Engenharia Reversa Submagic)
- Análise dinâmica via Playwright (2026-04-05)
- Teste com `marcio jr 14.mp4` (PT-BR, 171MB, 98.41% accuracy)
- Interceptação de rede (CloudFront URLs, R2 multipart, Pusher)
- Documentação pública: `https://docs.submagic.co/api-reference/`

---

*Plano gerado por ORCHESTRATION MODE — project-planner + backend-specialist + documentation-writer*
*Data: 2026-04-05 | Versão: v1.0.0 | Status: PRONTO PARA IMPLEMENTAÇÃO*
