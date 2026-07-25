/** SVG storage-tank gauge: cylindrical body, liquid fill, incoming overlay,
 *  dry-out floor and tank-top ceiling markers. */
export function TankGauge({ id, fillPct, minPct, maxPct = 0.95, incomingPct = 0, color, height = 150 }: {
  id: string; fillPct: number; minPct: number; maxPct?: number; incomingPct?: number; color: string; height?: number;
}) {
  const W = 100, H = 150;
  const bodyTop = 18, bodyBot = 134, bodyH = bodyBot - bodyTop, bx = 22, bw = 56;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const yFor = (pct: number) => bodyBot - clamp(pct) * bodyH;
  const fillY = yFor(fillPct);
  const incTop = yFor(clamp(fillPct + incomingPct));
  const clip = `tankclip-${id}`, grad = `tankgrad-${id}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.95" />
          <stop offset="100%" stopColor={color} stopOpacity="0.6" />
        </linearGradient>
        <clipPath id={clip}>
          <rect x={bx} y={bodyTop} width={bw} height={bodyH} rx="10" />
        </clipPath>
      </defs>

      {/* shell */}
      <rect x={bx} y={bodyTop} width={bw} height={bodyH} rx="10" fill="#0b1220" stroke="#ffffff22" strokeWidth="1.5" />
      <ellipse cx={W / 2} cy={bodyTop} rx={bw / 2} ry="5" fill="#0b1220" stroke="#ffffff22" strokeWidth="1.5" />

      <g clipPath={`url(#${clip})`}>
        {/* incoming (ghosted) */}
        {incomingPct > 0 && <rect x={bx} y={incTop} width={bw} height={fillY - incTop} fill={color} opacity="0.28" />}
        {/* current liquid */}
        <rect x={bx} y={fillY} width={bw} height={bodyBot - fillY} fill={`url(#${grad})`} />
        {/* surface ellipse */}
        <ellipse cx={W / 2} cy={fillY} rx={bw / 2} ry="4" fill={color} opacity="0.9" />
        {/* dry-out floor marker */}
        <line x1={bx} x2={bx + bw} y1={yFor(minPct)} y2={yFor(minPct)} stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 3" />
        {/* tank-top ceiling marker */}
        <line x1={bx} x2={bx + bw} y1={yFor(maxPct)} y2={yFor(maxPct)} stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4 3" />
      </g>

      {/* fill % label */}
      <text x={W / 2} y={bodyTop + bodyH / 2} textAnchor="middle" dominantBaseline="middle" fill="#e2e8f0" fontSize="15" fontWeight="600" style={{ paintOrder: 'stroke', stroke: '#0b1220', strokeWidth: 3 }}>
        {Math.round(clamp(fillPct) * 100)}%
      </text>
    </svg>
  );
}
