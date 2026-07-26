/**
 * Sea-chart primitives — the visual grammar of the app.
 * StreamMark is a chart "sounding" chip: a rounded-md plate carrying the stream's
 * initial in its own depth colour (POL cyan, CRUDE sea-green, LNG amber).
 * Pennant is a small triangular chart tick used to flag exceptions by urgency.
 * Exported under the legacy names (StreamFlag/Pennant/CodeBlock) to stay drop-in.
 */

const CYAN = 'var(--sea-cyan)', GREEN = 'var(--sea-green)', AMBER = 'var(--sea-amber)', RED = 'var(--sea-red)';

export const streamTone = (s: string) => (s === 'CRUDE' ? GREEN : s === 'LNG' ? AMBER : CYAN);

/** Depth-sounding chip: the stream's initial on a tinted chart plate. */
export function StreamFlag({ stream, size = 20 }: { stream: string; size?: number }) {
  const tone = streamTone(stream);
  const letter = stream === 'CRUDE' ? 'C' : stream === 'LNG' ? 'L' : 'P';
  return (
    <span
      role="img"
      aria-label={`${stream} stream`}
      className="inline-flex items-center justify-center shrink-0 font-mono font-medium"
      style={{
        width: size * 1.35,
        height: size,
        fontSize: size * 0.56,
        color: tone,
        background: 'color-mix(in srgb, ' + 'currentColor' + ' 0%, transparent)',
        border: `1px solid ${tone}`,
        borderRadius: 3,
        boxShadow: `inset 0 0 0 999px color-mix(in srgb, ${tone} 12%, transparent)`,
        lineHeight: 1,
      }}
    >
      {letter}
    </span>
  );
}

const TONE: Record<string, string> = { critical: RED, warn: AMBER, ok: GREEN, info: CYAN };

/** Triangular chart tick — urgency marker for exceptions and alerts. */
export function Pennant({ tone = 'info', size = 16 }: { tone?: 'critical' | 'warn' | 'ok' | 'info'; size?: number }) {
  const w = size * 0.8, h = size;
  return (
    <svg width={w} height={h} viewBox="0 0 16 20" className="shrink-0" style={{ display: 'block' }} aria-hidden="true">
      <polygon points="0,10 16,2 16,18" fill={TONE[tone]} />
    </svg>
  );
}

/** A single coded square block, as used in a chart legend. */
export function CodeBlock({ color, size = 12 }: { color: string; size?: number }) {
  return <span className="inline-block align-middle" style={{ width: size, height: size, background: color, borderRadius: 2, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.3)' }} />;
}
