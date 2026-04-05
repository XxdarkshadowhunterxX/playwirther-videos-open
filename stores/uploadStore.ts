// stores/uploadStore.ts
import { create } from "zustand";

interface UploadPart {
  partNumber: number;
  etag: string | null;
  progress: number;
}

interface UploadStore {
  isUploading: boolean;
  totalProgress: number;
  parts: UploadPart[];
  fileName: string | null;
  fileSize: number | null;
  error: string | null;
  uploadedKey: string | null;

  startUpload: (fileName: string, fileSize: number, partCount: number) => void;
  updatePartProgress: (partNumber: number, progress: number, etag?: string) => void;
  completeUpload: (key: string) => void;
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
  uploadedKey: null,

  startUpload: (fileName, fileSize, partCount) =>
    set({
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
      uploadedKey: null,
    }),

  updatePartProgress: (partNumber, progress, etag) =>
    set((state) => {
      const newParts = state.parts.map((p) =>
        p.partNumber === partNumber
          ? { ...p, progress, etag: etag ?? p.etag }
          : p
      );
      const totalProgress =
        newParts.reduce((sum, p) => sum + p.progress, 0) / newParts.length;
      return { parts: newParts, totalProgress };
    }),

  completeUpload: (key) =>
    set({ isUploading: false, totalProgress: 100, uploadedKey: key }),

  setError: (error) => set({ error, isUploading: false }),

  reset: () =>
    set({
      isUploading: false,
      totalProgress: 0,
      parts: [],
      fileName: null,
      fileSize: null,
      error: null,
      uploadedKey: null,
    }),
}));
