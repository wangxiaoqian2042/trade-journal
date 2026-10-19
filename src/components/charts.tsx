import React, { useMemo, useState } from "react";
import { CurvePoint, DayPnl, GroupStat, drawdownSeries } from "../services/analytics";
import { Trade } from "../types";
import { fmtPct, money, toneClass } from "./ui";

/** 鼠标 x → 第几个数据点（两图共用，保证悬停和点选落到同一个点上） */
function indexFromEvent(e: React.MouseEvent<SVGSVGElement>, count: number): number {
  const rect = e.currentTarget.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const idx = Math.round(ratio * (count - 1));
  return Number.isFinite(idx) ? Math.max(0, Math.min(count - 1, idx)) : 0;
}

/** 权益曲线：面积 + 折线，带悬停读数 */
export function EquityCurve(props: {
  points: CurvePoint[];
  cur: string;
  /** 点选某一点（0 基下标，对应按时间排序后的第 i 笔） */
  onPick?: (index: number) => void;
}) {
  const { points, cur, onPick } = props;
  const [hover, setHover] = useState<number | null>(null);

  const W = 800;
  const H = 240;
  const padL = 10;
  const padR = 10;
  const padT = 16;
  const padB = 22;

  const { min, max, path, area, coords } = useMemo(() => {
    const values = [0, ...points.map((p) => p.equity)];
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const span = hi - lo;
    lo -= span * 0.08;
    hi += span * 0.08;

    const n = points.length;
    const x = (i: number) =>
      padL + (n <= 1 ? (W - padL - padR) / 2 : ((W - padL - padR) * i) / (n - 1));
    const y = (v: number) =>
      padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo));

    const cs = points.map((p, i) => ({ x: x(i), y: y(p.equity), p }));
    const line = cs.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" ");
    const zeroY = y(0);
    const areaPath =
      cs.length > 0
        ? `${line} L${cs[cs.length - 1].x.toFixed(2)},${zeroY.toFixed(2)} L${cs[0].x.toFixed(2)},${zeroY.toFixed(2)} Z`
        : "";
    return { min: lo, max: hi, path: line, area: areaPath, coords: cs };
  }, [points]);

  if (!points.length) {
    return <div className="tj-chart-empty">还没有交易数据</div>;
  }

  const active = hover !== null ? coords[hover] : null;
  const last = points[points.length - 1];

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    setHover(indexFromEvent(e, points.length));
  };

  return (
    <div className="tj-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={`tj-chart-svg ${onPick ? "is-clickable" : ""}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onClick={onPick ? (e) => onPick(indexFromEvent(e, points.length)) : undefined}
      >
        <defs>
          <linearGradient id="tjEQ" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--tj-accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--tj-accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        <text
          x={padL + 2}
          y={padT + 10}
          fill="var(--tj-muted)"
          fontSize="9.5"
          opacity="0.8"
        >
          高 {max.toFixed(0)}
        </text>
        <text
          x={padL + 2}
          y={H - padB - 3}
          fill="var(--tj-muted)"
          fontSize="9.5"
          opacity="0.8"
        >
          低 {min.toFixed(0)}
        </text>

        {[0, 0.25, 0.5, 0.75, 1].map((r) => {
          const y = padT + (H - padT - padB) * r;
          return (
            <line
              key={r}
              x1={padL}
              y1={y}
              x2={W - padR}
              y2={y}
              stroke="var(--tj-line)"
              strokeWidth="1"
              strokeDasharray={r === 1 ? "" : "3 4"}
            />
          );
        })}

        <path d={area} fill="url(#tjEQ)" />
        <path
          d={path}
          fill="none"
          stroke={last.equity >= 0 ? "var(--tj-red)" : "var(--tj-green)"}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {active && (
          <g>
            <line
              x1={active.x}
              y1={padT}
              x2={active.x}
              y2={H - padB}
              stroke="var(--tj-line-strong)"
              strokeWidth="1"
            />
            <circle cx={active.x} cy={active.y} r="4" fill="var(--tj-accent)" />
          </g>
        )}
      </svg>

      <div className="tj-chart-foot">
        <span>
          {active
            ? `${active.p.date} · 第 ${active.p.index} 笔 · ${money(active.p.pnl, cur)}`
            : `共 ${points.length} 笔`}
          {active && onPick && <span className="tj-chart-hint"> · 点击打开</span>}
        </span>
        <span className={toneClass(last.equity)}>
          {active
            ? `累计 ${money(active.p.equity, cur)}`
            : `最终 ${money(last.equity, cur)}`}
        </span>
      </div>

      <div className="tj-chart-axis">
        <span>{points[0].date}</span>
        <span>{points[points.length - 1].date}</span>
      </div>
    </div>
  );
}

