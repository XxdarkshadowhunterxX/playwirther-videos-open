# PRODUCT_VISION.md
**Versão:** v0.1.0 | **Data:** 2026-04-05 | **Status:** DRAFT

---

## 1. Visão do Produto

**[NOME_DO_PRODUTO]** é uma plataforma SaaS de edição de vídeo com IA focada em criadores de conteúdo em português brasileiro. A plataforma processa vídeos falados automaticamente — removendo silêncios, gerando legendas animadas, inserindo B-roll e exportando clipes prontos para TikTok, Reels e Shorts — tudo sem conhecimento técnico de edição.

> **Missão:** Transformar qualquer gravação bruta em conteúdo viral em menos de 3 minutos.

---

## 2. Público-Alvo

| Segmento | Perfil | Dor Principal |
|----------|--------|---------------|
| **Criador Solo PT-BR** | 10k–500k seguidores, publica 3–7x/semana | Edição manual consome 2–4h por vídeo |
| **Ghostwriter de Conteúdo** | Edita para 3–10 clientes simultaneamente | Volume de projetos vs. tempo disponível |
| **Profissional de Saúde/Direito** | Grava tutoriais e explicações longas | Não tem habilidade técnica de edição |
| **Agência de Marketing** | Produz conteúdo para múltiplas marcas | Custo de edição inviabiliza escala |
| **Usuário de YouTube** | Vídeos de 10–60 min, precisa de clipes | Magic Clips para cortar highlights automaticamente |
| **Creator de Podcast** | Áudio/vídeo longo, precisa de clips < 90s | Identificação automática de momentos virais |

> **Evidência:** Segmentos inferidos do comportamento da base de 4M+ usuários do Submagic [INFERIDO via posicionamento de marketing público].

---

## 3. Proposta de Valor

### 3.1 Core Value Props

1. **Captions Animadas em PT-BR** — Transcrição com 98%+ de accuracy em português usando faster-whisper Large V3, com highlight palavra-por-palavra via formato ASS karaoke [CONFIRMADO: resultado de teste com `marcio jr 14.mp4`]
2. **Silêncio Zero** — Remoção automática de silêncios em 3 velocidades calibradas (0.1s / 0.2s / 0.6s de threshold) [CONFIRMADO: docs `removeSilencePace`]
3. **B-Roll Automático** — IA gera query contextual e busca no Pexels automaticamente [CONFIRMADO: Pexels mencionado explicitamente no FAQ do Submagic]
4. **Magic Clips** — Corta os melhores momentos de vídeos longos com score de viralidade 5D [CONFIRMADO: schema `viralityScores` no webhook]
5. **Export em 1 Clique** — Pipeline server-side completo, entrega via CloudFront CDN [CONFIRMADO: `directUrl` aponta para `dqu1p08d61fh.cloudfront.net`]

### 3.2 Diferencial vs. Submagic

| Funcionalidade | Submagic | [NOME_DO_PRODUTO] |
|---|---|---|
| Foco em PT-BR | Secundário (100+ idiomas) | **Principal** — otimizado para PT-BR |
| Modelo de acesso Beta | Trial de 3 vídeos | **Acesso gratuito** durante beta |
| Filler words PT-BR | Genérico | Dicionário expandido ("ahn", "né", "tipo", "então", "cara") |
| Integração direta | Não | [DECISÃO PRÓPRIA] |
| Onboarding | Wizard genérico | Tour orientado ao caso de uso PT-BR |
| Suporte | Chat (Crisp) | Suporte em português nativo |

---

## 4. Modelo de Acesso (Beta)

> **Decisão:** Sem cobrança durante o período beta. Acesso gratuito a todas as features para validar o produto com usuários reais.
> **Motivo:** Construir base de usuários e feedback antes de definir preços. [DECISÃO PRÓPRIA]

```
Beta → [ usuários gratuitos ilimitados ] → Coleta de feedback → Definição de planos pagos
```

