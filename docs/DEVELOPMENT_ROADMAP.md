# DEVELOPMENT_ROADMAP.md
**Versão:** v0.1.0 | **Data:** 2026-04-05 | **Status:** DRAFT

> Roadmap de desenvolvimento em 3 sprints.
> Estimativas baseadas em 1 desenvolvedor full-stack sênior com familiaridade com a stack.

---

## Dependências de Implementação

```
                  ┌─────────────────────────────────────────────┐
                  │              FUNDAÇÃO (semana 1)             │
                  │                                             │
                  │  Next.js setup → Auth → DB → S3 → Upload    │
                  └─────────────────────────────────────────────┘
                                       │
              ┌────────────────────────┼───────────────────────┐
              │                        │                       │
    ┌─────────▼──────────┐  ┌─────────▼──────────┐  ┌────────▼────────────┐
    │  Python Worker      │  │  BullMQ + Redis     │  │  Pusher Setup       │
    │  faster-whisper     │  │  Job handlers       │  │  Events             │
    └─────────┬──────────┘  └─────────┬──────────┘  └────────┬────────────┘
              │                        │                       │
              └────────────────────────┼───────────────────────┘
                                       │
                  ┌─────────────────────▼──────────────────────┐
                  │          TRANSCRIPTION PIPELINE (semana 2)  │
                  └─────────────────────────────────────────────┘
                                       │
                  ┌─────────────────────▼──────────────────────┐
                  │            EDITOR UI (semana 2-3)           │
                  └─────────────────────────────────────────────┘
                                       │
                  ┌─────────────────────▼──────────────────────┐
                  │         RENDERING ENGINE (semana 3)         │
                  │  generate_ass.py → FFmpeg + libass           │
                  └─────────────────────────────────────────────┘
                                       │
                  ┌─────────────────────▼──────────────────────┐
                  │            Sprint 2: AI Features            │
                  │  Silence / Bad Takes / B-roll / Clips       │
                  └─────────────────────────────────────────────┘
```

---

## Sprint 1 — MVP (~3 semanas, ~120h)

**Objetivo:** Pipeline end-to-end funcionando. Upload → Transcrição → Editor → Export com legendas.

### Semana 1 — Fundação

| Tarefa | Horas | Dependência |
|--------|-------|-------------|
| Setup Next.js 14 + shadcn/ui + Tailwind + TypeScript config | 4h | — |
| NextAuth v5 + Google OAuth + sessão | 4h | Next.js setup |
| Prisma v5 + PostgreSQL (Supabase) + schema completo | 6h | — |
| Seed de presets (Karl, Hormozi, etc.) | 2h | Prisma setup |
| AWS S3 + CloudFront + Cloudflare R2 setup | 4h | — |
| Endpoint `/api/upload/presign` + `/api/upload/complete` | 4h | S3 setup |
| Upload multipart client-side (DropZone + progress) | 6h | API presign |
| MediaInfoModule.wasm integration | 3h | Upload flow |
| BullMQ + Upstash Redis setup | 3h | — |
| Pusher setup (server + client) + auth endpoint | 3h | — |
| CI/CD básico (Railway ou Vercel) | 4h | Tudo acima |
| **Subtotal semana 1** | **43h** | |

### Semana 2 — Transcrição + Editor

| Tarefa | Horas | Dependência |
|--------|-------|-------------|
| Python worker setup (Modal.com A10G) | 4h | — |
| Silero VAD v6 setup + configuração | 3h | Python worker |
| faster-whisper Large V3 Turbo setup | 4h | Python worker |
| `build_words_with_silences()` + PT-BR fillers | 5h | Whisper setup |
| `POST /api/projects` + enfileiramento BullMQ | 4h | DB + BullMQ |
| `transcriptionHandler` (BullMQ) → Python → DB | 5h | Tudo acima |
| Pusher events (transcription.completed) | 2h | Pusher setup |
| Dashboard de projetos (lista + status) | 4h | API projects |
| `GET /api/projects/:id` com words[] | 3h | DB |
| Editor layout + VideoPlayer 60fps | 5h | — |
| CaptionList + CaptionItem (edit/delete/hide) | 6h | words[] |
| Zustand stores (projectStore + editorStore) | 3h | — |
| usePusherProject hook | 2h | Pusher |
| **Subtotal semana 2** | **50h** | |

### Semana 3 — Rendering + Export

| Tarefa | Horas | Dependência |
|--------|-------|-------------|
| `generate_ass.py` (words[] → .ass karaoke) | 8h | words[] schema |
| Docker container com FFmpeg + libass + fontes | 4h | — |
| `run_ffmpeg_render()` básico (trim + ass burn-in) | 8h | generate_ass.py |
| Upload output para S3 + CloudFront URL | 3h | AWS setup |
| `POST /api/projects/:id/export` + exportHandler | 4h | FFmpeg render |
| Pusher `export.completed` event | 2h | Pusher |
| CaptionCanvas (Canvas 2D preview) | 6h | words[] + theme |
| TemplateGrid + aplicação de tema | 4h | — |
| ExportModal + botão de download | 3h | export endpoint |
| Testes end-to-end básicos (upload → export) | 5h | Tudo |
| **Subtotal semana 3** | **47h** | |

