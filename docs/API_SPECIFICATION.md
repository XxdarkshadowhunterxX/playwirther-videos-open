# API_SPECIFICATION.md
**Versão:** v0.1.0 | **Data:** 2026-04-05 | **Status:** DRAFT

> API REST interna do [NOME_DO_PRODUTO]. Modelada sobre os 14 endpoints confirmados do Submagic, adaptada para uso interno.
> **Base URL:** `https://[DOMINIO].com/api`
> **Auth:** `Authorization: Bearer <session_token>` (interno) | `x-api-key: <key>` (API pública)

---

## Autenticação

```http
# Interno (web app via NextAuth session cookie)
Cookie: next-auth.session-token=...

# API pública (programático)
x-api-key: sk_live_xxxxxxxxxxxxxxxx
```

**Rate limits:**
- Interno: 200 req/min por usuário
- API pública: 60 req/min por API key

---

## Error Response Padrão

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Descrição legível do erro",
    "field": "videoUrl",        // opcional
    "details": {}               // opcional
  }
}
```

**Códigos de erro:**

| Code | HTTP | Descrição |
|------|------|-----------|
| `UNAUTHORIZED` | 401 | Sem autenticação válida |
| `FORBIDDEN` | 403 | Sem permissão para o recurso |
| `NOT_FOUND` | 404 | Recurso não encontrado |
| `VALIDATION_ERROR` | 422 | Dados inválidos no payload |
| `INSUFFICIENT_CREDITS` | 402 | [CONFIRMADO: Submagic retorna 402] |
| `RATE_LIMIT_EXCEEDED` | 429 | Rate limit atingido |
| `FILE_TOO_LARGE` | 413 | Arquivo acima de 2GB [CONFIRMADO] |
| `UNSUPPORTED_FORMAT` | 415 | Formato diferente de MP4/MOV [CONFIRMADO] |
| `PROCESSING_FAILED` | 500 | Falha no pipeline de IA |
| `INTERNAL_ERROR` | 500 | Erro interno do servidor |

---

## Endpoints

### 1. Health

```http
GET /api/health
```

**Response 200:**
```json
{
  "status": "ok",
  "version": "0.1.0",
  "timestamp": "2026-04-05T03:30:00Z",
  "services": {
    "database": "ok",
    "redis": "ok",
    "s3": "ok",
    "pusher": "ok"
  }
}
```

---

### 2. Languages

```http
GET /api/languages
```

**Response 200:**
```json
{
  "languages": [
    { "code": "pt", "name": "Português (BR)", "flag": "🇧🇷", "default": true },
    { "code": "en", "name": "English", "flag": "🇺🇸" },
    { "code": "es", "name": "Español", "flag": "🇪🇸" }
  ]
}
```

---

### 3. Templates (Presets de Caption)

```http
GET /api/templates
```

**Response 200:**
```json
{
  "templates": [
    {
      "id": "uuid",
      "name": "Karl",
      "displayName": "Karl",
      "isPremium": false,
      "category": "trend",
      "previewImageUrl": "https://cdn.[DOMINIO].com/templates/karl.png",
      "style": {
        "fontFamily": "Montserrat",
        "fontWeight": 900,
        "fontSize": 36,
        "textColor": "#FFFFFF",
        "highlightColor": "#FF6B00"
      }
    }
  ]
}
```

---

### 4. Hook Title Templates

```http
GET /api/hook-title-templates
```

**Response 200:**
```json
{
  "templates": [
    {
      "id": "uuid",
      "name": "tiktok",
      "displayName": "TikTok Style",
      "previewUrl": "https://cdn.[DOMINIO].com/hooks/tiktok.png"
    }
  ]
}
```

---

### 5. Upload — Gerar Presigned URL

```http
POST /api/upload/presign
Content-Type: application/json
Authorization: Bearer <token>

{
  "filename": "marcio-jr-14.mp4",
  "contentType": "video/mp4",
  "fileSize": 171810122,
  "duration": 62.5,
  "width": 1080,
  "height": 1920,
  "fps": 30,
  "codec": "h264"
}
```

**Validações:**
- `fileSize` ≤ 2.147.483.648 (2GB) [CONFIRMADO]
- `contentType` deve ser `video/mp4` ou `video/quicktime` [CONFIRMADO]
- `duration` ≤ 7200 (2h) [CONFIRMADO]

**Response 200:**
```json
{
  "uploadId": "r2-multipart-id",
  "key": "inputs/user-uuid/project-uuid/original.mp4",
  "parts": [
    {
      "partNumber": 1,
      "url": "https://{bucket}.r2.cloudflarestorage.com/...?partNumber=1&uploadId=..."
    }
  ],
  "expiresAt": "2026-04-05T04:30:00Z"
}
```

---

### 6. Upload — Completar Multipart

```http
POST /api/upload/complete
Content-Type: application/json