Limites técnicos durante beta (não por plano, mas por infraestrutura):
- Upload máximo: 2GB / 2 horas [CONFIRMADO: limite da API Submagic]
- Formatos aceitos: MP4 e MOV apenas [CONFIRMADO: docs API]
- Watermark: removida durante beta para não prejudicar adoção
- Processamento: fila única com concorrência controlada

---

## 5. Roadmap de 3 Fases

### Fase 1 — MVP (Sprint 1) ~3 semanas
**Objetivo:** Pipeline funcional end-to-end com as features core.

- [ ] Upload de vídeo (MP4/MOV até 2GB) via S3 presigned URL
- [ ] Transcrição PT-BR (faster-whisper + Silero VAD)
- [ ] Editor de captions com preview Canvas 2D
- [ ] Remoção de silêncios (3 velocidades)
- [ ] Export com burn-in de legendas (FFmpeg + libass)
- [ ] Autenticação (NextAuth v5 — Google OAuth)
- [ ] Dashboard de projetos
- [ ] Realtime progress via Pusher

**Critério de sucesso:** Usuário consegue ir do upload ao vídeo exportado com captions em < 5 minutos.

### Fase 2 — Core AI (Sprint 2) ~4 semanas
**Objetivo:** Features de IA que diferenciam o produto.

- [ ] B-roll automático (GPT-4o-mini + Pexels API) [4 layouts]
- [ ] Remove bad takes (Whisper confidence < 0.6)
- [ ] Clean audio (denoising via noisereduce)
- [ ] Magic Clips com virality scoring 5D
- [ ] Hook Title automático (GPT-4o-mini)
- [ ] Música de fundo (upload de user media)
- [ ] Magic Zooms automáticos
- [ ] Templates de caption (Karl, Hormozi, Sara, etc.)

**Critério de sucesso:** Taxa de retenção D7 > 40% entre usuários beta.

### Fase 3 — Scale (Sprint 3) ~3 semanas
**Objetivo:** Preparar para monetização e crescimento.

- [ ] API pública com `x-api-key`
- [ ] Team workspace (colaboração)
- [ ] Auto-publish (TikTok, Instagram, YouTube)
- [ ] Video translator (PT-BR ↔ EN ↔ ES)
- [ ] Eye contact correction (IA)
- [ ] AI Avatars
- [ ] Analytics de performance por vídeo
- [ ] Sistema de créditos e planos pagos
- [ ] Webhook system para integrações

**Critério de sucesso:** Primeiros 100 usuários pagantes pós-beta.

---

## 6. Métricas de Sucesso

| Métrica | Meta Beta | Meta Pós-Beta |
|---------|-----------|---------------|
| Usuários ativos/mês | 500 | 5.000 |
| Vídeos processados/mês | 2.000 | 20.000 |
| Tempo médio de processamento | < 3 min/min de vídeo | < 2 min/min |
| NPS | > 40 | > 60 |
| Taxa de retenção D7 | > 30% | > 45% |
| Custo por vídeo (infra) | < $0.17 | < $0.10 |

---

## 7. Posicionamento de Mercado

```
Complexidade técnica
        ↑
        │  Adobe Premiere Pro
        │  DaVinci Resolve
        │
        │              Descript
        │
        │    Submagic ● ← [NOME_DO_PRODUTO] (PT-BR focus)
        │
        │ CapCut
        │
        └──────────────────────────────→ Automação com IA
         Manual                          Automático
```

**Posição:** Alto nível de automação com IA, baixa curva de aprendizado, foco absoluto em PT-BR e conteúdo de formato curto (< 3 min).

---

## Referências

- Engenharia reversa do Submagic (2026-04-05): `submagic_reverse_engineering_report.md`
- Documentação pública da API Submagic: `https://docs.submagic.co/api-reference/`
- Teste com vídeo `marcio jr 14.mp4` (PT-BR, 171MB): accuracy 98.41% [CONFIRMADO]
- Schema de viralityScores: [CONFIRMADO via webhook docs Submagic]
- Limite de upload 2GB/2h: [CONFIRMADO via docs API Submagic]

> Ver: [ARCHITECTURE.md](./ARCHITECTURE.md) | [DEVELOPMENT_ROADMAP.md](./DEVELOPMENT_ROADMAP.md)
