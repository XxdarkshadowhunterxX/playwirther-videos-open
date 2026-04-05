# DATABASE_SCHEMA.md
**Versão:** v0.1.0 | **Data:** 2026-04-05 | **Status:** DRAFT

> Schema PostgreSQL completo via Prisma v5.22. Todos os campos confirmados via API pública do Submagic ou derivados por necessidade técnica do pipeline.

---

## Prisma Schema Completo

```prisma
// schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

// ─────────────────────────────────────────────
// ENUMS [CONFIRMADO: via API docs Submagic]
// ─────────────────────────────────────────────

enum ProjectStatus {
  uploading
  processing
  transcribing
  ready_to_edit
  exporting
  completed
  failed
}

enum WordType {
  word
  silence
  punctuation
}

enum JobType {
  transcription
  silence_removal
  bad_takes
  clean_audio
  broll_generation
  magic_zooms
  export
  magic_clips
  hook_title
}

enum JobStatus {
  queued
  processing
  completed
  failed
}

enum SilencePace {
  natural      // remove silêncios > 0.6s
  fast         // remove silêncios > 0.2s (default)
  extra_fast   // remove silêncios > 0.1s
}

enum BrollLayout {
  cover
  contain
  rounded
  square
  split_50_50
  split_35_65
  split_50_50_bordered
  split_35_65_bordered
  pip_top_right
  pip_bottom_right
}

enum BrollItemType {
  user_media
  ai_broll
}

enum UserMediaType {
  VIDEO
  IMAGE
  AUDIO
}

enum UserMediaStatus {
  uploading
  ready
  failed
}

enum MagicClipStatus {
  processing
  completed
  failed
}

enum Plan {
  free
  pro
  business
}

enum SubscriptionStatus {
  active
  canceled
  past_due
  trialing
}

// ─────────────────────────────────────────────
// TABELA: users
// [CONFIRMADO: brenonawa18@gmail.com — conta observada]
// ─────────────────────────────────────────────

model User {
  id            String   @id @default(uuid())
  email         String   @unique
  name          String?
  image         String?
  emailVerified DateTime?

  // Relações
  accounts      Account[]
  sessions      Session[]
  projects      Project[]
  userMedia     UserMedia[]
  subscription  Subscription?
  creditsLedger CreditsLedger[]
  apiKeys       ApiKey[]
  teamMembers   TeamMember[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([email])
}

// ─────────────────────────────────────────────
// NextAuth v5 required tables
// ─────────────────────────────────────────────

model Account {
  id                String  @id @default(uuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@index([userId])
}

model Session {
  id           String   @id @default(uuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}

// ─────────────────────────────────────────────
// TABELA: teams
// [DECISÃO PRÓPRIA: workspace para uso futuro]
// ─────────────────────────────────────────────

model Team {
  id        String   @id @default(uuid())
  name      String
  slug      String   @unique
  ownerId   String

  members   TeamMember[]
  projects  Project[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([slug])
  @@index([ownerId])
}

model TeamMember {
  id     String @id @default(uuid())
  userId String
  teamId String
  role   String @default("member") // owner | admin | member

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  team Team @relation(fields: [teamId], references: [id], onDelete: Cascade)

  joinedAt DateTime @default(now())

  @@unique([userId, teamId])
}

// ─────────────────────────────────────────────
// TABELA: projects
// [CONFIRMADO: schema completo via API Submagic]
// ─────────────────────────────────────────────

model Project {
  id     String @id @default(uuid())
  userId String
  teamId String?

  title    String        @db.VarChar(100)
  language String        @db.VarChar(10) // ex: "pt", "en", "es"
  status   ProjectStatus @default(uploading)

  // Template / Estilo
  templateName   String? @db.VarChar(100) // ex: "Karl", "Hormozi 2"
  userThemeId    String?
  presetId       String?
  aiEditTemplate String? // kelly | karl | ella | NULL

  // Opções de processamento [CONFIRMADO: parâmetros createProject]
  magicZooms              Boolean @default(false)
  magicBrolls             Boolean @default(false)
  magicBrollsPercentage   Int     @default(50)
  removeSilencePace       SilencePace?
  removeBadTakes          Boolean @default(false)
  cleanAudio              Boolean @default(false)
  disableCaptions         Boolean @default(false)
  hookTitle               Json?   // { text?, template?, top?, size? } | true | null

  // Links de integração
  webhookUrl    String? @db.Text
  failureReason String? @db.Text

  // Metadados do vídeo (extraídos pelo cliente via MediaInfoModule.wasm)
  videoWidth    Int?
  videoHeight   Int?
  videoDuration Float?  // segundos
  videoFps      Int?
  videoCodec    String?
  videoSize     BigInt? // bytes

  // URLs [CONFIRMADO: dual storage R2 + S3/CloudFront]
  sourceKey    String? @db.Text // R2 key do input original
  outputKey    String? @db.Text // S3 key do output renderizado
  downloadUrl  String? @db.Text // S3 signed URL (temporária)
  directUrl    String? @db.Text // CloudFront URL (permanente)
  previewUrl   String? @db.Text // versão comprimida para editor

  // Relações
  user         User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  team         Team?         @relation(fields: [teamId], references: [id])
  userTheme    Theme?        @relation(fields: [userThemeId], references: [id])
  preset       Preset?       @relation(fields: [presetId], references: [id])
  words        Word[]
  projectItems ProjectItem[]
  jobs         Job[]
  magicClips   MagicClip[]
  music        ProjectMusic?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
  @@index([teamId])
  @@index([status])
  @@index([userId, createdAt(sort: Desc)])
}

// ─────────────────────────────────────────────
// TABELA: words
// [CONFIRMADO: schema { id, text, type, startTime, endTime }]
// ─────────────────────────────────────────────

model Word {
  id        String  @id @default(uuid())
  projectId String

  text       String   @db.Text  // empty string para silences
  type       WordType            // word | silence | punctuation
  startTime  Float               // segundos (float)
  endTime    Float               // segundos (float)
  confidence Float?              // 0.0–1.0 (Whisper confidence)
  isFiller   Boolean @default(false) // "ahn", "né", "tipo", etc.
  isRemoved  Boolean @default(false) // soft delete — preserve para undo

  position   Int                 // ordem na transcrição (0-indexed)

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId])
  @@index([projectId, position])
  @@index([projectId, type])
  @@index([projectId, isRemoved])
}

// ─────────────────────────────────────────────
// TABELA: project_items (B-roll e user-media overlays)
// [CONFIRMADO: schema brolls[] via API docs]
// ─────────────────────────────────────────────

model ProjectItem {
  id        String @id @default(uuid())
  projectId String

  type        BrollItemType  // user_media | ai_broll
  startTime   Float          // segundos
  endTime     Float          // máximo 12s para ai_broll [CONFIRMADO]
  layout      BrollLayout    @default(cover)

  // Para ai_broll
  prompt    String? @db.VarChar(2500)    // query gerada pelo GPT-4o-mini
  assetUrl  String? @db.Text            // URL Pexels resolvida

  // Para user_media
  userMediaId String?

  creditsConsumed Int @default(0)       // 3 créditos por ai-broll [CONFIRMADO]

  project   Project    @relation(fields: [projectId], references: [id], onDelete: Cascade)
  userMedia UserMedia? @relation(fields: [userMediaId], references: [id])

  createdAt DateTime @default(now())

  @@index([projectId])
  @@index([projectId, startTime])
}

// ─────────────────────────────────────────────
// TABELA: jobs
// [CONFIRMADO: job types via API Submagic]
// ─────────────────────────────────────────────

model Job {
  id        String @id @default(uuid())
  projectId String

  type          JobType
  status        JobStatus @default(queued)
  progress      Int       @default(0)  // 0–100
  bullmqJobId   String?                // ID do job no BullMQ
  errorMessage  String?   @db.Text
  retryCount    Int       @default(0)

  startedAt   DateTime?
  completedAt DateTime?
  createdAt   DateTime  @default(now())

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId])
  @@index([status])
  @@index([projectId, type])
}

// ─────────────────────────────────────────────
// TABELA: magic_clips
// [CONFIRMADO: viralityScores via webhook docs]
// ─────────────────────────────────────────────

model MagicClip {
  id        String @id @default(uuid())
  projectId String

  title    String? @db.Text           // AI-generated
  duration Float                       // segundos do clip
  status   MagicClipStatus @default(processing)

  // Virality scores 0–100 [CONFIRMADO: schema webhook]
  viralityTotal            Int?
  viralityShareability     Int?
  viralityHookStrength     Int?
  viralityStoryQuality     Int?
  viralityEmotionalImpact  Int?

  startTime Float  // timestamp de início no vídeo original
  endTime   Float  // timestamp de fim no vídeo original

  // configurações do clip
  faceTracking Boolean @default(false) // [CONFIRMADO: parâmetro magic-clips]

  previewUrl  String? @db.Text
  downloadUrl String? @db.Text
  directUrl   String? @db.Text

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  createdAt DateTime @default(now())

  @@index([projectId])
  @@index([projectId, viralityTotal(sort: Desc)])
}

// ─────────────────────────────────────────────
// TABELA: user_media
// [CONFIRMADO: POST /v1/user-media endpoint]
// ─────────────────────────────────────────────

model UserMedia {
  id     String @id @default(uuid())
  userId String

  type         UserMediaType
  name         String        @db.VarChar(255)
  originalUrl  String        @db.Text          // URL de origem (se por URL)
  processedUrl String?       @db.Text          // S3 URL após processamento
  s3Key        String?       @db.Text
  fileSize     BigInt?
  duration     Float?                           // segundos (para vídeo/áudio)
  mimeType     String?
  status       UserMediaStatus @default(uploading)

  user         User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  projectItems ProjectItem[]
  projectMusic ProjectMusic[]

  createdAt DateTime @default(now())

  @@index([userId])
  @@index([userId, type])
}

// ─────────────────────────────────────────────
// TABELA: project_music
// [CONFIRMADO: parâmetro "music" no createProject]
// ─────────────────────────────────────────────

model ProjectMusic {
  id          String @id @default(uuid())
  projectId   String @unique
  userMediaId String?

  volume        Int     @default(30)   // 0–100
  startFromTime Float   @default(0)    // segundos
  fade          Boolean @default(true) // fade in/out

  project   Project    @relation(fields: [projectId], references: [id], onDelete: Cascade)
  userMedia UserMedia? @relation(fields: [userMediaId], references: [id])
}

// ─────────────────────────────────────────────
// TABELA: subscriptions
// [DECISÃO PRÓPRIA: para uso pós-beta]
// ─────────────────────────────────────────────

model Subscription {
  id     String @id @default(uuid())
  userId String @unique

  plan               Plan               @default(free)
  status             SubscriptionStatus @default(active)
  stripeSubId        String?            @unique
  stripeCustomerId   String?

  creditsTotal      Int @default(0)
  creditsUsed       Int @default(0)
  creditsResetAt    DateTime?
  currentPeriodEnd  DateTime?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
}

// ─────────────────────────────────────────────
// TABELA: credits_ledger (append-only)
// [CONFIRMADO: 3 créditos por ai-broll item]
// ─────────────────────────────────────────────

model CreditsLedger {
  id     String @id @default(uuid())
  userId String

  amount       Int    // positivo = recarga, negativo = consumo
  operation    String @db.VarChar(100) // ex: "ai_broll_generation", "monthly_reset"
  projectId    String?
  description  String? @db.Text
  balanceAfter Int     // saldo após a operação (snapshot)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  createdAt DateTime @default(now())

  // Imutável: nenhum UPDATE permitido (append-only)
  @@index([userId])
  @@index([userId, createdAt(sort: Desc)])
  @@index([projectId])
}

// ─────────────────────────────────────────────
// TABELA: presets (templates pré-configurados)
// [CONFIRMADO: GET /v1/templates endpoint]
// ─────────────────────────────────────────────

model Preset {
  id          String @id @default(uuid())
  name        String @unique @db.VarChar(100) // ex: "Karl", "Hormozi 2"
  displayName String @db.VarChar(100)
  isDefault   Boolean @default(false)
  isPremium   Boolean @default(false)
  category    String? @db.VarChar(50)         // trend | new | emoji | premium | speakers

  // Configuração tipográfica
  fontFamily  String  @db.VarChar(100)         // ex: "Montserrat"
  fontWeight  Int     @default(700)
  fontSize    Int     @default(36)             // px
  fontStyle   String  @default("normal")

  // Cores
  textColor        String @default("#FFFFFF")  // hex
  highlightColor   String @default("#FF6B00")  // hex (palavra em destaque)
  backgroundColor  String @default("transparent")

  // Efeitos
  shadowEnabled Boolean @default(true)
  shadowColor   String  @default("#000000")
  shadowBlur    Int     @default(4)
  shadowOffsetX Int     @default(2)
  shadowOffsetY Int     @default(2)
  outlineEnabled Boolean @default(false)
  outlineColor   String? @default("#000000")
  outlineWidth   Int?    @default(2)

  // Posição padrão
  positionX Int @default(50) // % horizontal
  positionY Int @default(55) // % vertical

  // Comportamento
  animation    String? // null | "fade" | "pop"
  emojiEnabled Boolean @default(false)

  previewImageUrl String? @db.Text

  projects Project[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([name])
  @@index([isPremium])
}

// ─────────────────────────────────────────────
// TABELA: themes (customização por projeto)
// [DECISÃO PRÓPRIA: customização além do preset]
// ─────────────────────────────────────────────

model Theme {
  id     String @id @default(uuid())
  userId String?

  name         String?  @db.VarChar(100)
  basedOnPreset String? // nome do preset base

  fontFamily  String  @db.VarChar(100)
  fontWeight  Int
  fontSize    Int
  textColor   String
  highlightColor String
  backgroundColor String
  shadowEnabled Boolean @default(true)
  shadowColor String
  positionX Int
  positionY Int
  animation String?
  emojiEnabled Boolean @default(false)

  projects Project[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
}

// ─────────────────────────────────────────────
// TABELA: api_keys (API pública)
// [CONFIRMADO: auth via x-api-key header]
// ─────────────────────────────────────────────

model ApiKey {
  id     String @id @default(uuid())
  userId String

  name      String @db.VarChar(100)
  keyHash   String @unique            // bcrypt hash da chave
  keyPrefix String @db.VarChar(8)    // ex: "sk_live_" para exibição
  lastUsed  DateTime?
  isActive  Boolean @default(true)
  expiresAt DateTime?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  createdAt DateTime @default(now())

  @@index([userId])
  @@index([keyHash])
}
```

