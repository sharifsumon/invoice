"use client";

import { useState } from "react";

export interface BarDatum { label: string; values: number[] }
export interface BarSeries { name: string; color: string }

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
const compact = (v: number) =>
  Math.abs(v) >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${+(v / 1e3).toFixed(1)}k` : `${Math.round(v)}`;
const full = (v: number, cur: string) => `${cur} ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Grouped bar chart (one currency). Thin bars with 4px rounded data-ends on the baseline, 2px gaps,
 * recessive grid, legend + per-group hover tooltip, and an equivalent table for screen readers.
 */
export function GroupedBarChart({ data, series, currency, height = 260 }: { data: BarDatum[]; series: BarSeries[]; currency: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = height, padL = 44, padR = 8, padT = 12, padB = 28;
  const max = niceMax(Math.max(0, ...data.flatMap((d) => d.values)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const groupW = plotW / Math.max(1, data.length);
  const barW = Math.max(4, Math.min(18, (groupW * 0.62 - 2 * (series.length - 1)) / series.length));
  const y = (v: number) => padT + plotH - (v / max) * plotH;

  return (
    <div className="relative">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-slate-600" aria-hidden>
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.name}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" role="img"
        aria-label={`${series.map((s) => s.name).join(" and ")} by month, ${currency}`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth={1} strokeDasharray={t === 0 ? undefined : "3 4"} />
            <text x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-slate-400 text-[11px]">{compact(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const gx = padL + i * groupW;
          const total = series.length * barW + (series.length - 1) * 2;
          const x0 = gx + (groupW - total) / 2;
          return (
            <g key={d.label}>
              {hover === i && <rect x={gx + 2} y={padT} width={groupW - 4} height={plotH} rx={6} fill="#f1f5f9" />}
              {d.values.map((v, si) => {
                const h = Math.max(0, y(0) - y(v));
                const x = x0 + si * (barW + 2);
                const r = Math.min(4, barW / 2, h);
                // Rounded top (data end), square bottom anchored to the baseline.
                const path = h <= 0 ? "" :
                  `M${x},${y(0)} V${y(v) + r} Q${x},${y(v)} ${x + r},${y(v)} H${x + barW - r} Q${x + barW},${y(v)} ${x + barW},${y(v) + r} V${y(0)} Z`;
                return path ? <path key={si} d={path} fill={series[si].color} /> : null;
              })}
              <text x={gx + groupW / 2} y={H - 8} textAnchor="middle" className="fill-slate-500 text-[11px]">{d.label}</text>
              {/* Hit target: the whole column, larger than the bars */}
              <rect x={gx} y={padT} width={groupW} height={plotH + padB} fill="transparent"
                onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1} />
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <div className="pointer-events-none absolute top-8 z-10 w-[230px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
          style={{ left: `clamp(0px, calc(${((padL + (hover + 0.5) * groupW) / W) * 100}% - 115px), calc(100% - 230px))` }}>
          <div className="mb-1 font-semibold text-slate-900">{data[hover].label}</div>
          {series.map((s, si) => (
            <div key={s.name} className="flex items-center justify-between gap-4 text-slate-600">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.name}</span>
              <span className="tabular whitespace-nowrap font-medium text-slate-900">{full(data[hover].values[si], currency)}</span>
            </div>
          ))}
        </div>
      )}
      <table className="sr-only">
        <caption>{series.map((s) => s.name).join(" and ")} by month ({currency})</caption>
        <thead><tr><th>Month</th>{series.map((s) => <th key={s.name}>{s.name}</th>)}</tr></thead>
        <tbody>{data.map((d) => <tr key={d.label}><td>{d.label}</td>{d.values.map((v, i) => <td key={i}>{full(v, currency)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
