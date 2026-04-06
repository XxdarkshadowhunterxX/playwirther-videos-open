// app/(app)/editor/[id]/broll/page.tsx
export default function BrollPage() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <div className="w-12 h-12 bg-surface-elevated rounded-xl flex items-center justify-center mx-auto mb-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
          </svg>
        </div>
        <p className="text-sm font-medium text-text-primary">B-Roll AI</p>
        <p className="text-xs text-text-muted mt-1">Em breve — Sprint 2</p>
      </div>
    </div>
  );
}