---

## Índices e Performance

```sql
-- Índices críticos para queries frequentes

-- Listar projetos do usuário (dashboard)
CREATE INDEX idx_projects_user_created
  ON projects(user_id, created_at DESC)
  WHERE status != 'failed';

-- Polling de status de projeto
CREATE INDEX idx_projects_status
  ON projects(id, status);

-- Words de um projeto por posição (editor)
CREATE INDEX idx_words_project_position
  ON words(project_id, position);

-- Words ativas (não removidas) de um projeto
CREATE INDEX idx_words_active
  ON words(project_id, is_removed)
  WHERE is_removed = false;

-- Jobs por projeto e status (polling)
CREATE INDEX idx_jobs_project_status
  ON jobs(project_id, status);

-- Ledger por usuário cronológico
CREATE INDEX idx_ledger_user_date
  ON credits_ledger(user_id, created_at DESC);

-- Magic clips por virality (ranking)
CREATE INDEX idx_magic_clips_virality
  ON magic_clips(project_id, virality_total DESC NULLS LAST);
```

---

## RLS Policies (Row Level Security)

```sql
-- Habilitar RLS em todas as tabelas sensíveis
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE words ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE magic_clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE credits_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Usuário só vê seus próprios projetos
CREATE POLICY "users_own_projects" ON projects
  USING (user_id = auth.uid());

-- Usuário só vê words dos seus projetos
CREATE POLICY "users_own_words" ON words
  USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id = auth.uid()
    )
  );

-- Usuário só vê seus próprios créditos (append-only, sem UPDATE)
CREATE POLICY "users_own_credits_read" ON credits_ledger
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "credits_insert_only" ON credits_ledger
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Sem UPDATE ou DELETE no ledger
-- (enforced via Prisma: só writeRaw com INSERT)
```