{
  "uploadId": "r2-multipart-id",
  "key": "inputs/user-uuid/project-uuid/original.mp4",
  "parts": [
    { "partNumber": 1, "etag": "\"abc123\"" },
    { "partNumber": 2, "etag": "\"def456\"" }
  ]
}
```

**Response 200:**
```json
{
  "key": "inputs/user-uuid/project-uuid/original.mp4",
  "url": "https://r2.../inputs/...",
  "size": 171810122
}
```

---

### 7. Projects — Criar

```http
POST /api/projects
Content-Type: application/json

{
  "title": "Vídeo Marcio Jr 14",
  "language": "pt",
  "sourceKey": "inputs/user-uuid/project-uuid/original.mp4",
  "videoWidth": 1080,
  "videoHeight": 1920,
  "videoDuration": 62.5,
  "videoFps": 30,
  "videoSize": 171810122,
  "templateName": "Karl",
  "webhookUrl": "https://yoursite.com/webhook",
  "dictionary": ["palavra1", "termoEspecifico"],
  "magicZooms": true,
  "magicBrolls": false,
  "magicBrollsPercentage": 50,
  "removeSilencePace": "fast",
  "removeBadTakes": true,
  "cleanAudio": true,
  "disableCaptions": false,
  "hookTitle": {
    "text": "Nunca mais erre isso...",
    "template": "tiktok",
    "top": 45,
    "size": 32
  },
  "music": {
    "userMediaId": "uuid",
    "volume": 30,
    "startFromTime": 0,
    "fade": true
  }
}
```

**Response 201:**
```json
{
  "id": "proj-uuid",
  "title": "Vídeo Marcio Jr 14",
  "status": "processing",
  "language": "pt",
  "templateName": "Karl",
  "videoWidth": 1080,
  "videoHeight": 1920,
  "videoDuration": 62.5,
  "createdAt": "2026-04-05T03:30:00Z"
}
```

---

### 8. Projects — Criar por Upload Direto

```http
POST /api/projects/upload
Content-Type: multipart/form-data

