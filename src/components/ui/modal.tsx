import { useEffect, ReactNode } from 'react';
import { X } from 'lucide-react';

/** Lightweight modal: fixed overlay, click-outside + ESC to close. */
export function Modal({ open, onClose, title, subtitle, children, width = 'max-w-2xl' }: {
  open: boolean; onClose: () => void; title?: ReactNode; subtitle?: ReactNode; children: ReactNode; width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in" />
      <div onClick={e => e.stopPropagation()} className={`relative ${width} w-full max-h-[88vh] overflow-auto rounded-xl border border-border/80 bg-card shadow-2xl`}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 px-5 py-4 border-b border-border/60 bg-card/95 backdrop-blur">
          <div>
            {title && <h3 className="text-base font-semibold text-foreground">{title}</h3>}
            {subtitle && <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