---

## Migrations de Inicialização

### Seed: Presets Padrão

```typescript
// prisma/seed.ts
const presets = [
  {
    name: "Karl",
    displayName: "Karl",
    fontFamily: "Montserrat",
    fontWeight: 900,
    fontSize: 36,
    textColor: "#FFFFFF",
    highlightColor: "#FF6B00",
    backgroundColor: "transparent",
    shadowEnabled: true,
    shadowColor: "#000000",
    shadowBlur: 4,
    shadowOffsetX: 2,
    shadowOffsetY: 2,
    positionX: 50,
    positionY: 55,
    isDefault: true,
    isPremium: false,
    category: "trend",
  },
  {
    name: "Hormozi 2",
    displayName: "Hormozi 2",
    fontFamily: "Oswald",
    fontWeight: 700,
    fontSize: 40,
    textColor: "#FFFF00",
    highlightColor: "#FFFFFF",
    backgroundColor: "#000000",
    shadowEnabled: false,
    positionX: 50,
    positionY: 55,
    isPremium: true,
    category: "premium",
  },
  // ... outros templates mapeados no Submagic
];
```

---

## Referências

- [CONFIRMADO] Schema `words[]`: `{ id, text, type, startTime, endTime }` — API docs Submagic
- [CONFIRMADO] `project_items` layout options: docs Submagic B-roll
- [CONFIRMADO] `credits_ledger`: 3 créditos por ai-broll — API Submagic
- [CONFIRMADO] `magic_clips.viralityScores`: webhook response Submagic
- [CONFIRMADO] Project status flow: `processing → transcribing → ready_to_edit → exporting → completed | failed`
- [DECISÃO PRÓPRIA] Soft delete em `words.isRemoved` para suporte a undo

> Ver: [API_SPECIFICATION.md](./API_SPECIFICATION.md) | [VIDEO_PIPELINE.md](./VIDEO_PIPELINE.md)
