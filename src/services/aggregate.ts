import { Trade } from "../types";
import { DayPnl } from "./analytics";
import {
  DashboardQuery,
  DateRange,
  filterTrades,
  prevRange,
  rangeLabel,
  resolveRange,
} from "./query";
import {
  MetricBase,
  REGISTRY,
  compareMetric,
  makeBase,
} from "./metrics";

/**
 * 聚合入口：一次查询 → 一份快照。
 *
 * 页面只认这个对象，不再自己算数。好处是"当期 / 上期"永远同口径：
 * 同一个指标函数、同一套过滤条件，只是区间平移了一次。
 */

export interface MetricResult {
  id: string;
  value: number | null;
  prev: number | null;
  /** 与上期的差值 */
  delta: number | null;
  /** 格式化后的环比文字，例如 +1,234.56 */
  deltaText: string;
  tone: "up" | "down" | "flat";
}

export interface DashboardSnapshot {
  query: DashboardQuery;
  range: DateRange | null;
  prevRange: DateRange | null;
  label: string;
  trades: Trade[];
  prevTrades: Trade[];
  days: DayPnl[];
  base: MetricBase;
  prevBase: MetricBase;
  metrics: Record<string, MetricResult>;
}

function buildMetricResults(cur: MetricBase, prev: MetricBase | null): Record<string, MetricResult> {
  const out: Record<string, MetricResult> = {};
  const shown = (def: (typeof REGISTRY)[number], raw: number | null): number | null => {
    if (raw === null || !def.display) return raw;
    return def.display(raw);
  };

  for (const def of REGISTRY) {
    // 先过 display 再比，否则"回撤变大"会被算成变好
    const value = shown(def, def.compute(cur));
    const prevValue = shown(def, prev ? def.compute(prev) : null);
    const cmp = compareMetric(value, prevValue, def.format);
    out[def.id] = {
      id: def.id,
      value,
      prev: prevValue,
      delta: cmp.delta,
      deltaText: cmp.text,
      tone: cmp.tone,
    };
  }
  return out;
}

/**
 * @param all 全量交易（未过滤）
 * @param query 时间档 + 筛选
 * @param today 便于测试注入固定日期
 */
export function buildSnapshot(
  all: Trade[],
  query: DashboardQuery,
  today?: string
): DashboardSnapshot {
  const range = resolveRange(query, today);
  const prev = prevRange(query, range);

  const trades = filterTrades(all, query, range);
  const prevTrades = prev ? filterTrades(all, query, prev) : [];

  const base = makeBase(trades);
  const prevBase = prev ? makeBase(prevTrades) : null;

  return {
    query,
    range,
    prevRange: prev,
    label: rangeLabel(query, range),
    trades,
    prevTrades,
    days: base.days,
    base,
    prevBase: prevBase ?? makeBase([]),
    metrics: buildMetricResults(base, prevBase),
  };
}
