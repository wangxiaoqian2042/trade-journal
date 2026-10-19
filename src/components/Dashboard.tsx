import React, { useMemo, useState } from "react";
import { byWeekday, equityCurve, groupBy, sortTrades, summarize } from "../services/analytics";
import { DashboardSnapshot } from "../services/aggregate";
import { DEFAULT_CARDS, REGISTRY, formatMetric, pickMetrics } from "../services/metrics";
import { DEFAULT_LAYOUT, WidgetLayout, normalizeLayout } from "../services/layout";
import { Drill, weekdayIndex } from "../services/query";
import { DashboardGrid } from "./DashboardGrid";
import {
  BarList,
  DrawdownChart,
  EquityCurve,
  MetricBarList,
  MonthCalendar,
  RecentTrades,
} from "./charts";
import { Money, Section, StatCard, fmtPct, money, toneClass } from "./ui";
import { DayPnl } from "../services/analytics";
import { Trade } from "../types";

const CATEGORY_LABELS = {
  performance: "表现",
  volume: "数量",
  average: "均值",
} as const;

/** 环比文案跟着时间档走 */
function prevLabel(preset: string): string {
  switch (preset) {
    case "today":
      return "较昨日";
    case "yesterday":
      return "较前日";
    case "week":
      return "较上周";
    case "month":
      return "较上月";
    case "quarter":
      return "较上季";
    case "year":
      return "较去年";
    default:
      return "较上期";
  }
}

