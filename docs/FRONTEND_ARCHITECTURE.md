# FRONTEND_ARCHITECTURE.md
**Versão:** v0.1.0 | **Data:** 2026-04-05 | **Status:** DRAFT

> Arquitetura do frontend em Next.js 14 App Router.
> [CONFIRMADO: Next.js detectado via `_next/static/chunks` e `__NEXT_DATA__`]

---

## Estrutura de Rotas (App Router)

```
app/
├── layout.tsx                   ← Root layout (providers, fonts, Pusher init)
├── page.tsx                     ← Landing page
├── (auth)/
│   ├── login/page.tsx           ← Login com Google
│   └── layout.tsx               ← Layout sem navbar
├── (app)/
│   ├── layout.tsx               ← App layout (navbar, sidebar, Pusher listener)
│   ├── dashboard/
│   │   └── page.tsx             ← Grid de projetos + botão criar
│   ├── upload/
│   │   └── page.tsx             ← Drag-n-drop + progresso de upload
│   ├── editor/
│   │   └── [id]/
│   │       ├── page.tsx         ← Editor principal (redirect para /captions)
│   │       ├── layout.tsx       ← Editor layout (player + painéis)
│   │       ├── captions/
│   │       │   └── page.tsx     ← Editor de captions
│   │       ├── broll/
│   │       │   └── page.tsx     ← Painel de B-roll
│   │       ├── trim/
│   │       │   └── page.tsx     ← Timeline de cortes
│   │       └── export/
│   │           └── page.tsx     ← Modal de export
│   ├── magic-clips/
│   │   └── page.tsx             ← Upload para Magic Clips
│   ├── media/
│   │   └── page.tsx             ← Biblioteca de user media
│   └── settings/
│       └── page.tsx             ← Configurações de conta
└── api/
    └── [...nextauth]/route.ts   ← NextAuth handlers
```

---

## Componentes do Editor

```
components/
├── editor/
│   ├── EditorLayout.tsx             ← Container principal
│   ├── VideoPlayer.tsx              ← HTML5 <video> + controles
│   ├── CaptionCanvas.tsx            ← Canvas 2D para preview de legendas
│   ├── CaptionEditor/
│   │   ├── CaptionList.tsx          ← Lista scrollable de caption items
│   │   ├── CaptionItem.tsx          ← Caption individual editável
│   │   ├── CaptionSplitButton.tsx   ← Botão de split
│   │   └── AddIntroButton.tsx       ← Adicionar intro
│   ├── StylePanel/
│   │   ├── TemplateGrid.tsx         ← Grid visual de templates
│   │   ├── TemplateCard.tsx         ← Card de template com preview
│   │   └── CustomizePanel.tsx       ← Sliders de customização
│   ├── BrollPanel/
│   │   ├── BrollList.tsx            ← Lista de B-rolls do projeto
│   │   ├── BrollItem.tsx            ← Item com layout selector
│   │   ├── PexelsSearch.tsx         ← Busca manual no Pexels
│   │   └── UserMediaGrid.tsx        ← Mídia do usuário
│   ├── TrimTimeline.tsx             ← Visualização de cortes de silêncio
│   ├── ExportModal.tsx              ← Modal de configuração de export
│   └── ProcessingOverlay.tsx        ← Overlay de "Transcribing..."
├── upload/
│   ├── DropZone.tsx                 ← Drag-n-drop zone
│   ├── UploadProgress.tsx           ← Barra de progresso multipart
│   └── VideoMetaExtractor.tsx       ← MediaInfoModule.wasm wrapper
├── dashboard/
│   ├── ProjectGrid.tsx              ← Grid de projetos
│   ├── ProjectCard.tsx              ← Card com status e thumbnail
│   └── CreateProjectButton.tsx      ← CTA principal
└── ui/                              ← shadcn/ui components
```

---

## VideoPlayer Component

