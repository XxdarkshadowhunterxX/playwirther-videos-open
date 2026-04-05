// stores/editorStore.ts
import { create } from "zustand";

type ActivePanel = "captions" | "broll" | "trim" | "export";

interface EditorStore {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  activePanel: ActivePanel;
  selectedWordId: string | null;
  isExporting: boolean;
  exportProgress: number;
  isMuted: boolean;
  volume: number;

  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setActivePanel: (panel: ActivePanel) => void;
  selectWord: (id: string | null) => void;
  setExportState: (isExporting: boolean, progress?: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  reset: () => void;
}

export const useEditorStore = create<EditorStore>((set) => ({
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  activePanel: "captions",
  selectedWordId: null,
  isExporting: false,
  exportProgress: 0,
  isMuted: false,
  volume: 1,

  setCurrentTime: (currentTime) => set({ currentTime }),
  setDuration: (duration) => set({ duration }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setActivePanel: (activePanel) => set({ activePanel }),
  selectWord: (selectedWordId) => set({ selectedWordId }),
  setExportState: (isExporting, progress = 0) =>
    set({ isExporting, exportProgress: progress }),
  setVolume: (volume) => set({ volume }),
  toggleMute: () => set((state) => ({ isMuted: !state.isMuted })),

  reset: () =>
    set({
      currentTime: 0,
      duration: 0,
      isPlaying: false,
      activePanel: "captions",
      selectedWordId: null,
      isExporting: false,
      exportProgress: 0,
    }),
}));
