// app/(app)/editor/[id]/trim/page.tsx
export default function TrimPage() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <div className="w-12 h-12 bg-surface-elevated rounded-xl flex items-center justify-center mx-auto mb-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-muted">
            <path d="M6 20V4M18 20V4M4 8h4M16 8h4M4 16h4M16 16h4" />
          </svg>
        </div>
        <p className="text-sm font-medium text-text-primary">Silence Removal</p>
        <p className="text-xs text-text-muted mt-1">Em breve — Sprint 2</p>
      </div>
    </div>
  );
}
