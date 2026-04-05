// lib/types.ts — Tipos compartilhados em todo o projeto

export type WordType = "word" | "silence" | "punctuation";

export interface Word {
  id: string;
  projectId: string;
  text: string;
  type: WordType;
  startTime: number;
  endTime: number;
  confidence: number | null;
  isFiller: boolean;
  isRemoved: boolean;
  position: number;
}

export interface ProjectItem {
  id: string;
  projectId: string;
  type: string;
  prompt?: string;
  assetUrl?: string;
  localKey?: string;
  startTime: number;
  endTime: number;
  layout: string;
  creditsConsumed: number;
}

export interface CaptionTheme {
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  textColor: string;
  highlightColor: string;
  backgroundColor: string;
  shadowEnabled: boolean;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  outlineEnabled: boolean;
  outlineColor: string;
  outlineWidth: number;
  positionX: number;  // 0-100 %
  positionY: number;  // 0-100 %
  animationType: string;
}

export interface Preset {
  id: string;
  name: string;
  displayName: string;
  isPremium: boolean;
  category: string;
  previewImageUrl?: string;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  textColor: string;
  highlightColor: string;
  shadowEnabled: boolean;
  outlineEnabled: boolean;
  positionY: number;
}

export interface Project {
  id: string;
  userId: string;
  title: string;
  status: ProjectStatus;
  language: string;
  sourceKey: string;
  outputKey?: string;
  thumbnailKey?: string;
  videoWidth: number;
  videoHeight: number;
  videoDuration: number;
  videoFps: number;
  videoSize: number;
  directUrl?: string;
  downloadUrl?: string;
  previewUrl?: string;
  templateName: string;
  magicZooms: boolean;
  magicBrolls: boolean;
  magicBrollsPercentage: number;
  removeSilencePace?: string;
  removeBadTakes: boolean;
  cleanAudio: boolean;
  disableCaptions: boolean;
  transcriptionStatus: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
  words?: Word[];
  items?: ProjectItem[];
}

export type ProjectStatus =
  | "uploading"
  | "processing"
  | "transcribing"
  | "ready_to_edit"
  | "exporting"
  | "completed"
  | "failed";

export interface MagicClip {
  id: string;
  projectId: string;
  title?: string;
  directUrl?: string;
  downloadUrl?: string;
  startTime: number;
  endTime: number;
  duration: number;
  viralityTotal: number;
  viralityShareability: number;
  viralityHookStrength: number;
  viralityStoryQuality: number;
  viralityEmotionalImpact: number;
}

// API Response shapes
export interface ApiError {
  error: {
    code: string;
    message: string;
    field?: string;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