/** 横向条形对比，用于按策略/标的/星期分组 */
export function BarList(props: {
  items: GroupStat[];
  cur: string;
  max?: number;
  /** 点某一行下钻 */
  onPick?: (key: string) => void;
}) {
  const { items, cur, onPick } = props;
  if (!items.length) return <div className="tj-chart-empty">暂无分组数据</div>;
  const maxAbs =
    props.max ?? Math.max(...items.map((i) => Math.abs(i.pnl)), 1);

  return (
    <div className="tj-barlist">
      {items.map((it) => {
        const w = (Math.abs(it.pnl) / maxAbs) * 50;
        const pos = it.pnl >= 0;
        return (
          <div
            className={`tj-bar-row ${onPick ? "is-clickable" : ""}`}
            key={it.key}
            onClick={onPick ? () => onPick(it.key) : undefined}
            title={onPick ? `按 ${it.key} 查看交易` : undefined}
          >
            <div className="tj-bar-label" title={it.key}>
              {it.key}
            </div>
            <div className="tj-bar-track">
              <div className="tj-bar-mid" />
              <div
                className={`tj-bar-fill ${pos ? "is-pos" : "is-neg"}`}
                style={{
                  width: `${w}%`,
                  left: pos ? "50%" : `${50 - w}%`,
                }}
              />
            </div>
            <div className={`tj-bar-value ${toneClass(it.pnl)}`}>
              {money(it.pnl, cur)}
            </div>
            <div className="tj-bar-meta">
              {it.count} 笔 · {fmtPct(it.winRate, 0)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 日历热力图：每格一天，红=盈利 绿=亏损 */
export function DayHeatmap(props: { days: DayPnl[]; weeks?: number }) {
  const { days, weeks = 18 } = props;

  const { cells, monthLabels } = useMemo(() => {
    if (!days.length) return { cells: [], monthLabels: [] };
    const map = new Map(days.map((d) => [d.date, d]));
    const last = days[days.length - 1].date;
    const end = new Date(last + "T00:00:00");
    const total = weeks * 7;
    const start = new Date(end);
    start.setDate(end.getDate() - (total - 1));
    // 对齐到周一
    const shift = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - shift);

    const maxAbs = Math.max(...days.map((d) => Math.abs(d.pnl)), 1);
    const out: { date: string; pnl: number | null; count: number; level: number }[] = [];
    const labels: { col: number; text: string }[] = [];
    let lastMonth = -1;

    const cursor = new Date(start);
    let col = 0;
    while (cursor <= end) {
      for (let r = 0; r < 7; r++) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(
          2,
          "0"
        )}-${String(cursor.getDate()).padStart(2, "0")}`;
        const hit = map.get(key);
        const level = hit
          ? Math.min(4, Math.max(1, Math.ceil((Math.abs(hit.pnl) / maxAbs) * 4)))
          : 0;
        out.push({
          date: key,
          pnl: hit ? hit.pnl : null,
          count: hit ? hit.count : 0,
          level,
        });
        if (r === 0 && cursor.getMonth() !== lastMonth) {
          lastMonth = cursor.getMonth();
          labels.push({ col, text: `${cursor.getMonth() + 1}月` });
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      col++;
    }
    return { cells: out, monthLabels: labels };
  }, [days, weeks]);

  if (!days.length) {
    return <div className="tj-chart-empty">还没有交易数据</div>;
  }

  return (
    <div className="tj-heatmap">
      <div className="tj-heatmap-months">
        {monthLabels.map((m) => (
          <span key={`${m.col}-${m.text}`} style={{ left: `${m.col * 15}px` }}>
            {m.text}
          </span>
        ))}
      </div>
      <div className="tj-heatmap-grid">
        {cells.map((c) => (
          <div
            key={c.date}
            className={`tj-cell lv${c.level} ${c.pnl === null ? "is-empty" : c.pnl >= 0 ? "is-pos" : "is-neg"}`}
            title={
              c.pnl === null
                ? c.date
                : `${c.date}｜${c.pnl > 0 ? "+" : ""}${c.pnl.toFixed(2)}｜${c.count} 笔`
            }
          />
        ))}
      </div>
      <div className="tj-heatmap-legend">
        <span>亏</span>
        <i className="is-neg lv4" />
        <i className="is-neg lv2" />
        <i className="is-empty" />
        <i className="is-pos lv2" />
        <i className="is-pos lv4" />
        <span>盈</span>
      </div>
    </div>
  );
}

/* ============ 回撤图（水下曲线） ============ */
export function DrawdownChart(props: {
  trades: Trade[];
  cur: string;
  /** 点选某一笔（0 基，对应按时间排序后的第 i 笔） */
  onPick?: (index: number) => void;
}) {
  const { trades, cur, onPick } = props;
  const series = useMemo(() => drawdownSeries(trades), [trades]);
  const [hover, setHover] = useState<number | null>(null);

  const W = 800;
  const H = 180;
  const padL = 10;
  const padR = 10;
  const padT = 14;
  const padB = 18;

  const { path, area, coords, maxDd, min } = useMemo(() => {
    if (!series.length) return { path: "", area: "", coords: [], maxDd: 0, min: 0 };
    let lo = Math.min(...series.map((p) => p.dd), 0);
    if (lo === 0) lo = -1;
    const hi = 0; // 回撤永远 ≤ 0
    const n = series.length;
    const x = (i: number) => padL + (n <= 1 ? (W - padL - padR) / 2 : ((W - padL - padR) * i) / (n - 1));
    const y = (v: number) => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo || 1));
    const cs = series.map((p, i) => ({ x: x(i), y: y(p.dd), p }));
    const line = cs.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(" ");
    const zeroY = y(0);
    const areaPath =
      cs.length > 0
        ? `${line} L${cs[cs.length - 1].x.toFixed(2)},${zeroY.toFixed(2)} L${cs[0].x.toFixed(2)},${zeroY.toFixed(2)} Z`
        : "";
    return { path: line, area: areaPath, coords: cs, maxDd: lo, min: lo };
  }, [series]);

  if (!series.length) return <div className="tj-chart-empty">还没有交易数据</div>;

  const active = hover !== null ? coords[hover] : null;
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    setHover(indexFromEvent(e, series.length));
  };

  return (
    <div className="tj-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={`tj-chart-svg ${onPick ? "is-clickable" : ""}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onClick={onPick ? (e) => onPick(indexFromEvent(e, series.length)) : undefined}
      >
        <defs>
          <linearGradient id="tjDD" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--tj-green)" stopOpacity="0.02" />
            <stop offset="100%" stopColor="var(--tj-green)" stopOpacity="0.22" />
          </linearGradient>
        </defs>

        <line
          x1={padL}
          y1={padT}
          x2={W - padR}
          y2={padT}
          stroke="var(--tj-line-strong)"
          strokeWidth="1"
        />
        <text x={padL + 2} y={padT - 3} fill="var(--tj-muted)" fontSize="9.5" opacity="0.8">
          0
        </text>
        <text x={padL + 2} y={H - padB - 2} fill="var(--tj-muted)" fontSize="9.5" opacity="0.8">
          {fmtAxis(min)}
        </text>

        <path d={area} fill="url(#tjDD)" />
        <path d={path} fill="none" stroke="var(--tj-green)" strokeWidth="1.6" strokeLinejoin="round" />

        {active && (
          <g>
            <line
              x1={active.x}
              y1={padT}
              x2={active.x}
              y2={H - padB}
              stroke="var(--tj-line-strong)"
              strokeWidth="1"
            />
            <circle cx={active.x} cy={active.y} r="3.5" fill="var(--tj-green)" />
          </g>
        )}
      </svg>

      <div className="tj-chart-foot">
        <span>
          {active ? `${active.p.date} · 第 ${active.p.index} 笔` : `最深 ${money(maxDd, cur)}`}
          {active && onPick && <span className="tj-chart-hint"> · 点击打开</span>}
        </span>
        <span className={active ? toneClass(active.p.dd) : "tj-neg"}>
          {active ? `回撤 ${money(active.p.dd, cur)}` : `当前水下 ${money(series[series.length - 1].dd, cur)}`}
        </span>
      </div>
    </div>
  );
}

/* ============ 月历：每日盈亏 + 笔数 + 周次 ============ */
const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

/** 轴标签：大数用 k 缩写，避免在窄图里被裁掉 */
function fmtAxis(v: number): string {
  if (Math.abs(v) >= 10000) return `${(v / 1000).toFixed(0)}k`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toFixed(0);
}

function isoWeek(d: Date): number {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (t.getDay() + 6) % 7; // 周一=0
  t.setDate(t.getDate() - day + 3); // 该周周四
  const firstThursday = new Date(t.getFullYear(), 0, 4);
  const fDay = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - fDay + 3);
  return 1 + Math.round((t.getTime() - firstThursday.getTime()) / (7 * 86400000));
}

export function MonthCalendar(props: {
  days: DayPnl[];
  cur: string;
  /** 默认显示的月份，YYYY-MM；不传则用最后一天交易所在月 */
  anchorMonth?: string;
  onPick?: (date: string) => void;
}) {
  const { days, cur, onPick } = props;
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);

  const initial = props.anchorMonth ?? (days.length ? days[days.length - 1].date.slice(0, 7) : "2026-01");
  const [month, setMonth] = useState(initial);

  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // 周一开头
  const rows = Math.ceil((lead + daysInMonth) / 7);

  const maxAbs = Math.max(1, ...days.map((d) => Math.abs(d.pnl)));

  const shift = (n: number) => {
    const d = new Date(y, m - 1 + n, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const monthPnl = days
    .filter((d) => d.date.startsWith(month))
    .reduce((a, b) => a + b.pnl, 0);
  const monthCount = days.filter((d) => d.date.startsWith(month)).reduce((a, b) => a + b.count, 0);
  const quarter = Math.floor((m - 1) / 3) + 1;

  /** 有交易的月份汇总，按时间正序；少于两个月就不用显示跳转条 */
  const monthStats = useMemo(() => {
    const acc = new Map<string, { pnl: number; count: number }>();
    for (const d of days) {
      const key = d.date.slice(0, 7);
      const v = acc.get(key) ?? { pnl: 0, count: 0 };
      v.pnl += d.pnl;
      v.count += d.count;
      acc.set(key, v);
    }
    return [...acc.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, v]) => ({ month: key, ...v }));
  }, [days]);

  return (
    <div className="tj-cal">
      <div className="tj-cal-head">
        <div className="tj-cal-title">
          {y} 年 {m} 月
          <span className="tj-cal-quarter">Q{quarter}</span>
          <span className="tj-cal-week">W{isoWeek(first)}</span>
        </div>
        <div className="tj-cal-nav">
          <button type="button" onClick={() => shift(-1)} title="上个月">
            ‹
          </button>
          <button type="button" onClick={() => shift(1)} title="下个月">
            ›
          </button>
        </div>
      </div>

      <div className="tj-cal-grid">
        <div className="tj-cal-corner" />
        {WEEK_LABELS.map((w) => (
          <div className="tj-cal-weekday" key={w}>
            {w}
          </div>
        ))}

        {Array.from({ length: rows }).map((_, r) => {
          const rowDate = new Date(y, m - 1, 1 - lead + r * 7);
          return (
            <React.Fragment key={r}>
              <div className="tj-cal-wn">W{isoWeek(rowDate)}</div>
              {Array.from({ length: 7 }).map((__, c) => {
                const dayNum = 1 - lead + r * 7 + c;
                const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
                const date = `${y}-${String(m).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
                const hit = inMonth ? byDate.get(date) : undefined;
                const ratio = hit ? Math.min(1, Math.abs(hit.pnl) / maxAbs) : 0;
                const alpha = hit ? 0.14 + ratio * 0.6 : 0;
                return (
                  <div
                    key={c}
                    className={`tj-cal-cell ${inMonth ? "" : "is-out"} ${
                      hit ? (hit.pnl >= 0 ? "is-pos" : "is-neg") : "is-empty"
                    } ${hit && onPick ? "is-pickable" : ""}`}
                    style={
                      hit
                        ? {
                            background: `color-mix(in srgb, var(${
                              hit.pnl >= 0 ? "--tj-red" : "--tj-green"
                            }) ${Math.round(alpha * 100)}%, transparent)`,
                          }
                        : undefined
                    }
                    onClick={hit && onPick ? () => onPick(date) : undefined}
                    title={
                      hit ? `${date}｜${money(hit.pnl, cur)}｜${hit.count} 笔` : inMonth ? date : ""
                    }
                  >
                    {inMonth && (
                      <>
                        <span className="tj-cal-day">{dayNum}</span>
                        {hit && (
                          <span className="tj-cal-pnl">
                            {hit.pnl > 0 ? "+" : ""}
                            {Math.abs(hit.pnl) >= 1000
                              ? `${(hit.pnl / 1000).toFixed(1)}k`
                              : hit.pnl.toFixed(0)}
                            <em>{hit.count} 笔</em>
                          </span>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </React.Fragment>
          );
        })}
      </div>

      <div className="tj-cal-foot">
        <span>本月 {monthCount} 笔</span>
        <span className={toneClass(monthPnl)}>{money(monthPnl, cur)}</span>
      </div>

      {/* 有交易的月份做成一排小标签：不用点 ‹ › 一个个翻，也不会漏掉上个月的数据 */}
      {monthStats.length > 1 && (
        <div className="tj-cal-months">
          {monthStats.map((s) => (
            <button
              key={s.month}
              type="button"
              className={`tj-cal-month ${s.month === month ? "is-on" : ""}`}
              onClick={() => setMonth(s.month)}
              title={`${s.month}｜${s.count} 笔｜${money(s.pnl, cur)}`}
            >
              <span className="tj-cal-month-name">
                {s.month.slice(0, 4) === String(y) ? "" : `${s.month.slice(2, 4)}/`}
                {Number(s.month.slice(5))}月
              </span>
              <span className={`tj-cal-month-pnl ${toneClass(s.pnl)}`}>
                {s.pnl > 0 ? "+" : ""}
                {fmtAxis(s.pnl)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============ 分组条形：可切换度量 ============ */
export type BarMetric = "pnl" | "winRate" | "count";

const BAR_METRIC_LABELS: Record<BarMetric, string> = {
  pnl: "盈亏",
  winRate: "胜率",
  count: "笔数",
};

export function MetricBarList(props: {
  items: GroupStat[];
  cur: string;
  metrics?: BarMetric[];
  limit?: number;
  /** 点某一行下钻 */
  onPick?: (key: string) => void;
}) {
  const { items, cur, onPick } = props;
  const metrics = props.metrics ?? ["pnl", "winRate", "count"];
  const [metric, setMetric] = useState<BarMetric>(metrics[0]);
  const limit = props.limit ?? 8;

  const sorted = useMemo(() => {
    const list = [...items];
    if (metric === "pnl") list.sort((a, b) => b.pnl - a.pnl);
    if (metric === "winRate") list.sort((a, b) => b.winRate - a.winRate);
    if (metric === "count") list.sort((a, b) => b.count - a.count);
    return list.slice(0, limit);
  }, [items, metric, limit]);

  if (!items.length) return <div className="tj-chart-empty">暂无分组数据</div>;

  const raw = (s: GroupStat) => (metric === "pnl" ? s.pnl : metric === "winRate" ? s.winRate : s.count);
  const maxAbs = Math.max(...sorted.map((s) => Math.abs(raw(s))), metric === "winRate" ? 0.01 : 1);

  const label = (s: GroupStat) => {
    if (metric === "pnl") return money(s.pnl, cur);
    if (metric === "winRate") return fmtPct(s.winRate, 0);
    return `${s.count} 笔`;
  };

  return (
    <div className="tj-metric-bars">
      {metrics.length > 1 && (
        <div className="tj-bar-switch">
          {metrics.map((k) => (
            <button
              key={k}
              type="button"
              className={metric === k ? "is-active" : ""}
              onClick={() => setMetric(k)}
            >
              {BAR_METRIC_LABELS[k]}
            </button>
          ))}
        </div>
      )}

      {sorted.map((s) => {
        const v = raw(s);
        const w = Math.max(2, (Math.abs(v) / maxAbs) * 100);
        return (
          <div
            className={`tj-metric-row ${onPick ? "is-clickable" : ""}`}
            key={s.key}
            onClick={onPick && s.key && s.key !== "未分类" ? () => onPick(s.key) : undefined}
            title={onPick ? `按 ${s.key || "未分类"} 查看交易` : undefined}
          >
            <div className="tj-metric-name" title={s.key}>
              {s.key || "未分类"}
            </div>
            <div className="tj-metric-track">
              <div
                className={`tj-metric-fill ${metric === "pnl" ? (s.pnl >= 0 ? "is-pos" : "is-neg") : "is-neutral"}`}
                style={{ width: `${metric === "winRate" ? w : w * 0.86}%` }}
              />
            </div>
            <div className={`tj-metric-value ${metric === "pnl" ? toneClass(s.pnl) : ""}`}>
              {label(s)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ============ 最近交易 ============ */
export function RecentTrades(props: {
  trades: Trade[];
  cur: string;
  limit?: number;
  onOpen?: (t: Trade) => void;
}) {
  const { trades, cur, onOpen, limit = 8 } = props;
  const rows = useMemo(
    () =>
      [...trades]
        .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
        .slice(0, limit),
    [trades, limit]
  );

  if (!rows.length) return <div className="tj-chart-empty">还没有交易数据</div>;

  return (
    <table className="tj-recent">
      <thead>
        <tr>
          <th>日期</th>
          <th>标的</th>
          <th>方向</th>
          <th className="tj-num">盈亏</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr
            key={t.id}
            onClick={onOpen ? () => onOpen(t) : undefined}
            className={onOpen ? "is-clickable" : ""}
          >
            <td className="tj-recent-date">
              {t.date.slice(5)}
              <span>{t.time}</span>
            </td>
            <td className="tj-recent-sym">{t.symbol.replace(/^F\.US\./, "")}</td>
            <td>
              <span className={`tj-dir ${t.direction === "long" ? "is-long" : "is-short"}`}>
                {t.direction === "long" ? "做多" : "做空"}
              </span>
            </td>
            <td className={`tj-num ${toneClass(t.pnl)}`}>{money(t.pnl, cur)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