file=@./video.mp4
title=Vídeo Marcio Jr 14
language=pt
templateName=Karl
removeSilencePace=fast
```

**Response 201:** Igual ao endpoint 7.

---

### 9. Projects — Listar

```http
GET /api/projects?page=1&limit=20&status=completed
Authorization: Bearer <token>
```

**Query params:**
- `page`: número da página (default: 1)
- `limit`: itens por página (default: 20, max: 100)
- `status`: filtrar por status
- `search`: busca por título

**Response 200:**
```json
{
  "projects": [
    {
      "id": "proj-uuid",
      "title": "Vídeo Marcio Jr 14",
      "status": "completed",
      "templateName": "Karl",
      "videoDuration": 62.5,
      "thumbnailUrl": "https://cdn.../thumbnail.jpg",
      "directUrl": "https://dqu1p08d61fh.cloudfront.net/...",
      "createdAt": "2026-04-05T03:30:00Z",
      "updatedAt": "2026-04-05T03:33:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 42,
    "totalPages": 3
  }
}
```

---

### 10. Projects — Buscar por ID

```http
GET /api/projects/:id
```

**Response 200:**
```json
{
  "id": "proj-uuid",
  "title": "Vídeo Marcio Jr 14",
  "status": "completed",
  "language": "pt",
  "templateName": "Karl",
  "videoWidth": 1080,
  "videoHeight": 1920,
  "videoDuration": 62.5,
  "videoFps": 30,
  "magicZooms": true,
  "magicBrolls": false,
  "removeSilencePace": "fast",
  "removeBadTakes": true,
  "cleanAudio": true,
  "downloadUrl": "https://app.[DOMINIO].com/download/signed-token",
  "directUrl": "https://dqu1p08d61fh.cloudfront.net/outputs/...",
  "previewUrl": "https://dqu1p08d61fh.cloudfront.net/previews/...",
  "words": [
    {
      "id": "word-uuid",
      "text": "Escritório",
      "type": "word",
      "startTime": 0.0,
      "endTime": 0.84,
      "confidence": 0.97,
      "isFiller": false,
      "isRemoved": false,
      "position": 0
    },
    {
      "id": "word-uuid-2",
      "text": "",
      "type": "silence",
      "startTime": 0.84,
      "endTime": 1.10,
      "confidence": null,
      "isFiller": false,
      "isRemoved": false,
      "position": 1
    }
  ],
  "projectItems": [],
  "jobs": [
    {
      "id": "job-uuid",
      "type": "transcription",
      "status": "completed",
      "progress": 100,
      "completedAt": "2026-04-05T03:31:30Z"
    }
  ],
  "transcriptionStatus": "COMPLETED",
  "createdAt": "2026-04-05T03:30:00Z",
  "updatedAt": "2026-04-05T03:33:00Z"
}
```

---

### 11. Projects — Atualizar

```http
PUT /api/projects/:id
Content-Type: application/json

{
  "title": "Novo título",
  "templateName": "Hormozi 2",
  "words": [
    { "id": "word-uuid", "isRemoved": true },
    { "id": "word-uuid-2", "text": "Novo texto" }
  ]
}
```

**Response 200:** Projeto atualizado completo.

---

### 12. Projects — Deletar

```http
DELETE /api/projects/:id
```

**Response 204:** No content. Deleta projeto, words, jobs e assets S3.

---

### 13. Export — Disparar Rendering

```http
POST /api/projects/:id/export
Content-Type: application/json

{
  "resolution": "1080p"
}
```

**Response 202:**
```json
{
  "status": "exporting",
  "jobId": "job-uuid",
  "estimatedSeconds": 45
}
```

**Webhook de conclusão** (POST para `project.webhookUrl`):
```json
{
  "projectId": "proj-uuid",
  "status": "completed",
  "downloadUrl": "https://app.[DOMINIO].com/download/signed-token",
  "directUrl": "https://dqu1p08d61fh.cloudfront.net/outputs/...",
  "timestamp": "2026-04-05T03:33:00Z"
}
```

---

### 14. Magic Clips — Criar por URL

```http
POST /api/projects/magic-clips
Content-Type: application/json

{
  "title": "Podcast Episódio 47",
  "language": "pt",
  "videoUrl": "https://...",
  "templateName": "Karl",
  "minClipLength": 30,
  "maxClipLength": 90,
  "faceTracking": true,
  "webhookUrl": "https://yoursite.com/webhook"
}
```

**Response 201:**
```json
{
  "id": "proj-uuid",
  "status": "processing"
}
```

**Webhook de conclusão:**
```json
{
  "projectId": "proj-uuid",
  "status": "completed",
  "clips": [
    {
      "id": "clip-uuid",
      "title": "Título Gerado pela IA",
      "duration": 47.3,
      "startTime": 125.0,
      "endTime": 172.3,
      "downloadUrl": "https://...",
      "directUrl": "https://dqu1p08d61fh.cloudfront.net/...",
      "viralityScores": {
        "total": 87,
        "shareability": 90,
        "hook_strength": 82,
        "story_quality": 85,
        "emotional_impact": 91
      }
    }
  ]
}
```

---

### 15. User Media — Listar

```http
GET /api/user-media?type=VIDEO&page=1&limit=20
```

**Response 200:**
```json
{
  "media": [
    {
      "id": "media-uuid",
      "type": "VIDEO",
      "name": "intro.mp4",
      "processedUrl": "https://...",
      "fileSize": 5242880,
      "duration": 8.5,
      "status": "ready",
      "createdAt": "2026-04-05T01:00:00Z"
    }
  ]
}
```

---

### 16. User Media — Upload por URL

```http
POST /api/user-media
Content-Type: application/json

{
  "url": "https://example.com/video.mp4",
  "name": "meu-broll.mp4",
  "type": "VIDEO"
}
```

**Response 201:**
```json
{
  "id": "media-uuid",
  "status": "uploading",
  "name": "meu-broll.mp4"
}
```

---

### 17. User Media — Upload Direto

```http
POST /api/user-media/upload
Content-Type: multipart/form-data

file=@./broll.mp4
name=meu-broll.mp4
type=VIDEO
```

**Response 201:** Igual ao endpoint 16.

---

### 18. Pusher — Auth de Channel Privado

```http
POST /api/pusher/auth
Content-Type: application/json

{
  "socket_id": "123.456",
  "channel_name": "private-user-user-uuid"
}
```

**Response 200:**
```json
{
  "auth": "pusher-auth-signature"
}
```

---

## Eventos Pusher

**Channel:** `private-user-{userId}`

| Evento | Payload | Quando |
|--------|---------|--------|
| `project.status.updated` | `{ projectId, status, previousStatus }` | A cada transição de status |
| `transcription.completed` | `{ projectId, wordCount, accuracy, language }` | Transcrição concluída |
| `transcription.failed` | `{ projectId, error }` | Falha na transcrição |
| `job.progress` | `{ projectId, jobType, progress: 0-100 }` | Progresso do job |
| `export.completed` | `{ projectId, downloadUrl, directUrl }` | Export concluído [CONFIRMADO] |
| `export.failed` | `{ projectId, error }` | Falha no export |
| `magic_clips.completed` | `{ projectId, clips[] }` | Magic Clips prontos |

---

## Referências

- [CONFIRMADO] 14 endpoints públicos Submagic: `GET /health`, `GET /languages`, `GET /templates`, `GET /hook-title-templates`, `GET /user-media`, `POST /user-media`, `POST /user-media/upload`, `POST /projects`, `POST /projects/upload`, `POST /projects/magic-clips`, `POST /projects/magic-clips/upload`, `GET /projects/{id}`, `PUT /projects/{id}`, `POST /projects/{id}/export`
- [CONFIRMADO] Webhook response: `{ projectId, status, downloadUrl, directUrl, timestamp }`
- [CONFIRMADO] `viralityScores` schema: `{ total, shareability, hook_strength, story_quality, emotional_impact }`

> Ver: [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | [JOBS_SYSTEM.md](./JOBS_SYSTEM.md) | [VIDEO_PIPELINE.md](./VIDEO_PIPELINE.md)
