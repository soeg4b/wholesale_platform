'use client';

// Minimal SVG bar chart (no chart library). Multiple series are stacked side by side per label.
export function Bars({
  labels,
  series,
  height = 140,
  format = (v: number) => String(v),
}: {
  labels: string[];
  series: { name: string; values: number[]; color: string }[];
  height?: number;
  format?: (v: number) => string;
}) {
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const groupW = 100 / Math.max(1, labels.length);
  const barW = (groupW * 0.8) / Math.max(1, series.length);
  return (
    <div>
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="h-36 w-full"
        role="img"
      >
        {labels.map((l, i) =>
          series.map((s, j) => {
            const v = s.values[i] ?? 0;
            const h = (v / max) * (height - 4);
            return (
              <rect
                key={`${l}-${s.name}`}
                x={i * groupW + groupW * 0.1 + j * barW}
                y={height - h}
                width={barW * 0.9}
                height={h}
                fill={s.color}
              >
                <title>{`${l} ${s.name}: ${format(v)}`}</title>
              </rect>
            );
          }),
        )}
      </svg>
      <div className="flex justify-between text-[10px] text-slate-500">
        {labels.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
      {series.length > 1 && (
        <div className="mt-1 flex gap-3 text-xs text-slate-400">
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
