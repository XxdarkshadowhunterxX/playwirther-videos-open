# CREDITS_SYSTEM.md
**Versão:** v0.1.0 | **Data:** 2026-04-05 | **Status:** DRAFT

> Sistema de créditos append-only + feature flags por plano.
> [CONFIRMADO: 3 créditos por ai-broll item; créditos por operação de IA]

---

## Modelo de Créditos Confirmado

```
Créditos são consumidos por OPERAÇÃO DE IA,
não por minuto de vídeo.

[CONFIRMADO via API Submagic]:
- 1 item ai-broll = 3 créditos
- 1 projeto magic-clips = créditos próprios (pool separado)
- Export padrão (sem B-roll) = 0 créditos extras
- Erro VALIDATION_ERROR se sem créditos suficientes (HTTP 402)
- Plano Business = "unlimited" (sem validação de crédito)
```

---

## Créditos por Operação

```typescript
// lib/credits.ts

export const CREDIT_COSTS = {
  AI_BROLL_ITEM: 3,        // [CONFIRMADO: 3 créditos por item de B-roll]
  MAGIC_CLIPS_PROJECT: 5,  // [INFERIDO: pool de magic clips separado]
  HOOK_TITLE_GENERATION: 0, // Incluso no projeto
  EXPORT_STANDARD: 0,       // Incluso no projeto
  EXPORT_4K: 2,             // [DECISÃO PRÓPRIA: para planos futuros]
  VIDEO_TRANSLATION: 5,     // [DECISÃO PRÓPRIA: feature futura]
  CLEAN_AUDIO: 0,           // Incluso no projeto
  REMOVE_BAD_TAKES: 0,      // Incluso no projeto
  REMOVE_SILENCE: 0,        // Incluso no projeto
} as const;

export type CreditOperation = keyof typeof CREDIT_COSTS;
```

---

## Ledger Append-Only

```typescript
// lib/creditsLedger.ts
// [DECISÃO PRÓPRIA: ledger imutável — só INSERT, nunca UPDATE/DELETE]

import { prisma } from './prisma';

interface DebitOptions {
  userId: string;
  amount: number;
  operation: string;
  projectId?: string;
  description?: string;
}

export async function debitCredits(opts: DebitOptions): Promise<{
  success: boolean;
  balanceBefore: number;
  balanceAfter: number;
}> {
  return await prisma.$transaction(async (tx) => {
    // Calcular saldo atual
    const ledgerSum = await tx.creditsLedger.aggregate({
      where: { userId: opts.userId },
      _sum: { amount: true },
    });
    const currentBalance = ledgerSum._sum.amount ?? 0;

    // Verificar saldo suficiente
    if (currentBalance < opts.amount) {
      throw new InsufficientCreditsError(
        `Insufficient credits: required=${opts.amount}, available=${currentBalance}`
      );
    }

    const balanceAfter = currentBalance - opts.amount;

    // Inserir entrada negativa no ledger (append-only)
    await tx.creditsLedger.create({
      data: {
        userId: opts.userId,
        amount: -opts.amount,           // negativo = débito
        operation: opts.operation,
        projectId: opts.projectId,
        description: opts.description,
        balanceAfter,
      },
    });

    return { success: true, balanceBefore: currentBalance, balanceAfter };
  });
}

export async function creditCredits(opts: Omit<DebitOptions, 'amount'> & {
  amount: number;  // positivo
  reason: 'monthly_reset' | 'purchase' | 'refund' | 'beta_grant';
}): Promise<number> {
  return await prisma.$transaction(async (tx) => {
    const ledgerSum = await tx.creditsLedger.aggregate({
      where: { userId: opts.userId },
      _sum: { amount: true },
    });
    const currentBalance = ledgerSum._sum.amount ?? 0;
    const balanceAfter = currentBalance + opts.amount;

    await tx.creditsLedger.create({
      data: {
        userId: opts.userId,
        amount: opts.amount,            // positivo = crédito
        operation: opts.reason,
        description: opts.description,
        balanceAfter,
      },
    });

    return balanceAfter;
  });
}

export async function getBalance(userId: string): Promise<number> {
  const result = await prisma.creditsLedger.aggregate({
    where: { userId },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}
```

---

## Feature Flags por Plano

