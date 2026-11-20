import React, { useId, useState } from 'react';

export interface BarDatum {
  label: string;
  value: number;
  secondaryLabel?: string;
}

export const SimpleBarChart: React.FC<{
  data: BarDatum[];
  unit?: string;
  barColor?: string;
  emptyText?: string;
}> = ({
  data,
  unit = '',
  barColor = '#39FF88',
  emptyText = 'No activity recorded yet.',
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const hasData = data.some((d) => d.value > 0);

  if (!hasData) {
    return (
      <div className="h-48 flex items-center justify-center font-body text-sm sm:text-base text-slate-500 dark:text-[#94A3B8] border border-dashed border-slate-200 dark:border-[#263D5C] rounded-xl px-4 text-center">
        {emptyText}
      </div>
    );
  }

  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const midVal = Math.round(maxVal / 2);
  const isDense = data.length > 12;
  const labelInterval = data.length > 20 ? 5 : data.length > 10 ? 2 : 1;
  const activeItem = hoveredIdx !== null ? data[hoveredIdx] : null;

  return (
    <div className="space-y-2">
      {/* Hover summary readout (always reserves 1 line to prevent layout shift) */}
      <div className="h-5 flex items-center justify-end text-xs sm:text-sm font-mono-tabular text-slate-500 dark:text-[#94A3B8]">
        {activeItem ? (
          <span className="text-slate-900 dark:text-[#F1F5F9] font-medium">
            {activeItem.label}: {activeItem.value}
            {unit}
            {activeItem.secondaryLabel ? ` (${activeItem.secondaryLabel})` : ''}
          </span>
        ) : (
          <span>Peak: {maxVal}{unit}</span>
        )}
      </div>

      <div className="relative h-44 flex gap-2">
        {/* Y-Axis reference scale */}
        <div className="flex flex-col justify-between pb-5 text-[11px] font-mono-tabular text-slate-400 dark:text-[#94A3B8]/80 select-none shrink-0 w-9 text-right pr-1">
          <span>{maxVal}{unit}</span>
          <span>{midVal}{unit}</span>
          <span>0</span>
        </div>

        {/* Plot area */}
        <div className="relative flex-1 flex flex-col">
          {/* Horizontal gridlines */}
          <div className="relative flex-1 flex items-end gap-1 sm:gap-1.5">
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
              <div className="border-t border-dashed border-slate-200/80 dark:border-[#263D5C]/80 w-full" />
              <div className="border-t border-dashed border-slate-200/80 dark:border-[#263D5C]/80 w-full" />
              <div className="border-t border-slate-200 dark:border-[#263D5C] w-full" />
            </div>

            {data.map((item, idx) => {
              const pct = item.value > 0 ? Math.max(4, Math.round((item.value / maxVal) * 100)) : 0;
              const isHovered = hoveredIdx === idx;
              return (
                <div
                  key={`${item.label}-${idx}`}
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  className="relative z-10 flex-1 h-full flex flex-col items-center justify-end group"
                  title={`${item.label}: ${item.value}${unit}${
                    item.secondaryLabel ? ` (${item.secondaryLabel})` : ''
                  }`}
                >
                  {!isDense && item.value > 0 && (
                    <span className="mb-1 text-[11px] font-mono-tabular text-slate-500 dark:text-[#94A3B8] opacity-85 group-hover:opacity-100 transition-opacity">
                      {item.value}
                      {unit}
                    </span>
                  )}
                  <div className="w-full max-w-[34px] flex-1 flex items-end">
                    <div
                      style={{
                        height: item.value > 0 ? `${pct}%` : '2px',
                        backgroundColor:
                          item.value > 0 ? barColor : 'rgba(148,163,184,0.2)',
                        opacity:
                          hoveredIdx !== null && !isHovered && item.value > 0 ? 0.55 : 1,
                      }}
                      className="w-full rounded-t transition-all duration-300 ease-out"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* X-Axis labels */}
          <div className="h-5 flex items-center gap-1 sm:gap-1.5 pt-1">
            {data.map((item, idx) => {
              const showLabel =
                idx === 0 || idx === data.length - 1 || idx % labelInterval === 0;
              return (
                <div
                  key={`lbl-${item.label}-${idx}`}
                  className="flex-1 text-center text-[11px] font-mono-tabular text-slate-500 dark:text-[#94A3B8] truncate"
                >
                  {showLabel ? item.label : ''}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export interface LineDatum {
  label: string;
  value: number;
  secondaryLabel?: string;
}

function buildSmoothPath(points: Array<{ x: number; y: number }>, minY: number, maxY: number): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  const clampY = (y: number) => Math.max(minY, Math.min(maxY, y));
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = clampY(p1.y + (p2.y - p0.y) / 6);
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = clampY(p2.y - (p3.y - p1.y) / 6);

    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(
      2
    )}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

export const SimpleLineChart: React.FC<{
  data: LineDatum[];
  unit?: string;
  strokeColor?: string;
  emptyText?: string;
}> = ({
  data,
  unit = '%',
  strokeColor = '#39FF88',
  emptyText = 'No data points yet.',
}) => {
  const gradientId = useId();
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center font-body text-sm sm:text-base text-slate-500 dark:text-[#94A3B8] border border-dashed border-slate-200 dark:border-[#263D5C] rounded-xl px-4 text-center">
        {emptyText}
      </div>
    );
  }

  const width = 480;
  const height = 152;
  const padLeft = 36;
  const padRight = 14;
  const padTop = 14;
  const padBottom = 16;
  const minVal = 0;
  const maxVal = Math.max(100, ...data.map((d) => d.value));

  const plotBottom = height - padBottom;
  const plotTop = padTop;

  const points = data.map((d, idx) => {
    const x =
      data.length === 1
        ? (padLeft + width - padRight) / 2
        : padLeft + (idx / (data.length - 1)) * (width - padLeft - padRight);
    const y =
      plotBottom - ((d.value - minVal) / (maxVal - minVal || 1)) * (plotBottom - plotTop);
    return { x, y, ...d };
  });

  const smoothLineD = buildSmoothPath(points, plotTop, plotBottom);
  const areaD =
    points.length > 1
      ? `${smoothLineD} L ${points[points.length - 1].x.toFixed(2)} ${plotBottom} L ${points[0].x.toFixed(
          2
        )} ${plotBottom} Z`
      : '';

  const activePoint = hoveredIdx !== null ? points[hoveredIdx] : points[points.length - 1];
  const labelStride = data.length > 10 ? Math.ceil(data.length / 6) : 1;

  return (
    <div className="space-y-2">
      {/* Summary / active point readout */}
      <div className="h-5 flex items-center justify-end text-xs sm:text-sm font-mono-tabular text-slate-500 dark:text-[#94A3B8]">
        {activePoint && (
          <span className="text-slate-900 dark:text-[#F1F5F9] font-medium">
            {hoveredIdx !== null ? activePoint.label : 'Latest'}:{' '}
            {Math.round(activePoint.value)}
            {unit}
            {activePoint.secondaryLabel ? ` · ${activePoint.secondaryLabel}` : ''}
          </span>
        )}
      </div>

      <div className="w-full">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-40 overflow-visible">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity="0.28" />
              <stop offset="100%" stopColor={strokeColor} stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Horizontal reference gridlines & Y-axis labels */}
          {[0, 0.5, 1].map((ratio) => {
            const y = plotBottom - ratio * (plotBottom - plotTop);
            const tickVal = Math.round(minVal + ratio * (maxVal - minVal));
            return (
              <g key={ratio}>
                <line
                  x1={padLeft}
                  x2={width - padRight}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  className="text-slate-200 dark:text-[#263D5C]"
                  strokeDasharray={ratio === 0 ? undefined : '3 3'}
                />
                <text
                  x={padLeft - 6}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-slate-400 dark:fill-[#94A3B8] text-[11px] font-mono-tabular"
                >
                  {tickVal}
                  {unit}
                </text>
              </g>
            );
          })}

          {/* Subtle gradient area under smooth curve */}
          {points.length > 1 && <path d={areaD} fill={`url(#${gradientId})`} />}

          {/* Smooth line */}
          {points.length > 1 && (
            <path
              d={smoothLineD}
              fill="none"
              stroke={strokeColor}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Hover vertical guide */}
          {hoveredIdx !== null && points[hoveredIdx] && (
            <line
              x1={points[hoveredIdx].x}
              x2={points[hoveredIdx].x}
              y1={plotTop}
              y2={plotBottom}
              stroke={strokeColor}
              strokeOpacity="0.35"
              strokeDasharray="2 2"
            />
          )}

          {/* Interactive nodes */}
          {points.map((p, idx) => {
            const isActive = hoveredIdx === idx;
            return (
              <g
                key={`${p.label}-${idx}`}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                className="cursor-pointer"
              >
                <circle cx={p.x} cy={p.y} r="10" fill="transparent" />
                {isActive && (
                  <circle cx={p.x} cy={p.y} r="7" fill={strokeColor} fillOpacity="0.22" />
                )}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isActive ? 4.5 : points.length > 16 ? 2.8 : 3.5}
                  fill={strokeColor}
                  stroke="#080F1E"
                  strokeWidth="1.2"
                />
              </g>
            );
          })}
        </svg>

        {/* Sparse clean X-axis labels */}
        <div
          className="flex justify-between text-[11px] font-mono-tabular text-slate-500 dark:text-[#94A3B8]"
          style={{ paddingLeft: `${(padLeft / width) * 100}%`, paddingRight: `${(padRight / width) * 100}%` }}
        >
          {data.map((d, i) => {
            const show = i === 0 || i === data.length - 1 || i % labelStride === 0;
            if (!show && data.length > 10) return null;
            return (
              <span key={`${d.label}-${i}`} className="truncate max-w-[68px]">
                {d.label}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};
