import React, { useMemo } from "react";
import { DashboardSnapshot } from "../services/aggregate";
import { REGISTRY, formatMetric, pickMetrics } from "../services/metrics";
import { buildInsights, headline, highlights } from "../services/insights";
import { Section, StatCard, money } from "./ui";

/**
 * 概要视图：一屏回答三个问题
 * 1. 这段时间赚没赚、赚得稳不稳
 * 2. 靠什么赚的、被什么拖累
 * 3. 现在处在什么位置（是不是还在水下）
 *
 * 数字全部来自同一份 snapshot，和仪表盘不会出现两套口径。
 */

const CARDS = [
  "netPnL",
  "winRate",
  "profitFactor",
  "maxDrawdown",
  "avgRecovery",
  "timeUnderwater",
];

export function Overview(props: {
  snapshot: DashboardSnapshot;
  cur: string;
}) {
  const { snapshot, cur } = props;
  const b = snapshot.base;
  const cards = pickMetrics(REGISTRY, CARDS);

  const ins = useMemo(() => buildInsights(snapshot, cur), [snapshot, cur]);
  const hl = useMemo(() => highlights(snapshot.trades), [snapshot.trades]);
  const line = headline(snapshot, cur);

  const peak = b.s.netPnl + b.ddStats.current;
  const progress = peak > 0 ? Math.max(0, Math.min(1, (peak - b.ddStats.current) / peak)) : 0;

  return (
    <div className="tj-overview">
      <div className="tj-hero">
        <div className="tj-hero-kicker">{snapshot.label}</div>
        <div className="tj-hero-line">{line}</div>
        <div className="tj-hero-bar">
          <div className="tj-hero-bar-fill" style={{ width: `${progress * 100}%` }} />
          <span className="tj-hero-bar-note">
            {b.ddStats.current > 0
              ? `距本期高点还差 ${money(b.ddStats.current, cur)}`
              : "正在本期最高点"}
          </span>
        </div>
      </div>

      <div className="tj-stats">
        {cards.map((def) => {
          const m = snapshot.metrics[def.id];
          const value = m ? m.value : null;
          return (
            <StatCard
              key={def.id}
              label={def.name}
              value={formatMetric(value, def.format, cur)}
              tone={def.format === "money" ? value ?? 0 : undefined}
              hint={def.hint ? def.hint(b) : def.desc}
            />
          );
        })}
      </div>

      <Section title="结论" extra={<span className="tj-muted">{ins.length} 条</span>}>
        {ins.length === 0 ? (
          <div className="tj-chart-empty">数据太少，暂时得不出结论</div>
        ) : (
          <ul className="tj-insights">
            {ins.map((i) => (
              <li key={i.id} className={`tj-insight is-${i.tone}`}>
                <span className="tj-insight-dot" aria-hidden="true" />
                <span className="tj-insight-body">
                  <span className="tj-insight-text">{i.text}</span>
                  {i.detail && <span className="tj-insight-detail">{i.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="tj-grid2">
        <Section title="强项" extra={<span className="tj-muted">至少 2 笔</span>}>
          {hl.strong.length === 0 ? (
            <div className="tj-chart-empty">没有稳定赚钱的维度</div>
          ) : (
            <div className="tj-hl-list">
              {hl.strong.slice(0, 4).map((h) => (
                <div className="tj-hl-item" key={`s-${h.dimension}-${h.key}`}>
                  <span className="tj-hl-dim">{h.dimension}</span>
                  <span className="tj-hl-key">{h.key}</span>
                  <span className="tj-hl-pnl tj-pos">{money(h.pnl, cur)}</span>
                  <span className="tj-hl-meta">
                    {h.count} 笔 · 胜率 {(h.winRate * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="短板" extra={<span className="tj-muted">至少 2 笔</span>}>
          {hl.weak.length === 0 ? (
            <div className="tj-chart-empty">没有明显亏钱的维度</div>
          ) : (
            <div className="tj-hl-list">
              {hl.weak.slice(0, 4).map((h) => (
                <div className="tj-hl-item" key={`w-${h.dimension}-${h.key}`}>
                  <span className="tj-hl-dim">{h.dimension}</span>
                  <span className="tj-hl-key">{h.key}</span>
                  <span className="tj-hl-pnl tj-neg">{money(h.pnl, cur)}</span>
                  <span className="tj-hl-meta">
                    {h.count} 笔 · 胜率 {(h.winRate * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