**Total Sprint 1:** ~140h

**Critério de aceitação Sprint 1:**
- [ ] Usuário faz login com Google
- [ ] Upload de vídeo MP4 de até 171MB com progresso visual
- [ ] Transcrição automática em PT-BR com > 95% accuracy
- [ ] Editor mostra captions editáveis com preview Canvas 2D
- [ ] Export gera MP4 com legendas word-by-word estilo Karl
- [ ] Download via CloudFront URL
- [ ] Progresso em tempo real via Pusher (sem polling)

---

## Sprint 2 — Core AI (~4 semanas, ~160h)

**Objetivo:** Features de IA que diferenciam o produto.

### Semana 4 — Silence Removal + Bad Takes

| Tarefa | Horas | Dependência |
|--------|-------|-------------|
| `silenceRemovalHandler` (3 thresholds) | 6h | words[] |
| `compute_silence_cuts()` + FFmpeg concat | 6h | FFmpeg + words |
| TrimTimeline UI (visualização de cortes) | 8h | editor |
| `badTakesHandler` + confidence scoring | 6h | Whisper confidence |
| `mark_bad_takes()` + sequência detection | 4h | words[] |
| Integração no export (cuts → FFmpeg concat) | 4h | FFmpeg render |
| Preview de cuts na timeline | 5h | TrimTimeline |
| **Subtotal semana 4** | **39h** | |

### Semana 5 — B-Roll + Pexels

| Tarefa | Horas | Dependência |
|--------|-------|-------------|
| Pexels API client + search | 3h | — |
| GPT-4o-mini prompt generation por segmento | 4h | OpenAI SDK |
| `brollGenerationHandler` completo | 6h | Pexels + GPT |
| FFmpeg overlay (10 layouts) | 8h | FFmpeg render |
| BrollPanel UI (list + layout selector) | 6h | projectItems |
| UserMedia upload + library | 6h | S3 + API |
| Credits debit por B-roll item (3 créditos) | 3h | credits ledger |
| `GET /api/user-media` + CRUD | 4h | DB |
| **Subtotal semana 5** | **40h** | |

### Semana 6 — Clean Audio + Zooms + Hook Title

| Tarefa | Horas | Dependência |
|--------|-------|-------------|
| `cleanAudioHandler` + noisereduce | 5h | Python worker |
| `magicZoomsHandler` + zoompan FFmpeg | 6h | FFmpeg |
| `hookTitleHandler` + GPT-4o-mini | 4h | OpenAI |
| drawtext overlay no export | 3h | FFmpeg |
| UI para configuração de hook title | 4h | API |
| `GET /api/hook-title-templates` | 2h | DB seed |
| Música de fundo (upload + amix FFmpeg) | 5h | FFmpeg + S3 |
| ProjectMusic UI (volume slider + fade) | 4h | API |
| **Subtotal semana 6** | **33h** | |

### Semana 7 — Magic Clips

| Tarefa | Horas | Dependência |
|--------|-------|-------------|
| `magicClipsHandler` + segmentação | 8h | Whisper + words |
| Virality scoring (heurística × 5 dimensões) | 8h | segmentação |
| [CONFIRMADO: schema] `viralityScores` no DB | 2h | DB |
| Export individual de cada clip | 4h | FFmpeg |
| `POST /api/projects/magic-clips` | 3h | handler |
| Magic Clips UI (grid ranqueado por virality) | 8h | API |
| faceTracking integration (básico) | 4h | FFmpeg zoompan |
| **Subtotal semana 7** | **37h** | |

**Total Sprint 2:** ~149h

**Critério de aceitação Sprint 2:**
- [ ] Remove silence com 3 velocidades funciona com preview
- [ ] Remove bad takes detecta takes ruins com confidence < 0.6
- [ ] B-roll automático busca no Pexels e insere corretamente
- [ ] 10 layouts de B-roll funcionando no export
- [ ] Créditos debitados corretamente (3 por item)
- [ ] Hook title gerado por IA e aplicado no vídeo
- [ ] Música de fundo mixada com fade
- [ ] Magic Clips ranqueia por virality score com 5 dimensões

---

## Sprint 3 — Scale (~3 semanas, ~100h)

**Objetivo:** Features de escala e preparação para monetização.

### Semana 8 — API Pública + Team

