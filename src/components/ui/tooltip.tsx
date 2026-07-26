import * as T from '@radix-ui/react-tooltip';
import { ReactNode, Key } from 'react';

/** One shared tooltip provider — mount once near the app root. */
export function TipProvider({ children }: { children: ReactNode }) {
  return <T.Provider delayDuration={120} skipDelayDuration={300}>{children}</T.Provider>;
}

/**
 * Hover/focus detail popover in the Bathymetric-Blue grammar. Wrap any single DOM
 * element; pass rich `content`. Requires a <TipProvider> ancestor (mounted in App).
 */
export function Tip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; key?: Key }) {
  if (content == null || content === false) return <>{children}</>;
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          collisionPadding={10}
          className="z-[4000] max-w-xs rounded-md border border-border/80 bg-popover/95 backdrop-blur-sm px-3 py-2 text-xs text-foreground/90 shadow-lg shadow-black/40 animate-scale-in"
        >
          {content}
          <T.Arrow className="fill-popover" width={10} height={5} />
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

/** A titled key→value block for tooltip bodies. */
export function TipRows({ title, rows }: { title?: string; rows: [string, ReactNode][] }) {
  return (
    <div className="space-y-1">
      {title && <div className="font-cond text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{title}</div>}
      <div className="space-y-0.5">
        {rows.map(([k, v], i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">{k}</span>
            <span className="font-mono text-foreground/90 tabular-nums">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