```typescript
// lib/featureFlags.ts

export interface PlanFeatures {
  videosPerMonth: number | 'unlimited';
  magicClipsPerMonth: number | 'unlimited';
  maxResolution: '720p' | '1080p' | '4k';
  hasWatermark: boolean;
  hasBroll: boolean;
  hasAutoPublish: boolean;
  hasTeamMembers: boolean;
  maxTeamMembers: number;
  hasMagicZooms: boolean;
  hasCleanAudio: boolean;
  hasRemoveBadTakes: boolean;
  hasVideoTranslator: boolean;
  hasAiAvatars: boolean;
  hasEyeContact: boolean;
  hasApiAccess: boolean;
  apiMinutesPerMonth: number | 'unlimited';
  concurrentExports: number;
  maxUploadMinutes: number;    // minutos de vídeo por upload
  maxVideoSize: number;        // bytes
  creditsPerMonth: number | 'unlimited';
}

// [DECISÃO PRÓPRIA: definição de planos para pós-beta]
export const PLAN_FEATURES: Record<string, PlanFeatures> = {
  beta: {
    videosPerMonth: 'unlimited',
    magicClipsPerMonth: 10,
    maxResolution: '1080p',
    hasWatermark: false,
    hasBroll: true,
    hasAutoPublish: false,
    hasTeamMembers: false,
    maxTeamMembers: 1,
    hasMagicZooms: true,
    hasCleanAudio: true,
    hasRemoveBadTakes: true,
    hasVideoTranslator: false,
    hasAiAvatars: false,
    hasEyeContact: false,
    hasApiAccess: false,
    apiMinutesPerMonth: 0,
    concurrentExports: 2,
    maxUploadMinutes: 120,    // [CONFIRMADO: 2h máximo]
    maxVideoSize: 2147483648, // [CONFIRMADO: 2GB máximo]
    creditsPerMonth: 100,
  },

  free: {
    videosPerMonth: 10,
    magicClipsPerMonth: 2,
    maxResolution: '720p',
    hasWatermark: true,
    hasBroll: false,
    hasAutoPublish: false,
    hasTeamMembers: false,
    maxTeamMembers: 1,
    hasMagicZooms: false,
    hasCleanAudio: false,
    hasRemoveBadTakes: false,
    hasVideoTranslator: false,
    hasAiAvatars: false,
    hasEyeContact: false,
    hasApiAccess: false,
    apiMinutesPerMonth: 0,
    concurrentExports: 1,
    maxUploadMinutes: 30,
    maxVideoSize: 536870912,  // 512MB
    creditsPerMonth: 15,
  },

  pro: {
    videosPerMonth: 'unlimited',
    magicClipsPerMonth: 20,
    maxResolution: '1080p',
    hasWatermark: false,
    hasBroll: true,
    hasAutoPublish: true,
    hasTeamMembers: false,
    maxTeamMembers: 1,
    hasMagicZooms: true,
    hasCleanAudio: true,
    hasRemoveBadTakes: true,
    hasVideoTranslator: false,
    hasAiAvatars: false,
    hasEyeContact: false,
    hasApiAccess: true,
    apiMinutesPerMonth: 100,
    concurrentExports: 3,
    maxUploadMinutes: 120,
    maxVideoSize: 2147483648,
    creditsPerMonth: 100,
  },

  business: {
    videosPerMonth: 'unlimited',
    magicClipsPerMonth: 'unlimited',
    maxResolution: '4k',
    hasWatermark: false,
    hasBroll: true,
    hasAutoPublish: true,
    hasTeamMembers: true,
    maxTeamMembers: 10,
    hasMagicZooms: true,
    hasCleanAudio: true,
    hasRemoveBadTakes: true,
    hasVideoTranslator: true,
    hasAiAvatars: true,
    hasEyeContact: true,
    hasApiAccess: true,
    apiMinutesPerMonth: 'unlimited',
    concurrentExports: 10,
    maxUploadMinutes: 120,
    maxVideoSize: 2147483648,
    creditsPerMonth: 'unlimited',  // [CONFIRMADO: Business = unlimited]
  },
};

export async function getUserFeatures(userId: string): Promise<PlanFeatures> {
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
    select: { plan: true, status: true },
  });

  // Durante o beta, todos têm acesso ao plano beta
  if (process.env.BETA_MODE === 'true') {
    return PLAN_FEATURES.beta;
  }

  const plan = subscription?.status === 'active'
    ? subscription.plan
    : 'free';

  return PLAN_FEATURES[plan];
}
```

---

## Paywall Responses

