// stores/projectStore.ts
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { Word, ProjectItem, CaptionTheme, Project } from "@/lib/types";

interface ProjectStore {
  // Estado
  project: Project | null;
  words: Word[];
  items: ProjectItem[];
  theme: CaptionTheme;
  isLoading: boolean;

  // Actions
  setProject: (project: Project) => void;
  setWords: (words: Word[]) => void;
  updateWord: (id: string, updates: Partial<Word>) => void;
  removeWord: (id: string) => void;
  restoreWord: (id: string) => void;
  setTheme: (updates: Partial<CaptionTheme>) => void;
  setItems: (items: ProjectItem[]) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;

  // Computed helpers (memoized)
  getActiveWords: () => Word[];
  getWordAt: (time: number) => Word | null;
  getLineAt: (time: number) => Word[];
}

const DEFAULT_THEME: CaptionTheme = {
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
  outlineEnabled: true,
  outlineColor: "#000000",
  outlineWidth: 2,
  positionX: 50,
  positionY: 55,
  animationType: "karaoke",
};

const WORDS_PER_LINE = 3;

export const useProjectStore = create<ProjectStore>()(
  subscribeWithSelector((set, get) => ({
    project: null,
    words: [],
    items: [],
    theme: DEFAULT_THEME,
    isLoading: false,

    setProject: (project) =>
      set({
        project,
        words: project.words ?? [],
        items: project.items ?? [],
      }),

    setWords: (words) => set({ words }),

    updateWord: (id, updates) =>
      set((state) => ({
        words: state.words.map((w) =>
          w.id === id ? { ...w, ...updates } : w
        ),
      })),

    removeWord: (id) =>
      set((state) => ({
        words: state.words.map((w) =>
          w.id === id ? { ...w, isRemoved: true } : w
        ),
      })),

    restoreWord: (id) =>
      set((state) => ({
        words: state.words.map((w) =>
          w.id === id ? { ...w, isRemoved: false } : w
        ),
      })),

    setTheme: (updates) =>
      set((state) => ({ theme: { ...state.theme, ...updates } })),

    setItems: (items) => set({ items }),

    setLoading: (isLoading) => set({ isLoading }),

    reset: () =>
      set({
        project: null,
        words: [],
        items: [],
        theme: DEFAULT_THEME,
        isLoading: false,
      }),

    getActiveWords: () => get().words.filter((w) => !w.isRemoved),

    getWordAt: (time) => {
      const active = get().getActiveWords();
      return (
        active.find(
          (w) => w.type === "word" && time >= w.startTime && time < w.endTime
        ) ?? null
      );
    },

    getLineAt: (time) => {
      const active = get().getActiveWords();
      const wordIndex = active.findIndex(
        (w) => w.type === "word" && time >= w.startTime && time < w.endTime
      );
      if (wordIndex === -1) return [];

      // Encontrar início da linha (agrupa WORDS_PER_LINE palavras)
      const wordsBefore = active.slice(0, wordIndex).filter((w) => w.type === "word");
      const lineStartWordIdx = Math.floor(wordsBefore.length / WORDS_PER_LINE) * WORDS_PER_LINE;

      // Pegar palavras da linha atual
      const lineWords = active.filter((w) => w.type === "word");
      const lineSlice = lineWords.slice(
        lineStartWordIdx,
        lineStartWordIdx + WORDS_PER_LINE
      );

      // Incluir silences/punctuation entre as palavras
      if (!lineSlice.length) return [];
      const lineStart = lineSlice[0].startTime;
      const lineEnd = lineSlice[lineSlice.length - 1].endTime;
      return active.filter(
        (w) => w.startTime >= lineStart && w.endTime <= lineEnd
      );
    },
  }))
);
