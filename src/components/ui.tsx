import React, { createContext, useContext } from "react";

export const CurrencyContext = createContext<string>("¥");

export function useCurrency(): string {
  return useContext(CurrencyContext);
}

const nf2 = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const nf0 = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });

export function fmtNum(v: number, decimals = 2): string {
  if (!Number.isFinite(v)) return "—";
  return decimals === 0 ? nf0.format(v) : nf2.format(v);
}

/** 带货币符号与正负号，纯函数，可在任意位置调用 */
export function money(v: number, cur = "¥"): string {
  if (!Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}${cur}${nf2.format(Math.abs(v))}`;
}

export function fmtSigned(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}${nf2.format(Math.abs(v))}`;
}

export function fmtPct(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function toneClass(v: number): string {
  return v > 0 ? "tj-pos" : v < 0 ? "tj-neg" : "tj-flat";
}

export function Money({ value, className = "" }: { value: number; className?: string }) {
  const cur = useCurrency();
  return (
    <span className={`tj-money ${toneClass(value)} ${className}`.trim()}>
      {money(value, cur)}
    </span>
  );
}

export function StatCard(props: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: number;
  /** 与上期的对比，显示在数值下方 */
  delta?: { text: string; tone: "up" | "down" | "flat"; label?: string };
}) {
  const d = props.delta;
  return (
    <div className="tj-stat">
      <div className="tj-stat-label">{props.label}</div>
      <div
        className={`tj-stat-value ${
          props.tone === undefined ? "" : toneClass(props.tone)
        }`.trim()}
      >
        {props.value}
      </div>
      {d && d.tone !== "flat" && (
        <div className={`tj-stat-delta ${d.tone === "up" ? "tj-pos" : "tj-neg"}`}>
          {d.tone === "up" ? "▲" : "▼"} {d.text}
          <span className="tj-stat-delta-label">{d.label ?? "较上期"}</span>
        </div>
      )}
      {props.hint !== undefined && <div className="tj-stat-hint">{props.hint}</div>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="tj-empty">{children}</div>;
}

export function Section(props: {
  title: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
  /** 传入后表头变成可拖拽的把手（仪表盘网格用） */
  dragHandleProps?: {
    onPointerDown?: (e: React.PointerEvent) => void;
    title?: string;
    className?: string;
  };
}) {
  const d = props.dragHandleProps;
  // 表头里的分段控件/按钮属于「可点」，不能被拖拽把手抢走事件
  const onHeadPointerDown = (e: React.PointerEvent) => {
    const el = e.target as HTMLElement | null;
    if (el?.closest?.("button, a, input, select, textarea, .tj-segmented")) return;
    d?.onPointerDown?.(e);
  };
  return (
    <section className="tj-section">
      <header
        className={`tj-section-head ${d?.className ?? ""}`.trim()}
        onPointerDown={d?.onPointerDown ? onHeadPointerDown : undefined}
        title={d?.title || undefined}
      >
        <h3>
          {d?.className && (
            <span className="tj-grip" aria-hidden="true">
              ⠿
            </span>
          )}
          {props.title}
        </h3>
        {props.extra}
      </header>
      {props.children}
    </section>
  );
}

export function Segmented<T extends string>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="tj-segmented">
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={props.value === o.value ? "is-active" : ""}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select(props: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label?: string;
}) {
  return (
    <label className="tj-select">
      {props.label && <span>{props.label}</span>}
      <select value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
