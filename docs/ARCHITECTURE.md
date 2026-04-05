# ARCHITECTURE.md
**Versão:** v0.1.0 | **Data:** 2026-04-05 | **Status:** DRAFT

---

## 1. Diagrama Geral da Arquitetura

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENTE (Browser)                               │
│                                                                             │
│  Next.js 14 App Router         Zustand Stores       Pusher JS Client        │
│  ┌──────────────────┐          ┌─────────────┐      ┌──────────────────┐   │
│  │  /dashboard       │          │ projectStore│      │ private-user-{id}│   │
│  │  /editor/[id]     │◄────────►│ editorStore │      │ channel listener │   │
│  │  /upload          │          │ uploadStore │      └────────┬─────────┘   │
│  └────────┬──────────┘          └─────────────┘               │             │
│           │ HTML5 + Canvas 2D                                  │             │
│           │ (caption preview)                                  │             │
└───────────┼────────────────────────────────────────────────────┼─────────────┘
            │ HTTPS                                              │ WSS
            │                                              ┌─────▼──────┐
            │                                              │   Pusher   │
            │                                              │  Channels  │
            │                                              └─────┬──────┘
            │                                                    │ trigger()
┌───────────▼────────────────────────────────────────────────────┼─────────────┐
│                         BACKEND (Node.js 20 + TypeScript)       │             │
│                                                                 │             │
│  ┌──────────────────────────────────────────────────────────┐   │             │
│  │                    Hono API Server                        │   │             │
│  │                                                          │   │             │
│  │  /api/auth/**         (NextAuth v5 handlers)             │   │             │
│  │  /api/projects        (CRUD + upload flow)               │   │             │
│  │  /api/projects/:id    (status + data)                    │   │             │
│  │  /api/projects/:id/export  (trigger export job)          │   │             │
│  │  /api/upload/presign  (S3 presigned URL)                 │   │             │
│  │  /api/user-media      (B-roll user uploads)              │   │             │
│  │  /api/magic-clips     (Magic Clips pipeline)             │   │             │
│  │  /api/templates       (caption templates list)           │   │             │
│  │  /api/languages       (supported languages)              │   │             │
│  │  /api/health          (healthcheck)                      │   │             │
│  │                                                          │   │             │
│  │  Middleware: JWT verify → rate limit → Prisma context    │   │             │
│  └──────────────────┬───────────────────────────────────────┘   │             │
│                     │                                           │             │
│  ┌──────────────────▼────────────┐   ┌────────────────────────┐│             │
│  │         Prisma v5.22           │   │    BullMQ Queues        ││             │
│  │         ORM Layer              │   │                        ││             │
│  │                               │   │  video-processing       ││             │
│  │  models: User, Team,          │   │  ├─ transcription       ││             │
│  │  Project, Word, Job,          │   │  ├─ silence_removal     ││             │
│  │  ProjectItem, UserMedia,      │   │   ├─ bad_takes          ││             │
│  │  MagicClip, Subscription,     │   │  ├─ clean_audio         ││             │
│  │  CreditsLedger, Preset,       │   │  ├─ broll_generation    ││             │
│  │  Theme, ApiKey                │   │  ├─ magic_zooms         │◄─────────────┘
│  └──────────────────┬────────────┘   │  ├─ export             │
│                     │               │  ├─ magic_clips          │
│                     │               │  └─ hook_title           │
│                     │               └───────────┬─────────────┘
│                     │                           │ consume
└─────────────────────┼───────────────────────────┼──────────────┘
                      │                           │
         ┌────────────▼───┐           ┌───────────▼────────────────────────────┐
         │  PostgreSQL     │           │        Python ML Worker                 │
         │  (Supabase)     │           │        (GPU Instance — Modal.com)       │
         │                │           │                                         │
         │  RLS enabled   │           │  ┌─────────────────────────────────┐   │
         │  Connection     │◄──────────┤  │ faster-whisper Large-V3 Turbo   │   │
         │  pooling (PG-  │           │  │ + Silero VAD v6 (ONNX)          │   │
         │  Bouncer)      │           │  │ + noisereduce (cleanAudio)       │   │
         └────────────────┘           │  └─────────────────────────────────┘   │
                                      │                                         │
                                      │  ┌─────────────────────────────────┐   │
                                      │  │ generate_ass.py                  │   │
                                      │  │ → captions.ass (karaoke {\k})   │   │
                                      │  └─────────────────────────────────┘   │
                                      │                                         │
                                      │  ┌─────────────────────────────────┐   │
                                      │  │ FFmpeg + libass                  │   │
                                      │  │ filter_complex:                  │   │
                                      │  │  silence removal + ass overlay   │   │
                                      │  │  + broll overlay + amix music    │   │
                                      │  │  + zoompan + drawtext hook       │   │
                                      │  └─────────────────────────────────┘   │
                                      └───────────────────┬─────────────────────┘
                                                          │ up/download
┌─────────────────────────────────────────────────────────▼──────────────────────┐
│                              AWS Infrastructure                                  │
│                                                                                  │
│  ┌──────────────────┐    ┌──────────────────────────────────────────────────┐  │
│  │  Cloudflare R2   │    │               AWS S3                              │  │
│  │  (upload tmp)    │    │                                                  │  │
│  │                  │    │  /inputs/{userId}/{projectId}/original.mp4       │  │
│  │  Multipart PUT   │    │  /outputs/{userId}/{projectId}/output.mp4        │  │
│  │  from browser    │    │  /outputs/{userId}/{projectId}/output.ass        │  │
│  │  (sem egress fee)│    │  /user-media/{userId}/{assetId}/file.mp4         │  │
│  └──────────────────┘    └──────────────────────┬───────────────────────────┘  │
│                                                  │ OAC                          │
│                                                  ▼                              │
│                                       ┌──────────────────┐                     │
│                                       │   CloudFront CDN  │                     │
│                                       │                  │                     │
│                                       │  directUrl:      │                     │
│                                       │  dqu1p08d61fh    │                     │
│                                       │  .cloudfront.net │                     │
│                                       └──────────────────┘                     │
└────────────────────────────────────────────────────────────────────────────────┘

Serviços Externos:
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Pusher      │  │  OpenAI      │  │  Pexels API  │  │  Upstash     │
│  Channels    │  │  GPT-4o-mini │  │  B-roll stock│  │  Redis       │
│  (realtime)  │  │  (hooks+     │  │  [CONFIRMADO]│  │  (BullMQ     │
│  [CONFIRMADO]│  │   broll query│  │              │  │   backend)   │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

---

## 2. Componentes e Responsabilidades

### 2.1 Frontend — Next.js 14 App Router

| Componente | Responsabilidade |
|---|---|
| `app/dashboard` | Lista de projetos, botão de criação |
| `app/upload` | Drag-n-drop + presigned S3 upload com progresso |
| `app/editor/[id]` | Editor principal com preview Canvas 2D |
| `app/editor/[id]/captions` | Editor de legendas linha a linha |
| `app/editor/[id]/broll` | Painel de B-roll e user media |
| `app/editor/[id]/export` | Modal de export com opções |
| `components/VideoPlayer` | HTML5 `<video>` + sincronização de playhead |
| `components/CaptionCanvas` | Canvas 2D para preview de legendas animadas |
| `components/UploadProgress` | Barra de progresso multipart |
| `lib/pusher-client` | Subscription ao channel `private-user-{id}` |
| `stores/projectStore` | Estado global do projeto (Zustand) |
| `stores/editorStore` | Estado do editor (palavras selecionadas, cursor) |

### 2.2 Backend — Hono API Server

| Módulo | Responsabilidade |
|---|---|
| `routes/auth` | NextAuth v5 handlers (Google OAuth) |
| `routes/projects` | CRUD de projetos + trigger de pipeline |
| `routes/upload` | Geração de presigned URLs (S3 + R2) |
| `routes/export` | Trigger de job de export + polling |
| `routes/user-media` | Upload e gestão de mídia do usuário |
| `routes/magic-clips` | Pipeline de Magic Clips |
| `routes/templates` | Listagem de templates de caption |
| `middleware/auth` | Verificação de JWT via NextAuth session |
| `middleware/rateLimit` | Rate limiting por usuário e por IP |
| `lib/prisma` | Singleton do cliente Prisma |
| `lib/bullmq` | Enfileiramento de jobs |
| `lib/pusher` | Server-side trigger de eventos |
| `lib/s3` | AWS SDK v3 — presigned URLs e operações |

### 2.3 Python ML Worker (Modal.com ou Railway GPU)

| Módulo | Responsabilidade |
|---|---|
| `workers/transcription.py` | Silero VAD + faster-whisper → words[] |
| `workers/audio_processing.py` | cleanAudio (noisereduce) |
| `workers/ass_generator.py` | words[] → arquivo .ass com karaoke |
| `workers/ffmpeg_render.py` | filter_complex completo → output.mp4 |
| `workers/broll_search.py` | GPT-4o-mini query + Pexels search |
| `workers/magic_clips.py` | Segmentação + virality scoring |
| `workers/hook_title.py` | GPT-4o-mini para título viral |

### 2.4 Banco de Dados — PostgreSQL (Supabase)

- **Engine:** PostgreSQL 15+
- **ORM:** Prisma v5.22
- **Connection pooling:** PgBouncer (Supabase managed)
- **RLS:** habilitado em todas as tabelas de usuário
- **Backups:** automáticos diários (Supabase)

> Ver: [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)

### 2.5 Filas — BullMQ + Redis (Upstash)

- **Broker:** Upstash Redis (serverless, sem servidor Redis para gerenciar)
- **Queue principal:** `video-processing`
- **Workers:** Node.js para orchestração + Python para ML
- **Retry:** 3 tentativas com exponential backoff (1s, 5s, 30s)
- **Dead Letter Queue:** `video-processing-failed`

> Ver: [JOBS_SYSTEM.md](./JOBS_SYSTEM.md)

---

## 3. Fluxo de Dados Completo

### 3.1 Upload e Início de Processamento

```
Browser                  API Server              S3/R2              BullMQ
   │                         │                     │                   │
   │──POST /upload/presign──►│                     │                   │
   │◄──{ uploadUrl, key }────│                     │                   │
   │                         │                     │                   │
   │──PUT binary chunks──────────────────────────►│                   │
   │  (multipart direto)     │                     │                   │
   │◄──200 OK + ETag─────────────────────────────│                   │
   │                         │                     │                   │
   │──POST /projects─────────►│                     │                   │
   │  { title, language,     │                     │                   │
   │    templateName, ... }  │──INSERT project────►│                   │
   │                         │──enqueue job────────────────────────►│
   │◄──{ id, status: "processing" }                │                   │
```

### 3.2 Processamento Assíncrono

```
BullMQ          Python Worker           PostgreSQL         Pusher
   │                   │                     │                │
   │──consume job──────►│                     │                │
   │                   │──download video────►│(S3)            │
   │                   │──Silero VAD         │                │
   │                   │──faster-whisper     │                │
   │                   │──INSERT words[]────►│                │
   │                   │                     │                │
   │                   │──trigger event──────────────────────►│
   │                   │  transcription_     │                │──► Browser
   │                   │  complete           │                │
   │                   │──UPDATE project     │                │
   │                   │  status: ready_to_  │                │
   │                   │  edit──────────────►│                │
```

### 3.3 Export e Entrega

```
Browser         API Server    BullMQ    Python Worker    S3/CF    Browser
   │                │            │            │             │         │
   │─POST /export──►│            │            │             │         │
   │                │─enqueue───►│            │             │         │
   │◄─{ exporting } │            │─consume───►│             │         │
   │                │            │            │─gen .ass    │         │
   │                │            │            │─ffmpeg─────►│         │
   │                │            │            │─upload mp4─►│         │
   │                │            │            │◄─CloudFront │         │
   │                │            │            │  URL        │         │
   │                │            │◄─complete──│             │         │
   │                │─Pusher trigger──────────────────────────────────►│
   │                │  { downloadUrl, directUrl }                      │
```

---

## 4. Decisões de Arquitetura

| Decisão | Escolha | Justificativa |
|---------|---------|---------------|
| API Framework | Hono | Mais leve que Fastify, edge-ready, excelente TS support [DECISÃO PRÓPRIA] |
| ORM | Prisma v5.22 | Type-safety + migrations gerenciadas [DECISÃO PRÓPRIA] |
| Storage ingestão | Cloudflare R2 | Sem egress fee para upload [CONFIRMADO: Submagic usa R2 para ingestão] |
| Storage entrega | AWS S3 + CloudFront | [CONFIRMADO: directUrl aponta para CloudFront] |
| Realtime | Pusher Channels | [CONFIRMADO: window.Pusher detectado no Submagic] |
| Redis | Upstash | Serverless, sem infra para gerenciar [DECISÃO PRÓPRIA] |
| Auth | NextAuth v5 | Suporte nativo a Next.js 14 App Router [DECISÃO PRÓPRIA] |
| Transcrição | faster-whisper + Silero VAD | [CONFIRMADO: evidências de pipeline; 98.41% PT-BR] |
| Burn-in | FFmpeg + libass | [CONFIRMADO: método padrão indústria para karaoke word-by-word] |
| B-roll | Pexels API | [CONFIRMADO: mencionado explicitamente no FAQ Submagic] |
| GPU | Modal.com A10G | ~$0.02/job render vs $0.05 A100 [DECISÃO PRÓPRIA] |

---

## 5. Variáveis de Ambiente

```env
# App
NEXT_PUBLIC_APP_URL=https://[DOMINIO].com
NODE_ENV=production

# Auth
NEXTAUTH_SECRET=<random-256-bit>
NEXTAUTH_URL=https://[DOMINIO].com
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Database
DATABASE_URL=postgresql://...@supabase.../postgres
DIRECT_URL=postgresql://...@supabase.../postgres

# Redis (Upstash)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# AWS
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-1
AWS_S3_BUCKET=
CLOUDFRONT_DOMAIN=dqu1p08d61fh.cloudfront.net
CLOUDFRONT_KEY_PAIR_ID=
CLOUDFRONT_PRIVATE_KEY=

# Cloudflare R2 (upload ingestão)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=

# Pusher
PUSHER_APP_ID=
PUSHER_KEY=
PUSHER_SECRET=
PUSHER_CLUSTER=
NEXT_PUBLIC_PUSHER_KEY=
NEXT_PUBLIC_PUSHER_CLUSTER=

# OpenAI
OPENAI_API_KEY=

# Pexels
PEXELS_API_KEY=

# Python Worker
WORKER_API_SECRET=  # Para autenticar callbacks do worker para o backend
MODAL_TOKEN_ID=
MODAL_TOKEN_SECRET=
```

---

## Referências

- [CONFIRMADO] CloudFront URL: `dqu1p08d61fh.cloudfront.net` — observado em webhooks da API Submagic
- [CONFIRMADO] Pusher: `window.Pusher` detectado via análise dinâmica
- [CONFIRMADO] Cloudflare R2: Upload multipart para `r2.cloudflarestorage.com`
- [CONFIRMADO] Pexels: mencionado explicitamente no FAQ do Submagic

> Ver: [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | [JOBS_SYSTEM.md](./JOBS_SYSTEM.md) | [VIDEO_PIPELINE.md](./VIDEO_PIPELINE.md)