```tsx
// components/editor/VideoPlayer.tsx
'use client';

import { useRef, useEffect, useCallback } from 'react';
import { useEditorStore } from '@/stores/editorStore';

interface VideoPlayerProps {
  src: string;              // previewUrl do projeto
  onTimeUpdate?: (time: number) => void;
}

export function VideoPlayer({ src, onTimeUpdate }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number>();
  const { setCurrentTime, setDuration, isPlaying } = useEditorStore();

  // 60fps playhead tracking via requestAnimationFrame
  const trackPlayhead = useCallback(() => {
    if (!videoRef.current) return;
    const time = videoRef.current.currentTime;
    setCurrentTime(time);
    onTimeUpdate?.(time);
    rafRef.current = requestAnimationFrame(trackPlayhead);
  }, [setCurrentTime, onTimeUpdate]);

  useEffect(() => {
    if (isPlaying) {
      rafRef.current = requestAnimationFrame(trackPlayhead);
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, trackPlayhead]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handleMetadata = () => setDuration(video.duration);
    video.addEventListener('loadedmetadata', handleMetadata);
    return () => video.removeEventListener('loadedmetadata', handleMetadata);
  }, [setDuration]);

  // Magnetic scrubbing — seek imediato ao clicar na timeline
  const handleSeek = useCallback((time: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = time;
    setCurrentTime(time);
  }, [setCurrentTime]);

  return (
    <div className="relative aspect-[9/16] bg-black rounded-xl overflow-hidden">
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full object-contain"
        playsInline
        preload="metadata"
      />
      {/* CaptionCanvas sobreposto */}
      <CaptionCanvas videoRef={videoRef} />
    </div>
  );
}
```

---

## CaptionCanvas — Preview de Legendas

```tsx
// components/editor/CaptionCanvas.tsx
'use client';

import { useRef, useEffect } from 'react';
import { useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';

export function CaptionCanvas({
  videoRef
}: {
  videoRef: React.RefObject<HTMLVideoElement>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { words, theme } = useProjectStore();
  const { currentTime } = useEditorStore();

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    // Sincronizar tamanho do canvas com o vídeo
    canvas.width = video.videoWidth || 1080;
    canvas.height = video.videoHeight || 1920;

    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Encontrar linha de caption atual
    const activeLine = getActiveCaptionLine(words, currentTime);
    if (!activeLine.length) return;

    // Configurar fonte
    ctx.font = `${theme.fontWeight} ${theme.fontSize}px ${theme.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Posição Y baseada no tema
    const y = canvas.height * (theme.positionY / 100);

    // Renderizar cada palavra da linha
    let xOffset = -getTotalLineWidth(ctx, activeLine) / 2;
    for (const word of activeLine) {
      if (word.type !== 'word') continue;

      const isActive = currentTime >= word.startTime && currentTime < word.endTime;
      const color = isActive ? theme.highlightColor : theme.textColor;
      const wordWidth = ctx.measureText(word.text + ' ').width;

      // Sombra
      if (theme.shadowEnabled) {
        ctx.shadowColor = theme.shadowColor;
        ctx.shadowBlur = theme.shadowBlur;
        ctx.shadowOffsetX = theme.shadowOffsetX;
        ctx.shadowOffsetY = theme.shadowOffsetY;
      }

      ctx.fillStyle = color;
      ctx.fillText(word.text, canvas.width / 2 + xOffset + wordWidth / 2, y);

      xOffset += wordWidth;
    }
  }, [currentTime, words, theme]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ mixBlendMode: 'normal' }}
    />
  );
}
```

---

## Zustand Stores

```typescript
// stores/projectStore.ts
import { create } from 'zustand';
import { Word, ProjectItem, Theme } from '@/types';

interface ProjectStore {
  // Estado do projeto
  projectId: string | null;
  status: string;
  words: Word[];
  projectItems: ProjectItem[];
  theme: Theme;
  language: string;

  // Actions
  setProject: (project: Partial<ProjectStore>) => void;
  updateWord: (id: string, updates: Partial<Word>) => void;
  removeWord: (id: string) => void;
  restoreWord: (id: string) => void;
  setTheme: (theme: Partial<Theme>) => void;

  // Cache para performance
  activeWordsByTime: Map<number, Word[]>;  // memoizado por frame
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projectId: null,
  status: 'idle',
  words: [],
  projectItems: [],
  language: 'pt',
  theme: {
    fontFamily: 'Montserrat',
    fontWeight: 900,
    fontSize: 36,
    textColor: '#FFFFFF',
    highlightColor: '#FF6B00',
    backgroundColor: 'transparent',
    shadowEnabled: true,
    shadowColor: '#000000',
    shadowBlur: 4,
    shadowOffsetX: 2,
    shadowOffsetY: 2,
    positionX: 50,
    positionY: 55,
  },
  activeWordsByTime: new Map(),

  setProject: (project) => set((state) => ({ ...state, ...project })),

  updateWord: (id, updates) => set((state) => ({
    words: state.words.map(w => w.id === id ? { ...w, ...updates } : w),
  })),

  removeWord: (id) => set((state) => ({
    words: state.words.map(w => w.id === id ? { ...w, isRemoved: true } : w),
  })),

