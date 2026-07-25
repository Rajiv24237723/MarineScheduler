import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info';
interface Toast { id: number; message: string; kind: ToastKind }

let items: Toast[] = [];
let seq = 0;
const listeners = new Set<(t: Toast[]) => void>();
const emit = () => listeners.forEach(l => l([...items]));

export function toast(message: string, kind: ToastKind = 'info', ms = 3800) {
  const id = ++seq;
  items = [...items, { id, message, kind }];
  emit();
  setTimeout(() => dismiss(id), ms);
  return id;
}
export function dismiss(id: number) { items = items.filter(t => t.id !== id); emit(); }

const styles: Record<ToastKind, { icon: any; cls: string }> = {
  success: { icon: CheckCircle2, cls: 'text-emerald-400 border-emerald-500/30' },
  error: { icon: AlertTriangle, cls: 'text-red-400 border-red-500/30' },
  info: { icon: Info, cls: 'text-indigo-300 border-indigo-500/30' },
};

export function Toaster() {
  const [list, setList] = useState<Toast[]>([]);
  useEffect(() => { listeners.add(setList); return () => { listeners.delete(setList); }; }, []);
  return (
    <div className="fixed bottom-5 right-5 z-[3500] flex flex-col gap-2 w-80 max-w-[calc(100vw-2.5rem)]">
      {list.map(t => {
        const s = styles[t.kind]; const Icon = s.icon;
        return (
          <div key={t.id} className={`animate-toast-in flex items-start gap-2.5 rounded-lg border ${s.cls} bg-card/95 backdrop-blur px-3.5 py-2.5 shadow-xl`}>
            <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${s.cls.split(' ')[0]}`} />
            <div className="text-xs text-foreground/90 flex-1 leading-snug">{t.message}</div>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-muted-foreground hover:text-foreground shrink-0"><X className="w-3.5 h-3.5" /></button>
          </div>
        );
      })}
    </div>
  );
}

/** Slim indeterminate progress bar pinned to the top of the viewport. */
export function TopProgress({ active }: { active: boolean }) {
  if (!active) return null;
  return <div className="progress-track" role="progressbar" aria-label="Working"><div className="progress-bar" /></div>;
}