export function Dashboard(props: {
  snapshot: DashboardSnapshot;
  cur: string;
  allDays: DayPnl[];
  onOpen?: (t: Trade) => void;
  /** 图表点选下钻（点日历某天、点标的/策略/星期条、点多空卡片） */
  onDrill?: (d: Drill) => void;
  /** 显示哪些指标卡；不传用默认 6 张 */
  cardIds?: string[];
  onCardsChange?: (ids: string[]) => void;
  /** 组件布局；不传用默认排布 */
  layout?: WidgetLayout[];
  onLayoutChange?: (next: WidgetLayout[]) => void;
}) {
  const { snapshot, cur, allDays, onOpen, onDrill } = props;
  const trades = snapshot.trades;
  /** 图表里的第 i 个点 → 第 i 笔（和 sortTrades 同序，否则点到的不是同一笔） */
  const sorted = useMemo(() => sortTrades(trades), [trades]);
  const openAt = (i: number) => {
    const t = sorted[i];
    if (t && onOpen) onOpen(t);
  };

  const [panelOpen, setPanelOpen] = useState(false);
  const cardIds = props.cardIds && props.cardIds.length ? props.cardIds : DEFAULT_CARDS;
  const editable = Boolean(props.onCardsChange);

  const layout = useMemo(() => normalizeLayout(props.layout), [props.layout]);
  const setCards = (ids: string[]) => props.onCardsChange?.(ids);
  const toggleCard = (id: string) =>
    setCards(cardIds.includes(id) ? cardIds.filter((x) => x !== id) : [...cardIds, id]);
  const moveCard = (id: string, dir: -1 | 1) => {
    const i = cardIds.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cardIds.length) return;
    const next = [...cardIds];
    [next[i], next[j]] = [next[j], next[i]];
    setCards(next);
  };

  const curve = equityCurve(trades);
  const bySetup = groupBy(trades, (t) => t.setup).slice(0, 8);
  const bySymbol = groupBy(trades, (t) => t.symbol).slice(0, 8);
  const weekday = byWeekday(trades).filter((w) => w.key !== "未知");
  const cards = pickMetrics(REGISTRY, cardIds);
  const deltaLabel = prevLabel(snapshot.query.preset);
  const canCompare = snapshot.prevRange !== null;

  const renderWidget = (id: string, drag: Parameters<typeof Section>[0]["dragHandleProps"]) => {
    switch (id) {
      case "pnlChart":
        return (
          <Section
            title="累计盈亏"
            extra={<span className="tj-muted">{snapshot.label}</span>}
            dragHandleProps={drag}
          >
            <EquityCurve points={curve} cur={cur} onPick={onOpen ? openAt : undefined} />
          </Section>
        );
      case "calendar":
        return (
          <Section title="每日盈亏" dragHandleProps={drag}>
            <MonthCalendar
              days={allDays}
              cur={cur}
              onPick={onDrill ? (date) => onDrill({ kind: "date", date }) : undefined}
            />
          </Section>
        );
      case "strategy":
        return (
          <Section title="策略表现" dragHandleProps={drag}>
            <MetricBarList
              items={bySetup}
              cur={cur}
              onPick={onDrill ? (value) => onDrill({ kind: "setup", value }) : undefined}
            />
          </Section>
        );
      case "drawdown":
        return (
          <Section
            title="回撤"
            extra={
              <span className="tj-muted">
                最大 {money(snapshot.metrics.maxDrawdown.value ?? 0, cur)}
              </span>
            }
            dragHandleProps={drag}
          >
            <DrawdownChart trades={trades} cur={cur} onPick={onOpen ? openAt : undefined} />
          </Section>
        );
      case "weekday":
        return (
          <Section title="星期表现" dragHandleProps={drag}>
            <BarList
              items={weekday}
              cur={cur}
              onPick={
                onDrill
                  ? (key) => {
                      const idx = weekdayIndex(key);
                      if (idx >= 0) onDrill({ kind: "weekday", value: idx });
                    }
                  : undefined
              }
            />
          </Section>
        );
      case "symbolPerf":
        return (
          <Section title="标的表现" dragHandleProps={drag}>
            <MetricBarList
              items={bySymbol}
              cur={cur}
              onPick={onDrill ? (value) => onDrill({ kind: "symbol", value }) : undefined}
            />
          </Section>
        );
      case "recentTrades":
        return (
          <Section title="最近交易" dragHandleProps={drag}>
            <RecentTrades trades={trades} cur={cur} limit={8} onOpen={onOpen} />
          </Section>
        );
      case "longShort":
        return (
          <Section title="长短对比" dragHandleProps={drag}>
            <div className="tj-split">
              {(["long", "short"] as const).map((dir) => {
                const list = trades.filter((t) => t.direction === dir);
                const st = summarize(list);
                return (
                  <div
                    className={`tj-split-card ${onDrill ? "is-clickable" : ""}`}
                    key={dir}
                    onClick={onDrill ? () => onDrill({ kind: "direction", value: dir }) : undefined}
                    title={onDrill ? `只看${dir === "long" ? "做多" : "做空"}的交易` : undefined}
                  >
                    <div className="tj-split-title">{dir === "long" ? "做多" : "做空"}</div>
                    <div className={`tj-split-pnl ${toneClass(st.netPnl)}`}>
                      <Money value={st.netPnl} />
                    </div>
                    <div className="tj-split-meta">
                      {st.count} 笔 · 胜率 {fmtPct(st.winRate, 0)} · 盈亏比{" "}
                      {Number.isFinite(st.profitFactor) ? st.profitFactor.toFixed(2) : "∞"}
                    </div>
                    <div className="tj-split-bar">
                      <div
                        className="tj-split-fill"
                        style={{ width: `${Math.min(100, st.winRate * 100)}%` }}
                      />
                    </div>
                    <div className="tj-muted tj-small">
                      平均每笔 {money(st.expectancy, cur)}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        );
      default:
        return null;
    }
  };

  return (
    <div className="tj-dashboard">
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
              delta={
                canCompare && m && m.delta !== null
                  ? { text: m.deltaText, tone: m.tone, label: deltaLabel }
                  : undefined
              }
              hint={def.hint ? def.hint(snapshot.base) : def.desc}
            />
          );
        })}
      </div>

      {editable && (
        <div className="tj-metric-config">
          <button
            type="button"
            className="tj-metric-config-btn"
            onClick={() => setPanelOpen((v) => !v)}
          >
            指标卡 {cardIds.length} 项 {panelOpen ? "▴" : "▾"}
          </button>
          {props.onLayoutChange && (
            <button
              type="button"
              className="tj-metric-config-btn"
              onClick={() => props.onLayoutChange?.(DEFAULT_LAYOUT)}
              title="把组件顺序和大小恢复成默认"
            >
              重置布局
            </button>
          )}
          {panelOpen && (
            <div className="tj-metric-panel">
              <div className="tj-metric-panel-head">
                <span>勾选要显示的指标，↑↓ 调整顺序</span>
                <button type="button" className="tj-link" onClick={() => setCards(DEFAULT_CARDS)}>
                  恢复默认
                </button>
              </div>
              {(["performance", "volume", "average"] as const).map((cat) => (
                <div key={cat} className="tj-metric-group">
                  <div className="tj-metric-group-title">{CATEGORY_LABELS[cat]}</div>
                  {REGISTRY.filter((d) => d.category === cat).map((def) => {
                    const on = cardIds.includes(def.id);
                    return (
                      <div key={def.id} className={`tj-metric-opt ${on ? "is-on" : ""}`}>
                        <label>
                          <input type="checkbox" checked={on} onChange={() => toggleCard(def.id)} />
                          <span>{def.name}</span>
                        </label>
                        {on && (
                          <span className="tj-metric-order">
                            <button type="button" onClick={() => moveCard(def.id, -1)} title="上移">
                              ↑
                            </button>
                            <button type="button" onClick={() => moveCard(def.id, 1)} title="下移">
                              ↓
                            </button>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <DashboardGrid
        layout={layout}
        editable={editable && Boolean(props.onLayoutChange)}
        onChange={props.onLayoutChange}
      >
        {(id, drag) => renderWidget(id, drag)}
      </DashboardGrid>
    </div>
  );
}