  restoreWord: (id) => set((state) => ({
    words: state.words.map(w => w.id === id ? { ...w, isRemoved: false } : w),
  })),

  setTheme: (theme) => set((state) => ({
    theme: { ...state.theme, ...theme },
  })),
}));
```

```typescript
// stores/editorStore.ts
import { create } from 'zustand';

interface EditorStore {
  // Playback
  currentTime: number;
  duration: number;
  isPlaying: boolean;

  // UI state
  activePanel: 'captions' | 'broll' | 'trim' | 'export';
  selectedWordId: string | null;
  isExporting: boolean;
  exportProgress: number;

  // Actions
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setActivePanel: (panel: EditorStore['activePanel']) => void;
  selectWord: (id: string | null) => void;
  setExportState: (isExporting: boolean, progress?: number) => void;
}

export const useEditorStore = create<EditorStore>((set) => ({
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  activePanel: 'captions',
  selectedWordId: null,
  isExporting: false,
  exportProgress: 0,

  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setActivePanel: (activePanel) => set({ activePanel }),
  selectWord: (selectedWordId) => set({ selectedWordId }),
  setExportState: (isExporting, progress = 0) =>
    set({ isExporting, exportProgress: progress }),
}));
```

```typescript
// stores/uploadStore.ts
import { create } from 'zustand';

interface UploadPart {
  partNumber: number;
  etag: string | null;
  progress: number;  // 0-100
}

interface UploadStore {
  isUploading: boolean;
  totalProgress: number;  // 0-100 (média das partes)
  parts: UploadPart[];
  fileName: string | null;
  fileSize: number | null;
  error: string | null;

  startUpload: (filename: string, fileSize: number, partCount: number) => void;
  updatePartProgress: (partNumber: number, progress: number, etag?: string) => void;
  completeUpload: () => void;
  setError: (error: string) => void;
  reset: () => void;
}

export const useUploadStore = create<UploadStore>((set, get) => ({
  isUploading: false,
  totalProgress: 0,
  parts: [],
  fileName: null,
  fileSize: null,
  error: null,

  startUpload: (fileName, fileSize, partCount) => set({
    isUploading: true,
    fileName,
    fileSize,
    parts: Array.from({ length: partCount }, (_, i) => ({
      partNumber: i + 1,
      etag: null,
      progress: 0,
    })),
    totalProgress: 0,
    error: null,
  }),

  updatePartProgress: (partNumber, progress, etag) => set((state) => {
    const newParts = state.parts.map(p =>
      p.partNumber === partNumber ? { ...p, progress, etag: etag ?? p.etag } : p
    );
    const totalProgress = newParts.reduce((sum, p) => sum + p.progress, 0) / newParts.length;
    return { parts: newParts, totalProgress };
  }),

  completeUpload: () => set({ isUploading: false, totalProgress: 100 }),
  setError: (error) => set({ error, isUploading: false }),
  reset: () => set({ isUploading: false, totalProgress: 0, parts: [], error: null }),
}));
```

---

## Hook de Pusher (Realtime)

```typescript
// hooks/usePusherProject.ts
'use client';

