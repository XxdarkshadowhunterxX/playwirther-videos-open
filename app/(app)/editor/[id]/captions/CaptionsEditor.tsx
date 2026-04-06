"use client";
// app/(app)/editor/[id]/captions/CaptionsEditor.tsx
// Editor interativo de legendas + Pusher real-time

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Word } from "@/lib/types";

type ExportStatus = "idle" | "loading" | "exporting" | "done" | "error";

interface Props {
  projectId: string;
  userId: string;
  initialWords: Word[];
  initialItems: any[];
  videoUrl: string;
  templateName: string;
  initialStatus: string;
}

// ── Duração estimada após remoções ─────────────────────────────────────
function calcRemainingDuration(words: Word[]): number {
  return words
    .filter((w) => !w.isRemoved && w.type !== "silence")
    .reduce((sum, w) => sum + (w.endTime - w.startTime), 0);
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function CaptionsEditor({ projectId, userId, videoUrl, initialWords, initialItems, templateName, initialStatus }: Props) {
  const router = useRouter();
  const [words, setWords] = useState<Word[]>(initialWords);
  const [items, setItems] = useState<any[]>(initialItems);
  const [status, setStatus] = useState(initialStatus);
  const [saving, setSaving] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [showFillers, setShowFillers] = useState(true);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<ExportStatus>("idle");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const saveQueueRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [aiActionSaving, setAiActionSaving] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState(0);

  // Individual B-Roll Edit State
  const [editingBrollId, setEditingBrollId] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState("");
  const [editingStartTime, setEditingStartTime] = useState<number>(0);
  const [editingEndTime, setEditingEndTime] = useState<number>(0);
  const [editingMediaOffset, setEditingMediaOffset] = useState<number>(0);
  const [modalVideoDuration, setModalVideoDuration] = useState<number>(0);
  const modalVideoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Video Preview State
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const updateTime = () => setCurrentTime(v.currentTime);
    const updateDuration = () => setDuration(v.duration);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    v.addEventListener("timeupdate", updateTime);
    v.addEventListener("loadedmetadata", updateDuration);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);

    return () => {
      v.removeEventListener("timeupdate", updateTime);
      v.removeEventListener("loadedmetadata", updateDuration);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, []);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) videoRef.current.pause();
      else videoRef.current.play();
    }
  };

  // Sincroniza estado se o `router.refresh()` injetar novas props (ex: AI edições do back-end)
  useEffect(() => {
    setWords(initialWords);
    setItems(initialItems);
  }, [initialWords, initialItems]);

  const applyAiEdit = async (action: string, pace?: string) => {
    setAiActionSaving(action);
    try {
      const res = await fetch(`/api/projects/${projectId}/ai-edits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, pace }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`IA finalizou: ${data.removedSegmentsCount} cortes aplicados!`);
        router.refresh();
      } else {
        showToast("Erro ao processar edição de IA");
      }
    } catch {
      showToast("Erro de rede ao chamar a IA");
    } finally {
      setAiActionSaving(null);
    }
  };

  const applyBroll = async () => {
    setAiActionSaving("broll");
    try {
      const percentage = (document.getElementById("broll-percentage") as HTMLInputElement).value;
      const layout = (document.getElementById("broll-layout") as HTMLSelectElement).value;
      const pace = (document.getElementById("broll-pace") as HTMLSelectElement).value;

      const res = await fetch(`/api/projects/${projectId}/ai-brolls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ percentage: Number(percentage), layout, pace: Number(pace) }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`${data.count} B-Rolls gerados pelo GPT e baixados via Pexels!`);
        router.refresh();
      } else {
        showToast("Erro ao gerar B-Rolls");
      }
    } catch {
      showToast("Erro de rede (Pexels / OpenAI)");
    } finally {
      setAiActionSaving(null);
    }
  };

  const handleBrollUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingBrollId) return;

    setAiActionSaving(`upload-${editingBrollId}`);
    try {
      showToast(`Iniciando upload de ${file.name}...`);
      const presignRes = await fetch(`/api/projects/${projectId}/ai-brolls/${editingBrollId}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type })
      });
      const creds = await presignRes.json();
      if (!presignRes.ok || !creds.url) throw new Error("Could not get upload URL");

      const uploadRes = await fetch(creds.url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });

      if (!uploadRes.ok) throw new Error("Upload to S3 failed");

      const patchRes = await fetch(`/api/projects/${projectId}/ai-brolls/${editingBrollId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          localAssetUrl: creds.finalAssetUrl,
          startTime: editingStartTime,
          endTime: editingEndTime,
          mediaOffset: editingMediaOffset
        }),
      });
      const data = await patchRes.json();
      if (patchRes.ok && data.success) {
        setItems(prev => prev.map(i => i.id === editingBrollId ? data.item : i));
        showToast("Mídia local carregada com sucesso!");
      } else {
        showToast(data.error || "Erro ao atualizar mídia local");
      }
    } catch (err) {
      console.error(err);
      showToast("Erro no Upload de Mídia");
    } finally {
      setAiActionSaving(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleCreateMotionGraphics = async () => {
    if (!editingBrollId) return;
    const item = items.find(i => i.id === editingBrollId);
    if (!item?.assetUrl) return;

    setAiActionSaving(`motion-${editingBrollId}`);
    try {
      showToast("Animando Produto em Background... Isso leva uns 15seg!");
      await fetch(`/api/projects/${projectId}/ai-brolls/${editingBrollId}/motion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imgUrl: item.assetUrl })
      });
      
      // Simple Polling
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        const res = await fetch(`/api/projects/${projectId}`);
        const projData = await res.json();
        const updatedItem = projData.items?.find((i: any) => i.id === editingBrollId);
        
        if (updatedItem && updatedItem.type === "motion_broll") {
          clearInterval(poll);
          setItems(prev => prev.map(i => i.id === editingBrollId ? updatedItem : i));
          showToast("✨ Produto Animado com Sucesso!");
          setAiActionSaving(null);
        } else if (attempts > 30) {
          clearInterval(poll);
          showToast("Time-out. Verifique mais tarde.");
          setAiActionSaving(null);
        }
      }, 3000);

    } catch (err) {
      showToast("Erro ao criar animação.");
      setAiActionSaving(null);
    }
  };

  const deleteBroll = async (itemId: string) => {
    setAiActionSaving(`delete-${itemId}`);
    try {
      const res = await fetch(`/api/projects/${projectId}/ai-brolls/${itemId}`, { method: "DELETE" });
      if (res.ok) {
        setItems(prev => prev.filter(i => i.id !== itemId));
        showToast("B-Roll removido!");
      }
    } catch {
      showToast("Erro ao remover B-Roll.");
    } finally {
      setAiActionSaving(null);
    }
  };

  const saveBrollEdit = async (itemId: string) => {
    if (!editingPrompt.trim()) return;
    setAiActionSaving(`edit-${itemId}`);
    try {
      const res = await fetch(`/api/projects/${projectId}/ai-brolls/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          prompt: editingPrompt,
          startTime: editingStartTime,
          endTime: editingEndTime,
          mediaOffset: editingMediaOffset
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setItems(prev => prev.map(i => i.id === itemId ? data.item : i));
        setEditingBrollId(null);
        showToast("B-Roll atualizado com sucesso!");
      } else {
        showToast(data.error || "Erro ao atualizar");
      }
    } catch {
      showToast("Erro ao atualizar o B-Roll");
    } finally {
      setAiActionSaving(null);
    }
  };

  // ── Helper Variables ──────────────────────────────────────────────────
  const isProcessing = !["ready_to_edit", "completed", "failed"].includes(status);
  const visibleWords = words.filter((w) => w.type === "word" || w.type === "punctuation");
  const removedCount = visibleWords.filter((w) => w.isRemoved).length;
  const fillerCount = visibleWords.filter((w) => w.isFiller && !w.isRemoved).length;
  const remainingDuration = calcRemainingDuration(words);

  // Preview Calculations
  const activeWord = visibleWords.find(w => w.startTime <= currentTime && currentTime <= w.endTime && !w.isRemoved);
  const activeBroll = items.find(i => i.startTime <= currentTime && currentTime <= i.endTime && ["ai_broll", "user_broll", "motion_broll", "image"].includes(i.type));
  const currentBaseWord = words.find(w => w.startTime <= currentTime && currentTime <= w.endTime);
  const isCurrentlyCut = currentBaseWord?.isRemoved || false;

  const isImgUrl = (url: string) => /\.(jpg|jpeg|png|gif|webp)$/i.test((url || "").split('?')[0]);

  // ── Toast helper ──────────────────────────────────────────────────────
  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2500);
  };

  // ── Pusher real-time connection ────────────────────────────────────────
  useEffect(() => {
    if (!isProcessing) return;

    let pusher: any;
    let channel: any;

    const connect = async () => {
      try {
        const PusherJS = (await import("pusher-js")).default;
        pusher = new PusherJS(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
          cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
          authEndpoint: "/api/pusher/auth",
        });

        channel = pusher.subscribe(`private-user-${userId}`);

        channel.bind("project.status.updated", (data: { projectId: string; status: string }) => {
          if (data.projectId !== projectId) return;
          setStatus(data.status);
          if (data.status === "ready_to_edit") router.refresh();
          if (data.status === "exporting") setExportStatus("exporting");
          if (data.status === "completed") setExportStatus("done");
          if (data.status === "failed") setExportStatus("error");
        });

        channel.bind("export.completed", (data: { projectId: string; directUrl: string }) => {
          if (data.projectId !== projectId) return;
          setDownloadUrl(data.directUrl);
          setExportProgress(100);
          setExportStatus("done");
          showToast("Vídeo exportado com sucesso!");
        });

        channel.bind("job.progress", (data: { projectId: string; jobType: string; progress: number }) => {
          if (data.projectId !== projectId) return;
          if (data.jobType === "export") {
            setExportProgress(data.progress);
          }
        });
      } catch (err) {
        console.warn("Pusher connection failed, falling back to polling:", err);
        // Fallback: polling a cada 5s
        const interval = setInterval(() => router.refresh(), 5000);
        return () => clearInterval(interval);
      }
    };

    connect();

    return () => {
      channel?.unbind_all();
      pusher?.disconnect();
    };
  }, [isProcessing, projectId, userId, router]);

  // ── Toggle de palavra individual ──────────────────────────────────────
  const toggleWord = useCallback(async (wordId: string) => {
    const word = words.find((w) => w.id === wordId);
    if (!word) return;

    const newIsRemoved = !word.isRemoved;
    setWords((prev) =>
      prev.map((w) => (w.id === wordId ? { ...w, isRemoved: newIsRemoved } : w))
    );
    setPendingIds((prev) => new Set(prev).add(wordId));

    // Debounce save — agrupa cliques rápidos
    if (saveQueueRef.current) clearTimeout(saveQueueRef.current);
    saveQueueRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        const ids = Array.from(pendingIds);
        ids.push(wordId);
        await fetch(`/api/projects/${projectId}/words`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wordIds: ids, isRemoved: newIsRemoved }),
        });
        setPendingIds(new Set());
      } finally {
        setSaving(false);
      }
    }, 600);
  }, [words, pendingIds, projectId]);

  // ── Toggle global de fillers ──────────────────────────────────────────
  const toggleAllFillers = useCallback(async () => {
    const hasVisibleFillers = words.some((w) => w.isFiller && !w.isRemoved);
    const newIsRemoved = hasVisibleFillers;

    setWords((prev) =>
      prev.map((w) => (w.isFiller ? { ...w, isRemoved: newIsRemoved } : w))
    );
    setShowFillers(!hasVisibleFillers);

    setSaving(true);
    try {
      await fetch(`/api/projects/${projectId}/words`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toggleFillers: true }),
      });
      showToast(newIsRemoved ? `${fillerCount} fillers removidos` : "Fillers restaurados");
    } finally {
      setSaving(false);
    }
  }, [words, fillerCount, projectId]);

  // ── Reset todas remoções ──────────────────────────────────────────────
  const resetAll = useCallback(async () => {
    const removedIds = words.filter((w) => w.isRemoved).map((w) => w.id);
    if (removedIds.length === 0) return;
    setWords((prev) => prev.map((w) => ({ ...w, isRemoved: false })));
    setSaving(true);
    try {
      await fetch(`/api/projects/${projectId}/words`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordIds: removedIds, isRemoved: false }),
      });
      showToast("Todas as remoções foram desfeitas");
    } finally {
      setSaving(false);
    }
  }, [words, projectId]);

  // ── Estado de loading real-time ───────────────────────────────────────
  if (isProcessing) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <div className="text-center max-w-sm">
          <div className="relative w-20 h-20 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full border-4 border-surface-elevated" />
            <div className="absolute inset-0 rounded-full border-4 border-brand-accent border-t-transparent animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-brand-accent">
                <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <path d="M12 19v3" />
              </svg>
            </div>
          </div>
          <h2 className="text-xl font-display font-black text-text-primary mb-2">
            {status === "transcribing" ? "Transcrevendo..." : "Processando..."}
          </h2>
          <p className="text-sm text-text-secondary">Conectado em tempo real via Pusher — atualiza automaticamente.</p>
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-brand-accent">
            <div className="w-2 h-2 rounded-full bg-brand-accent animate-pulse" />
            Live
          </div>
        </div>
      </div>
    );
  }

  if (words.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-sm text-text-muted">Nenhuma palavra encontrada na transcrição.</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] relative">

      {/* Toast */}
      {toastMsg && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-surface-card border border-border-subtle rounded-xl text-sm text-text-primary shadow-xl animate-fade-in">
          {toastMsg}
        </div>
      )}

      {/* ── Painel esquerdo — captions ─────────────────────────────────── */}
      <div className="w-full max-w-2xl flex flex-col border-r border-border-subtle">

        {/* Toolbar */}
        <div className="px-4 py-2.5 border-b border-border-subtle bg-surface-card shrink-0">
          <div className="flex items-center justify-between gap-3">
            {/* Stats */}
            <div className="flex items-center gap-3 text-xs text-text-muted">
              <span className="text-text-primary font-medium">{visibleWords.length - removedCount} palavras</span>
              {removedCount > 0 && <span className="text-red-400">{removedCount} removidas</span>}
              <span className="text-brand-accent">{formatDuration(remainingDuration)}</span>
              {saving && (
                <span className="flex items-center gap-1 text-text-muted">
                  <div className="w-3 h-3 border border-text-muted border-t-transparent rounded-full animate-spin" />
                  salvando
                </span>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {/* Toggle fillers */}
              <button
                onClick={toggleAllFillers}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-all ${
                  fillerCount > 0
                    ? "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/25"
                    : "bg-surface-elevated text-text-muted border border-border-subtle hover:border-border-default"
                }`}
                title={fillerCount > 0 ? "Remover todos os fillers" : "Restaurar fillers"}
              >
                ✂️ Fillers {fillerCount > 0 ? `(${fillerCount})` : ""}
              </button>

              {/* Reset */}
              {removedCount > 0 && (
                <button
                  onClick={resetAll}
                  className="px-2.5 py-1 text-xs font-medium rounded-lg bg-surface-elevated text-text-muted border border-border-subtle hover:text-text-primary hover:border-border-default transition-all"
                >
                  ↩ Desfazer tudo
                </button>
              )}

              {/* Template */}
              <span className="text-xs text-text-muted border-l border-border-subtle pl-2">
                {templateName}
              </span>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="px-4 py-1.5 border-b border-border-subtle bg-surface-bg flex items-center gap-3 text-xs text-text-muted shrink-0">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-surface-elevated inline-block border border-border-subtle" /> Normal
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-yellow-500/20 inline-block border border-yellow-500/30" /> Filler
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-red-500/20 inline-block border border-red-500/30" /> Removida
          </span>
          <span className="text-text-muted ml-auto italic">Clique para remover/restaurar</span>
        </div>

        {/* Word list */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex flex-wrap gap-1.5 content-start">
            {words.map((word) => {
              if (word.type === "silence") return null;

              const isPending = pendingIds.has(word.id);
              const baseStyle = "inline-flex items-center px-2 py-1 rounded-lg text-sm font-medium cursor-pointer select-none transition-all duration-150 border";

              let colorStyle = "";
              if (word.isRemoved) {
                colorStyle = "bg-red-500/10 text-text-muted border-red-500/20 line-through opacity-50 hover:opacity-70 hover:bg-red-500/20";
              } else if (word.isFiller) {
                colorStyle = "bg-yellow-500/10 text-yellow-300 border-yellow-500/20 hover:bg-yellow-500/20 hover:border-yellow-500/40";
              } else if (word.confidence !== null && word.confidence < 0.6) {
                colorStyle = "bg-orange-500/10 text-orange-300 border-orange-500/20 hover:bg-orange-500/20";
              } else {
                colorStyle = "bg-surface-elevated text-text-primary border-border-subtle hover:border-brand-accent/50 hover:bg-brand-accent/5 hover:text-brand-accent";
              }

              return (
                <button
                  key={word.id}
                  onClick={() => toggleWord(word.id)}
                  disabled={isPending}
                  title={`${word.startTime.toFixed(2)}s — ${word.endTime.toFixed(2)}s${word.isFiller ? " · filler" : ""}${word.confidence ? ` · ${Math.round(word.confidence * 100)}% conf` : ""}`}
                  className={`${baseStyle} ${colorStyle} ${isPending ? "opacity-60" : ""}`}
                >
                  {word.text}
                </button>
              );
            })}
          </div>
        </div>

        {/* B-Roll list (if any) */}
        {items.length > 0 && (
          <div className="flex-1 bg-surface-bg border-t border-border-subtle p-4 overflow-y-auto max-h-48">
            <h3 className="text-xs font-semibold text-text-muted mb-3 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-brand-accent animate-pulse" /> {items.length} B-Rolls Inteligentes Configurados
            </h3>
            <div className="flex gap-2 p-1 overflow-x-auto pb-2 snap-x">
              {items.map((it, idx) => {
                const isEditing = editingBrollId === it.id;
                const isItemSaving = aiActionSaving === `edit-${it.id}` || aiActionSaving === `delete-${it.id}`;

                return (
                  <div key={idx} className="shrink-0 w-32 bg-surface-card rounded-lg overflow-hidden border border-border-default snap-start group relative flex flex-col">
                    <div className="relative">
                      {isImgUrl(it.assetUrl || "") ? (
                        <img src={it.assetUrl} className="w-full h-16 object-cover bg-black/20" />
                      ) : (
                        <video src={it.assetUrl} className="w-full h-16 object-cover bg-black/20" preload="metadata" />
                      )}
                      
                      {/* Action Overlay */}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button 
                          onClick={() => { 
                            setEditingBrollId(it.id); 
                            setEditingPrompt(it.prompt || ""); 
                            setEditingStartTime(it.startTime || 0);
                            setEditingEndTime(it.endTime || 0);
                            setEditingMediaOffset((it as any).mediaOffset || 0);
                            setModalVideoDuration(0);
                          }}
                          disabled={isItemSaving}
                          className="bg-brand-accent text-white p-1.5 rounded hover:scale-110 transition-transform disabled:opacity-50"
                          title="Alterar busca"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                        </button>
                        <button 
                          onClick={() => deleteBroll(it.id)}
                          disabled={isItemSaving}
                          className="bg-red-500 text-white p-1.5 rounded hover:scale-110 transition-transform disabled:opacity-50"
                          title="Excluir B-Roll"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </div>
                      
                      {isItemSaving && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        </div>
                      )}
                    </div>
                    
                    <div className="p-1.5 opacity-90 flex-1 flex flex-col justify-between">
                      <p className="text-[9px] font-medium text-text-primary mb-0.5 truncate uppercase">{(it.prompt || "Video").substring(0, 15)}</p>
                      <p className="text-[8px] text-text-muted">{it.startTime?.toFixed(1)}s até {it.endTime?.toFixed(1)}s</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Painel direito — preview + export ─────────────────────────── */}
      <div className="flex-1 flex flex-col lg:flex-row gap-6 bg-surface-bg/50 p-6 overflow-y-auto w-full">
        
        {/* PLAYER DE VÍDEO (Centro) */}
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          
          {/* Player Container */}
          <div className="relative w-full max-w-[300px] xl:max-w-[340px] aspect-[9/16] bg-black/90 rounded-2xl overflow-hidden shadow-2xl border-2 border-surface-card mx-auto ring-1 ring-white/10 group cursor-pointer" onClick={togglePlay}>
            <video 
              ref={videoRef}
              src={videoUrl} 
              className="absolute inset-0 w-full h-full object-cover"
              playsInline
            />
            
            {/* Condicional B-roll Overlay */}
            {activeBroll && (
              isImgUrl(activeBroll.assetUrl || "") ? (
                <img 
                  key={activeBroll.assetUrl}
                  src={activeBroll.assetUrl} 
                  className={`absolute inset-0 object-cover pointer-events-none transition-all duration-300 ${activeBroll.layout === 'split-50-50' ? 'h-1/2 w-full' : activeBroll.layout === 'pip-top-right' ? 'w-28 h-40 right-4 top-4 left-auto bottom-auto rounded-xl shadow-xl' : 'h-full w-full'}`}
                />
              ) : (
                <video 
                  key={activeBroll.assetUrl}
                  src={activeBroll.assetUrl} 
                  className={`absolute inset-0 object-cover pointer-events-none transition-all duration-300 ${activeBroll.layout === 'split-50-50' ? 'h-1/2 w-full' : activeBroll.layout === 'pip-top-right' ? 'w-28 h-40 right-4 top-4 left-auto bottom-auto rounded-xl shadow-xl' : 'h-full w-full'}`}
                  autoPlay muted loop playsInline
                />
              )
            )}

            {/* Subtitle Overlay (Preview) */}
            {activeWord && !isCurrentlyCut && (
              <div className="absolute inset-x-0 bottom-32 flex items-center justify-center pointer-events-none px-6 tracking-wide">
                <span 
                  className="px-4 py-2 text-white font-black text-2xl lg:text-3xl text-center uppercase" 
                  style={{ textShadow: "0px 2px 10px rgba(0,0,0,0.8), 0px 0px 4px rgba(0,0,0,0.9)" }}
                >
                  {activeWord.text}
                </span>
              </div>
            )}
            
            {/* Cut Indicator Overlay */}
            {isCurrentlyCut && (
              <div className="absolute inset-x-0 bottom-12 flex flex-col items-center justify-center pointer-events-none animate-pulse">
                <span className="text-red-300 font-bold px-3 py-1 bg-black/80 rounded-lg text-xs border border-red-500/50 flex items-center gap-1.5 backdrop-blur-md">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  Corte Inteligente Aplicado
                </span>
              </div>
            )}

            {/* Big Play Button Overlay (when paused) */}
            {!isPlaying && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-[1px] pointer-events-none transition-all duration-300">
                <div className="w-16 h-16 rounded-full bg-brand-accent/90 text-white flex items-center justify-center animate-fade-in shadow-[0_0_30px_rgba(var(--brand-accent),0.4)]">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
            )}
          </div>

          {/* Player Timeline UI */}
          <div className="w-full max-w-[300px] xl:max-w-[340px] flex gap-3 px-1 items-center bg-surface-card/50 p-2.5 rounded-xl border border-border-subtle">
            {/* Play/Pause control */}
            <button 
              onClick={togglePlay}
              className="w-8 h-8 flex items-center justify-center shrink-0 rounded-full bg-surface-elevated hover:bg-surface-elevated-hover text-brand-accent transition-colors border border-brand-accent/20"
            >
              {isPlaying ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              )}
            </button>
            <span className="text-[10px] font-mono text-text-muted shrink-0 w-8">{currentTime.toFixed(1)}s</span>
            <input 
              type="range" 
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={(e) => {
                if (videoRef.current) videoRef.current.currentTime = Number(e.target.value);
              }}
              className="flex-1 h-1.5 bg-surface-elevated rounded-lg appearance-none cursor-pointer accent-brand-accent focus:outline-none"
            />
            <span className="text-[10px] font-mono text-text-muted shrink-0 w-8">{duration.toFixed(1)}s</span>
          </div>

        </div>

        {/* FERRAMENTAS (Direita) */}
        <div className="w-full lg:w-[320px] xl:w-[360px] flex flex-col gap-6 shrink-0">
        <div className="w-full max-w-xs bg-surface-card border border-brand-accent/30 rounded-2xl p-5 space-y-4 shadow-[0_0_20px_rgba(var(--brand-accent),0.05)]">
          <div className="flex items-center gap-2 mb-2 text-brand-accent">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
            <h3 className="text-sm font-black uppercase tracking-wider">Cérebro de Edição</h3>
          </div>

          <div className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-text-secondary">Corte Mágico de Silêncios</label>
              <div className="flex gap-2">
                <select 
                  id="silence-pace-select"
                  className="flex-1 bg-surface-bg border border-border-default rounded-lg px-2 text-xs text-text-primary focus:border-brand-accent focus:ring-1 focus:ring-brand-accent outline-none"
                  defaultValue="fast"
                >
                  <option value="extra_fast">Extra rápido (0.1s)</option>
                  <option value="fast">Rápido (0.2s)</option>
                  <option value="natural">Natural (0.6s)</option>
                </select>
                <button 
                  onClick={() => {
                    const sel = document.getElementById("silence-pace-select") as HTMLSelectElement;
                    applyAiEdit("remove-silence", sel.value);
                  }}
                  disabled={aiActionSaving !== null}
                  className="px-3 py-1.5 bg-brand-accent/15 text-brand-accent hover:bg-brand-accent/25 rounded-lg text-xs font-bold disabled:opacity-50 transition-colors"
                >
                  {aiActionSaving === "remove-silence" ? "..." : "Cortar"}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-text-secondary">Remover Takes Ruins</label>
              <button 
                onClick={() => applyAiEdit("remove-bad-takes")}
                disabled={aiActionSaving !== null}
                className="w-full flex items-center justify-center gap-2 py-2 bg-surface-elevated border border-border-default text-text-primary hover:border-brand-accent hover:text-brand-accent rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
              >
                {aiActionSaving === "remove-bad-takes" ? (
                  <div className="w-3 h-3 border-2 border-brand-accent border-t-transparent rounded-full animate-spin" />
                ) : "💥 Limpar gaguejos"}
              </button>
            </div>

            <div className="h-px w-full bg-border-subtle" />

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-text-secondary flex justify-between">
                Gerar B-Rolls Mágicos
                <span className="text-[10px] text-brand-accent px-1.5 py-0.5 rounded-sm bg-brand-accent/10 border border-brand-accent/20">3 créditos</span>
              </label>

              <div className="flex items-center justify-between text-[11px] text-text-muted px-1 mt-1">
                <span>Cobertura de vídeo:</span>
                <span id="broll-percentage-label" className="font-semibold text-text-primary">50%</span>
              </div>
              <input 
                type="range" id="broll-percentage" min="10" max="100" defaultValue="50" step="10"
                className="w-full h-1.5 bg-surface-bg rounded-lg appearance-none cursor-pointer accent-brand-accent border border-border-default mb-1"
                onChange={(e) => {
                  const label = document.getElementById("broll-percentage-label");
                  if (label) label.innerText = `${e.target.value}%`;
                }}
              />

              <div className="flex gap-2">
                <select 
                  id="broll-pace"
                  className="w-1/2 bg-surface-bg border border-border-default rounded-lg px-2 py-1.5 text-xs text-text-primary focus:border-brand-accent outline-none"
                  defaultValue="3.5"
                  title="Duração média de cada B-roll na tela"
                >
                  <option value="2.5">Rápido (~2.5s)</option>
                  <option value="3.5">Médio (~3.5s)</option>
                  <option value="5.5">Longo (~5.5s)</option>
                </select>

                <select 
                  id="broll-layout"
                  className="w-1/2 bg-surface-bg border border-border-default rounded-lg px-2 py-1.5 text-xs text-text-primary focus:border-brand-accent outline-none"
                >
                  <option value="cover">Tela Cheia</option>
                  <option value="split-50-50">50% Dividido</option>
                  <option value="pip-top-right">Mini-janela dir.</option>
                </select>
              </div>
              <button 
                onClick={applyBroll}
                disabled={aiActionSaving !== null}
                className="w-full flex items-center justify-center gap-2 mt-1 py-2 bg-brand-accent text-white hover:bg-brand-accent-hover rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
              >
                {aiActionSaving === "broll" ? (
                  <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> GPT Pensando...</>
                ) : "🎬 Buscar B-Rolls Inteligentes"}
              </button>
              <p className="text-[10px] text-text-muted text-center mt-1">Lê os timestamps e injeta vídeos contextuais do Pexels automaticamente.</p>
            </div>
          </div>
        </div>

        {/* Stats card */}
        <div className="w-full max-w-xs bg-surface-card border border-border-subtle rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-text-primary">Resumo da edição</h3>

          <div className="space-y-2">
            {[
              { label: "Palavras originais", value: visibleWords.length.toString() },
              { label: "Removidas", value: removedCount.toString(), color: removedCount > 0 ? "text-red-400" : undefined },
              { label: "Fillers", value: fillerCount.toString(), color: fillerCount > 0 ? "text-yellow-400" : undefined },
              { label: "Duração estimada", value: formatDuration(remainingDuration), color: "text-brand-accent" },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex items-center justify-between text-sm">
                <span className="text-text-muted">{label}</span>
                <span className={`font-medium ${color ?? "text-text-primary"}`}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Export button */}
        {exportStatus === "done" && downloadUrl ? (
          <a
            href={downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full max-w-xs flex items-center justify-center gap-2 px-5 py-3 bg-green-500 hover:bg-green-400 text-white font-semibold rounded-xl text-sm transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Baixar vídeo
          </a>
        ) : exportStatus === "exporting" ? (
          <div className="w-full max-w-xs flex flex-col items-center gap-3 px-5 py-4 bg-surface-card border border-brand-accent/30 rounded-xl">
            <div className="flex items-center gap-2 text-brand-accent font-semibold text-sm">
              <div className="w-4 h-4 border-2 border-brand-accent border-t-transparent rounded-full animate-spin" />
              Renderizando... {exportProgress}%
            </div>
            
            {/* Barra de progresso */}
            <div className="w-full bg-surface-elevated rounded-full h-2 overflow-hidden">
              <div 
                className="bg-brand-accent h-full transition-all duration-300 ease-out" 
                style={{ width: `${exportProgress}%` }}
              />
            </div>
            
            <span className="text-[10px] text-text-muted">
              {exportProgress < 30 ? "Preparando vídeo..." : 
               exportProgress < 60 ? "Cortando partes sujas..." : 
               exportProgress < 85 ? "Queimando as legendas..." : "Fazendo upload..."}
            </span>
          </div>
        ) : exportStatus === "error" ? (
          <button
            onClick={async () => {
              setExportStatus("loading");
              try {
                const res = await fetch(`/api/projects/${projectId}/export`, { method: "POST" });
                if (res.ok) {
                  setExportStatus("exporting");
                  setStatus("exporting");
                } else {
                  setExportStatus("error");
                }
              } catch { setExportStatus("error"); }
            }}
            className="w-full max-w-xs flex items-center justify-center gap-2 px-5 py-3 bg-red-500/20 border border-red-500/30 text-red-400 font-semibold rounded-xl text-sm hover:bg-red-500/30 transition-colors"
          >
            Tentar novamente
          </button>
        ) : (
          <button
            onClick={async () => {
              setExportStatus("loading");
              try {
                const res = await fetch(`/api/projects/${projectId}/export`, { method: "POST" });
                if (res.ok) {
                  setExportStatus("exporting");
                  setStatus("exporting");
                  showToast("Export iniciado — aguarde...");
                } else {
                  setExportStatus("error");
                  showToast("Erro ao iniciar export");
                }
              } catch {
                setExportStatus("error");
              }
            }}
            disabled={exportStatus === "loading"}
            className="w-full max-w-xs flex items-center justify-center gap-2 px-5 py-3 bg-brand-accent hover:bg-brand-accent-hover text-white font-semibold rounded-xl text-sm transition-all hover:scale-105 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            {exportStatus === "loading" ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            )}
            Exportar vídeo
          </button>
        )}

        <p className="text-xs text-text-muted text-center max-w-xs">
          {exportStatus === "exporting"
            ? "Renderizando legendas com FFmpeg — pode levar alguns minutos."
            : "Gera MP4 com legendas queimadas para download imediato."}
        </p>
        </div>
      </div>

      {/* Edit B-Roll Modal */}
      {editingBrollId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/80 backdrop-blur-sm" 
            onClick={() => setEditingBrollId(null)}
          />
          
          {/* Modal Content */}
          <div className="relative w-full max-w-md bg-surface-elevated border border-border-default shadow-2xl rounded-2xl p-6 flex flex-col gap-5 animate-fade-in">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-text-primary">Editar Mídia do B-Roll</h2>
                <p className="text-sm text-text-secondary mt-1">
                  Altere a palavra-chave de pesquisa ou os momentos de início e fim deste clipe.
                </p>
              </div>
              <button 
                onClick={() => setEditingBrollId(null)}
                className="text-text-muted hover:text-text-primary p-1 bg-surface-card rounded-md border border-transparent hover:border-border-default transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-text-muted">Prompt de Pesquisa Pexels:</label>
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={aiActionSaving?.startsWith("upload-")}
                    className="text-[10px] font-bold uppercase tracking-wider text-brand-accent hover:text-brand-accent-hover flex items-center gap-1 disabled:opacity-50"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
                    Fazer Upload Local
                  </button>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept="video/*,image/*" 
                    onChange={handleBrollUpload} 
                  />
                </div>
                <input 
                  autoFocus
                  value={editingPrompt}
                  onChange={(e) => setEditingPrompt(e.target.value)}
                  onKeyDown={(e) => { 
                    if (e.key === "Enter") saveBrollEdit(editingBrollId); 
                    if (e.key === "Escape") setEditingBrollId(null); 
                  }}
                  className="w-full bg-surface-bg border-2 border-border-default focus:border-brand-accent text-base text-text-primary rounded-xl px-4 py-3 outline-none transition-colors disabled:opacity-50"
                  placeholder="Exemplo: cinematic relaxing coffee..."
                  disabled={aiActionSaving?.startsWith("upload-")}
                />
              </div>

              {/* Instagram Audio-like B-roll Scrubber */}
              {editingBrollId && items.find(i => i.id === editingBrollId)?.assetUrl && (
                <div className="relative border border-border-subtle rounded-xl p-3 bg-surface-bg flex flex-col gap-3">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-24 bg-black rounded-lg overflow-hidden shrink-0 ring-1 ring-border-default">
                      {isImgUrl(items.find(i => i.id === editingBrollId)?.assetUrl || "") ? (
                        <img 
                          src={items.find(i => i.id === editingBrollId)?.assetUrl} 
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <video 
                          ref={modalVideoRef}
                          src={items.find(i => i.id === editingBrollId)?.assetUrl} 
                          className="w-full h-full object-cover"
                          autoPlay muted loop playsInline
                          onLoadedMetadata={(e) => setModalVideoDuration(e.currentTarget.duration)}
                        />
                      )}
                    </div>
                    <div className="flex-1 flex flex-col gap-2">
                      <div className="flex justify-between items-center text-xs font-medium">
                        <span className="text-text-primary">Selecionar Trecho do B-Roll</span>
                        <span className="text-brand-accent bg-brand-accent/10 px-1.5 py-0.5 rounded">
                          Duração: {(editingEndTime - editingStartTime).toFixed(1)}s
                        </span>
                      </div>
                      
                      <div className="relative w-full h-8 flex items-center">
                        <div className="absolute inset-0 bg-surface-card rounded-md border border-border-default overflow-hidden">
                          {/* Visual waveform placeholder */}
                          <div className="absolute inset-0 flex items-center justify-between px-1 opacity-20">
                            {Array.from({ length: 30 }).map((_, i) => (
                              <div key={i} className="w-1 bg-text-muted rounded-full" style={{ height: `${Math.random() * 60 + 20}%` }} />
                            ))}
                          </div>
                        </div>

                        {/* Slider overlay */}
                        <div className="absolute inset-0 z-10 w-full flex items-center">
                          <input 
                            type="range"
                            min="0"
                            max={Math.max(0, modalVideoDuration - (editingEndTime - editingStartTime))}
                            step="0.1"
                            value={editingMediaOffset}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setEditingMediaOffset(val);
                              if (modalVideoRef.current) {
                                modalVideoRef.current.currentTime = val;
                              }
                            }}
                            className="w-full opacity-0 cursor-pointer absolute inset-0 z-20"
                            title="Deslize o seletor"
                          />
                          <div 
                            className="absolute h-full border-2 border-brand-accent rounded-md shadow-[0_0_10px_rgba(var(--brand-accent),0.4)] pointer-events-none transition-all duration-100"
                            style={{ 
                              left: modalVideoDuration ? `${(editingMediaOffset / modalVideoDuration) * 100}%` : '0%',
                              width: modalVideoDuration ? `${((editingEndTime - editingStartTime) / modalVideoDuration) * 100}%` : '20%',
                              minWidth: '24px'
                            }}
                          >
                            <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-0.5 bg-brand-accent/50" />
                          </div>
                        </div>
                      </div>
                      <p className="text-[10px] text-text-muted text-center mt-1">
                        Início: <span className="text-text-primary">{editingMediaOffset.toFixed(1)}s</span> — 
                        Fim: <span className="text-text-primary">{(editingMediaOffset + (editingEndTime - editingStartTime)).toFixed(1)}s</span>
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-text-muted mb-1.5 flex items-center gap-1">
                    Ancorar no Vídeo Principal: Início (s)
                  </label>
                  <input 
                    type="number" step="0.1" min="0"
                    value={editingStartTime}
                    onChange={(e) => setEditingStartTime(Number(e.target.value))}
                    className="w-full bg-surface-bg border-2 border-transparent border-t-border-subtle focus:border-border-default text-md text-text-primary rounded-lg px-2 py-1 outline-none transition-colors"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-text-muted mb-1.5 flex items-center gap-1">
                    Fim (s)
                  </label>
                  <input 
                    type="number" step="0.1" min="0"
                    value={editingEndTime}
                    onChange={(e) => setEditingEndTime(Number(e.target.value))}
                    className="w-full bg-surface-bg border-2 border-transparent border-t-border-subtle focus:border-border-default text-md text-text-primary rounded-lg px-2 py-1 outline-none transition-colors"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 mt-2 pt-4 border-t border-border-subtle">
              {items.find(i => i.id === editingBrollId)?.type === "user_broll" && (
                <button 
                  onClick={handleCreateMotionGraphics}
                  disabled={aiActionSaving?.startsWith("motion-")}
                  className="px-4 py-2 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/30 font-bold rounded-lg transition-colors flex items-center gap-2 text-xs uppercase"
                  title="Transforma esta foto num Vídeo Animado!"
                >
                  {aiActionSaving === `motion-${editingBrollId}` ? (
                    <><div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" /> Renderizando Magia...</>
                  ) : (
                    <>✨ Transformar em Motion</>
                  )}
                </button>
              )}
              
              <div className="flex items-center gap-3 ml-auto">
                <button 
                  onClick={() => setEditingBrollId(null)}
                  className="px-4 py-2 bg-surface-card hover:bg-border-subtle border border-border-default text-text-secondary font-medium rounded-lg transition-colors text-sm"
                >
                  Cancelar
                </button>
                <button 
                  onClick={() => saveBrollEdit(editingBrollId)}
                  disabled={aiActionSaving === `edit-${editingBrollId}` || !editingPrompt.trim() || editingStartTime >= editingEndTime}
                  className="px-6 py-2 bg-brand-accent hover:bg-brand-accent-hover text-white font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm shadow-[0_0_15px_rgba(var(--brand-accent),0.3)] hover:shadow-[0_0_20px_rgba(var(--brand-accent),0.5)]"
                >
                  {aiActionSaving === `edit-${editingBrollId}` ? (
                    <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Salvando...</>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                      Aplicar Alterações
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