```typescript
// middleware/featureGate.ts

export class InsufficientCreditsError extends Error {
  readonly code = 'INSUFFICIENT_CREDITS';
  readonly httpStatus = 402;

  constructor(
    message: string,
    public readonly required: number,
    public readonly available: number,
    public readonly upgradeUrl: string = 'https://[DOMINIO].com/upgrade'
  ) {
    super(message);
  }
}

export class FeatureNotInPlanError extends Error {
  readonly code = 'FEATURE_NOT_IN_PLAN';
  readonly httpStatus = 403;

  constructor(
    public readonly feature: string,
    public readonly currentPlan: string,
    public readonly requiredPlan: string,
    public readonly upgradeUrl: string = `https://[DOMINIO].com/upgrade?feature=${feature}`
  ) {
    super(`Feature "${feature}" not available in ${currentPlan} plan`);
  }
}

// Respostas HTTP:
// 402 → { error: { code: "INSUFFICIENT_CREDITS", required: 3, available: 0, upgradeUrl } }
// 403 → { error: { code: "FEATURE_NOT_IN_PLAN", feature: "broll", requiredPlan: "pro", upgradeUrl } }
```

---

## Reset Mensal e Concessão Beta

```typescript
// jobs/monthlyCreditsReset.ts (cron job)

// Executar dia 1 de cada mês às 00:00 UTC
export async function runMonthlyCreditsReset() {
  const subscriptions = await prisma.subscription.findMany({
    where: { status: 'active' },
    select: { userId: true, plan: true },
  });

  for (const sub of subscriptions) {
    const features = PLAN_FEATURES[sub.plan];
    if (features.creditsPerMonth === 'unlimited') continue;

    // Calcular saldo atual e quanto precisa adicionar para atingir o máximo mensal
    const currentBalance = await getBalance(sub.userId);

    // Reset: zerar saldo antigo e conceder novo
    // [DECISÃO PRÓPRIA: reset por adição de créditos — não apagar histório do ledger]
    await creditCredits({
      userId: sub.userId,
      amount: features.creditsPerMonth as number,
      reason: 'monthly_reset',
      description: `Renovação mensal de créditos — plano ${sub.plan}`,
    });

    // Atualizar data do próximo reset
    await prisma.subscription.update({
      where: { userId: sub.userId },
      data: { creditsResetAt: getNextMonthDate() },
    });
  }
}

// Concessão inicial para usuários beta
export async function grantBetaCredits(userId: string) {
  await creditCredits({
    userId,
    amount: 100,
    reason: 'beta_grant',
    description: 'Créditos iniciais do período beta',
  });
}
```

---

## Verificação de Crédito Antes de Job

```typescript
// Uso no handler da API antes de enfileirar job

async function checkAndDebitCredits(
  userId: string,
  projectId: string,
  brollItemCount: number
): Promise<void> {
  const features = await getUserFeatures(userId);

  // Verificar se tem acesso ao B-roll
  if (!features.hasBroll && brollItemCount > 0) {
    throw new FeatureNotInPlanError('broll', 'free', 'pro');
  }

  // Verificar e debitar créditos para B-roll
  if (brollItemCount > 0) {
    const requiredCredits = brollItemCount * CREDIT_COSTS.AI_BROLL_ITEM;
    const currentBalance = await getBalance(userId);

    if (features.creditsPerMonth !== 'unlimited' && currentBalance < requiredCredits) {
      throw new InsufficientCreditsError(
        'Insufficient credits for B-roll',
        requiredCredits,
        currentBalance
      );
    }

    if (features.creditsPerMonth !== 'unlimited') {
      await debitCredits({
        userId,
        amount: requiredCredits,
        operation: 'ai_broll_generation',
        projectId,
        description: `${brollItemCount} B-roll items × 3 créditos`,
      });
    }
  }
}
```

---

## Referências

- [CONFIRMADO] 3 créditos por item ai-broll — API Submagic
- [CONFIRMADO] Business plan = "unlimited" credits, sem validação
- [CONFIRMADO] HTTP 402 com `VALIDATION_ERROR` quando sem créditos
- [CONFIRMADO] Créditos por operação, não por minuto
- [DECISÃO PRÓPRIA] Ledger append-only (imutável) para auditoria

> Ver: [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | [API_SPECIFICATION.md](./API_SPECIFICATION.md) | [FEATURE_SPECS.md](./FEATURE_SPECS.md)