import { useEffect } from 'react';
import { pusherClient } from '@/lib/pusher-client';
import { useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { useRouter } from 'next/navigation';

export function usePusherProject(projectId: string, userId: string) {
  const { setProject } = useProjectStore();
  const { setExportState } = useEditorStore();
  const router = useRouter();

  useEffect(() => {
    // [CONFIRMADO: channel private-user-{userId}]
    const channel = pusherClient.subscribe(`private-user-${userId}`);

    channel.bind('transcription.completed', (data: {
      projectId: string;
      wordCount: number;
      accuracy: number;
      language: string;
    }) => {
      if (data.projectId !== projectId) return;
      setProject({ status: 'ready_to_edit' });
      // Recarregar words do servidor
      router.refresh();
    });

    channel.bind('export.completed', (data: {
      projectId: string;
      downloadUrl: string;
      directUrl: string;
    }) => {
      if (data.projectId !== projectId) return;
      setExportState(false);
      setProject({
        status: 'completed',
        // downloadUrl e directUrl serão atualizados via router.refresh()
      });
      router.refresh();
    });

    channel.bind('job.progress', (data: {
      projectId: string;
      jobType: string;
      progress: number;
    }) => {
      if (data.projectId !== projectId) return;
      if (data.jobType === 'export') {
        setExportState(true, data.progress);
      }
    });

    channel.bind('transcription.failed', (data: { projectId: string; error: string }) => {
      if (data.projectId !== projectId) return;
      setProject({ status: 'failed' });
    });

    channel.bind('export.failed', (data: { projectId: string; error: string }) => {
      if (data.projectId !== projectId) return;
      setExportState(false);
    });

    return () => {
      pusherClient.unsubscribe(`private-user-${userId}`);
    };
  }, [projectId, userId]);
}
```

---

## Upload Flow

```typescript
// lib/multipartUpload.ts

export async function uploadVideoMultipart(
  file: File,
  onProgress: (progress: number) => void
): Promise<{ key: string; projectData: any }> {
  // 1. Extrair metadados via MediaInfoModule.wasm
  const metadata = await extractVideoMetadata(file);

  // 2. Solicitar presigned URLs
  const presignResponse = await fetch('/api/upload/presign', {
    method: 'POST',
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      fileSize: file.size,
      duration: metadata.duration,
      width: metadata.width,
      height: metadata.height,
      fps: metadata.fps,
      codec: metadata.codec,
    }),
  }).then(r => r.json());

  const { uploadId, key, parts } = presignResponse;

  // 3. Upload das partes em paralelo (máx 3 simultâneas)
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
  const etags: { partNumber: number; etag: string }[] = [];
  let completedBytes = 0;

  const partChunks = parts.map((part: any) => ({
    partNumber: part.partNumber,
    url: part.url,
    chunk: file.slice(
      (part.partNumber - 1) * CHUNK_SIZE,
      part.partNumber * CHUNK_SIZE
    ),
  }));

  // Upload com controle de concorrência (p-limit pattern)
  await Promise.all(
    chunkArray(partChunks, 3).map(async (batch) => {
      for (const part of batch) {
        const response = await fetch(part.url, {
          method: 'PUT',
          body: part.chunk,
          headers: { 'Content-Type': 'application/octet-stream' },
        });
        const etag = response.headers.get('ETag')!.replace(/"/g, '');
        etags.push({ partNumber: part.partNumber, etag });
        completedBytes += part.chunk.size;
        onProgress((completedBytes / file.size) * 100);
      }
    })
  );

  // 4. Completar o multipart upload
  await fetch('/api/upload/complete', {
    method: 'POST',
    body: JSON.stringify({ uploadId, key, parts: etags }),
  });

  return { key, metadata };
}
```

---

## Configuração do Pusher Client

```typescript
// lib/pusher-client.ts
import PusherJS from 'pusher-js';

// [CONFIRMADO: window.Pusher detectado na análise dinâmica]
export const pusherClient = new PusherJS(
  process.env.NEXT_PUBLIC_PUSHER_KEY!,
  {
    cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
    authEndpoint: '/api/pusher/auth',
    auth: {
      headers: {
        // NextAuth session cookie enviado automaticamente
      },
    },
  }
);
```

---

## Fontes e Design System

```typescript
// app/layout.tsx (Google Fonts)
import { Montserrat, Inter } from 'next/font/google';

const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['400', '600', '700', '900'],
  variable: '--font-montserrat',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});
```

```css
/* globals.css — Design tokens */
:root {
  --brand-primary: #7C3AED;      /* violeta → NÃO usar [Purple Ban] */
  --brand-accent: #F97316;       /* laranja — baseado no Karl */
  --surface-bg: #0A0A0B;
  --surface-card: #111113;
  --surface-elevated: #1C1C1F;
  --text-primary: #FAFAFA;
  --text-secondary: #A1A1AA;
  --text-muted: #52525B;
  --border-subtle: #27272A;
  --border-default: #3F3F46;
}
```

---

## Referências

- [CONFIRMADO] Next.js 14 App Router: `_next/static/chunks` e `__NEXT_DATA__` detectados
- [CONFIRMADO] Konva.js detectado no Submagic (`window.Konva`) → substituímos por Canvas 2D nativo [DECISÃO PRÓPRIA: Canvas 2D mais simples para MVP]
- [CONFIRMADO] Pusher JS client: `window.Pusher` detectado
- [CONFIRMADO] MediaInfoModule.wasm: análise de metadados client-side
- [DECISÃO PRÓPRIA] Zustand para estado global (vs. Redux — menor overhead)
- [DECISÃO PRÓPRIA] shadcn/ui + Tailwind (vs. Chakra UI detectado no Submagic — melhor DX)

> Ver: [ARCHITECTURE.md](./ARCHITECTURE.md) | [API_SPECIFICATION.md](./API_SPECIFICATION.md) | [FEATURE_SPECS.md](./FEATURE_SPECS.md)