| Tarefa | Horas | Dependência |
|--------|-------|-------------|
| API pública com `x-api-key` auth | 6h | auth middleware |
| Rate limiting por API key | 3h | Redis |
| `POST /api/projects` público (documentado) | 4h | API |
| Team workspace (create, invite, roles) | 8h | DB |
| Webhook delivery com retry | 6h | BullMQ |
| API Keys management UI | 4h | API |
| **Subtotal semana 8** | **31h** | |

### Semana 9 — Publishing + Analytics

| Tarefa | Horas | Dependência |
|--------|-------|-------------|
| TikTok OAuth + upload API | 8h | — |
| Instagram Graph API integration | 6h | — |
| YouTube Data API v3 | 6h | — |
| Auto-publish scheduling | 4h | integrations |
| Basic analytics por vídeo (views, downloads) | 6h | DB |
| **Subtotal semana 9** | **30h** | |

### Semana 10 — Polish + Sistema de Créditos

| Tarefa | Horas | Dependência |
|--------|-------|-------------|
| Credits system completo + monthly reset | 6h | ledger |
| Paywall UI (403/402 responses) | 4h | credits |
| Onboarding flow (tour PT-BR) | 6h | — |
| Performance optimization (SSR, lazy load) | 6h | — |
| Error boundaries + toast notifications | 4h | — |
| Mobile responsive do editor | 6h | — |
| SEO (meta, OG, sitemap) | 3h | — |
| Lighthouse audit + Core Web Vitals | 4h | — |
| **Subtotal semana 10** | **39h** | |

**Total Sprint 3:** ~100h

**Critério de aceitação Sprint 3:**
- [ ] API pública documentada e funcional com rate limiting
- [ ] Auto-publish para TikTok funcional
- [ ] Sistema de créditos com reset mensal ativo
- [ ] Paywall responses com upgrade_url
- [ ] LCP < 2.5s, CLS < 0.1 (Core Web Vitals)
- [ ] Mobile responsive no editor

---

## Resumo de Horas

| Sprint | Semanas | Horas Estimadas | Foco |
|--------|---------|-----------------|------|
| Sprint 1 (MVP) | 3 | ~140h | Upload → Transcrição → Export |
| Sprint 2 (Core AI) | 4 | ~149h | Silence / Broll / Clips / Zooms |
| Sprint 3 (Scale) | 3 | ~100h | API / Publishing / Polish |
| **TOTAL** | **10** | **~389h** | — |

> Com 1 dev full-stack trabalhando ~40h/semana, são ~10 semanas (2,5 meses).

---

## Stack de Tecnologias por Sprint

```
Sprint 1 — Tecnologias Core:
✅ Next.js 14 + TypeScript
✅ NextAuth v5 (Google OAuth)
✅ Prisma v5.22 + PostgreSQL (Supabase)
✅ Cloudflare R2 + AWS S3 + CloudFront
✅ BullMQ + Upstash Redis
✅ Pusher Channels
✅ faster-whisper + Silero VAD (Modal.com)
✅ FFmpeg + libass (Docker)
✅ shadcn/ui + Tailwind CSS
✅ Zustand

Sprint 2 — Tecnologias de IA:
✅ OpenAI GPT-4o-mini (hooks + broll queries)
✅ Pexels API (B-roll stock)
✅ noisereduce (Python, clean audio)
✅ FFmpeg zoompan (magic zooms)
✅ Heurística de virality scoring

Sprint 3 — Integrações Externas:
⏳ TikTok Creator API
⏳ Instagram Graph API
⏳ YouTube Data API v3
⏳ Stripe (para pós-beta)
```

---

## Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| faster-whisper instabilidade no Modal.com | Baixa | Alto | Fallback para AssemblyAI ($0.006/min) |
| Pexels API rate limit (200 req/h free) | Média | Médio | Cache de resultados no Redis (TTL 1h) |
| FFmpeg render > 2min (timeout) | Baixa | Alto | Timeout de 600s + retry com segment menor |
| CloudFront latência alta em PT | Baixa | Médio | Edge location `sa-east-1` (São Paulo) |
| Custo GPU > previsto | Média | Médio | Monitor de custos no Modal + limite diário |
| Whisper accuracy baixa para PT-BR específico | Baixa | Médio | Dicionário de termos customizados por usuário |

---

## Referências

- [CONFIRMADO] Upload limite 2GB/2h — API Submagic
- [CONFIRMADO] 10 sprints de desenvolvimento baseados no pipeline mapeado
- [CONFIRMADO] Pexels API free tier: 200 req/h
- [DECISÃO PRÓPRIA] Modal.com A10G para GPU (vs. AWS ECS Fargate)
- [DECISÃO PRÓPRIA] Sprint order baseado em dependências técnicas

> Ver: [PRODUCT_VISION.md](./PRODUCT_VISION.md) | [ARCHITECTURE.md](./ARCHITECTURE.md) | [FEATURE_SPECS.md](./FEATURE_SPECS.md)
