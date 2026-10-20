import { Trade } from "../types";

export interface Summary {
  count: number;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  fees: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  bestTrade: number;
  worstTrade: number;
  maxDrawdown: number;
  maxWinStreak: number;
  maxLossStreak: number;
  avgHold?: never;
}

export function sortTrades(trades: Trade[]): Trade[] {
  return [...trades].sort((a, b) =>
    (a.date + " " + (a.time || "00:00")).localeCompare(
      b.date + " " + (b.time || "00:00")
    )
  );
}

export function summarize(trades: Trade[]): Summary {
  const sorted = sortTrades(trades);
  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let best = 0;
  let worst = 0;
  let net = 0;
  let fees = 0;
  let peak = 0;
  let equity = 0;
  let maxDd = 0;
  let winStreak = 0;
  let lossStreak = 0;
  let maxWinStreak = 0;
  let maxLossStreak = 0;

  for (const t of sorted) {
    net += t.pnl;
    fees += t.fees;
    if (t.pnl > 0) {
      grossProfit += t.pnl;
      wins++;
      winStreak++;
      lossStreak = 0;
      maxWinStreak = Math.max(maxWinStreak, winStreak);
    } else if (t.pnl < 0) {
      grossLoss += Math.abs(t.pnl);
      losses++;
      lossStreak++;
      winStreak = 0;
      maxLossStreak = Math.max(maxLossStreak, lossStreak);
    } else {
      breakeven++;
    }
    best = Math.max(best, t.pnl);
    worst = Math.min(worst, t.pnl);
    equity += t.pnl;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }

  const decided = wins + losses;

  return {
    count: sorted.length,
    netPnl: net,
    grossProfit,
    grossLoss,
    fees,
    wins,
    losses,
    breakeven,
    winRate: decided ? wins / decided : 0,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    expectancy: sorted.length ? net / sorted.length : 0,
    avgWin: wins ? grossProfit / wins : 0,
    avgLoss: losses ? grossLoss / losses : 0,
    bestTrade: best,
    worstTrade: worst,
    maxDrawdown: maxDd,
    maxWinStreak,
    maxLossStreak,
  };
}

export interface CurvePoint {
  index: number;
  equity: number;
  pnl: number;
  date: string;
}

export function equityCurve(trades: Trade[]): CurvePoint[] {
  const sorted = sortTrades(trades);
  let equity = 0;
  return sorted.map((t, i) => {
    equity += t.pnl;
    return { index: i + 1, equity, pnl: t.pnl, date: t.date };
  });
}

export interface DrawdownPoint {
  index: number;
  date: string;
  /** 当前回撤（≤0） */
  dd: number;
  equity: number;
  peak: number;
}

/** 水下曲线：每个点相对历史最高权益的回落，用于回撤图 */
export function drawdownSeries(trades: Trade[]): DrawdownPoint[] {
  const sorted = sortTrades(trades);
  let equity = 0;
  let peak = 0;
  return sorted.map((t, i) => {
    equity += t.pnl;
    if (equity > peak) peak = equity;
    return { index: i + 1, date: t.date, dd: equity - peak, equity, peak };
  });
}

export interface DrawdownInfo {
  max: number;
  /** 回撤最深的那一笔 */
  at: DrawdownPoint | null;
  /** 从高点回到高点用了多少笔；尚未恢复为 null */
  recoveryTrades: number | null;
}

export function drawdownInfo(trades: Trade[]): DrawdownInfo {
  const series = drawdownSeries(trades);
  let max = 0;
  let at: DrawdownPoint | null = null;
  for (const p of series) {
    if (p.dd < max) {
      max = p.dd;
      at = p;
    }
  }
  let recoveryTrades: number | null = null;
  if (at) {
    const peakAt = series[at.index - 1]?.peak ?? 0;
    for (let i = at.index; i < series.length; i++) {
      if (series[i].equity >= peakAt) {
        recoveryTrades = i - at.index + 1;
        break;
      }
    }
  }
  return { max, at, recoveryTrades };
}

export interface DrawdownEpisode {
  /** 高点日期（这一段的起点） */
  peakDate: string;
  peakEquity: number;
  /** 最深点的日期与权益 */
  troughDate: string;
  troughEquity: number;
  /** 回撤幅度（正数） */
  depth: number;
  /** 高点 → 谷底经过的交易日数 */
  downDays: number;
  /** 谷底 → 收复前高经过的交易日数；未收复为 null */
  recoveryDays: number | null;
  /** 收复日期；未收复为 null */
  recoveryDate: string | null;
  /** 整段回撤持续多少个交易日（未收复则算到数据末尾） */
  durationDays: number;
  recovered: boolean;
}

/**
 * 把权益曲线切成一段段回撤。
 *
 * 判定用"收盘权益"：某一笔平仓后权益跌破此前的最高点就算开始，
 * 回到或超过那个最高点就算结束。交易日数按"有交易的自然日"数，
 * 不是日历天数——不交易的周末不该算进恢复期。
 */
export function drawdownEpisodes(trades: Trade[]): DrawdownEpisode[] {
  const sorted = sortTrades(trades);
  if (!sorted.length) return [];

  const dayIndex = new Map<string, number>();
  for (const t of sorted) if (!dayIndex.has(t.date)) dayIndex.set(t.date, dayIndex.size);
  const lastIdx = dayIndex.size - 1;

  const out: DrawdownEpisode[] = [];
  let equity = 0;
  let peak = 0;
  let peakDate = sorted[0].date;
  let open: {
    peakDate: string;
    peakEquity: number;
    troughDate: string;
    troughEquity: number;
  } | null = null;

  const close = (recoveryDate: string | null) => {
    if (!open) return;
    const fromIdx = dayIndex.get(open.peakDate) ?? 0;
    const troughIdx = dayIndex.get(open.troughDate) ?? fromIdx;
    const recIdx = recoveryDate ? dayIndex.get(recoveryDate) ?? troughIdx : null;
    const downDays = Math.max(0, troughIdx - fromIdx);
    const recoveryDays = recIdx === null ? null : Math.max(0, recIdx - troughIdx);
    out.push({
      peakDate: open.peakDate,
      peakEquity: open.peakEquity,
      troughDate: open.troughDate,
      troughEquity: open.troughEquity,
      depth: open.peakEquity - open.troughEquity,
      downDays,
      recoveryDays,
      recoveryDate,
      durationDays: downDays + (recoveryDays ?? Math.max(0, lastIdx - troughIdx)),
      recovered: recoveryDate !== null,
    });
    open = null;
  };

  for (const t of sorted) {
    equity += t.pnl;
    if (equity >= peak) {
      close(t.date);
      peak = equity;
      peakDate = t.date;
    } else if (!open) {
      open = {
        peakDate,
        peakEquity: peak,
        troughDate: t.date,
        troughEquity: equity,
      };
    } else if (equity < open.troughEquity) {
      open.troughDate = t.date;
      open.troughEquity = equity;
    }
  }
  close(null);
  return out;
}

export interface DrawdownStats {
  /** 回撤段数 */
  episodes: number;
  /** 当前距历史新高的回落（正数；0 = 正在新高） */
  current: number;
  /** 水下（权益低于前高）的交易日占比 0..1 */
  timeUnderwater: number;
  /** 已收复的回撤段，平均用几个交易日回到前高 */
  avgRecoveryDays: number | null;
  /** 最久的一段回撤（交易日） */
  longestDays: number | null;
  /** 最久那段是否已经收复 */
  longestRecovered: boolean;
}

export function drawdownStats(trades: Trade[]): DrawdownStats {
  const eps = drawdownEpisodes(trades);
  const days = dailyPnl(trades);
  const series = drawdownSeries(trades);
  const current = series.length ? Math.abs(series[series.length - 1].dd) : 0;

  let equity = 0;
  let peak = 0;
  let under = 0;
  for (const d of days) {
    equity += d.pnl;
    if (equity > peak) peak = equity;
    else if (equity < peak) under++;
  }

  const recovered = eps.filter((e) => e.recoveryDays !== null);
  const avgRecoveryDays = recovered.length
    ? recovered.reduce((a, e) => a + (e.recoveryDays as number), 0) / recovered.length
    : null;
  const longest = eps.reduce<DrawdownEpisode | null>(
    (a, e) => (!a || e.durationDays > a.durationDays ? e : a),
    null
  );

  return {
    episodes: eps.length,
    current,
    timeUnderwater: days.length ? under / days.length : 0,
    avgRecoveryDays,
    longestDays: longest ? longest.durationDays : null,
    longestRecovered: longest ? longest.recovered : false,
  };
}

export interface GroupStat {
  key: string;
  count: number;
  pnl: number;
  winRate: number;
  avgPnl: number;
}export function groupBy(
  trades: Trade[],
  keyFn: (t: Trade) => string
): GroupStat[] {
  const buckets = new Map<string, Trade[]>();
  for (const t of trades) {
    const k = keyFn(t) || "未分类";
    const arr = buckets.get(k) ?? [];
    arr.push(t);
    buckets.set(k, arr);
  }
  const out: GroupStat[] = [];
  for (const [key, list] of buckets) {
    const s = summarize(list);
    out.push({
      key,
      count: list.length,
      pnl: s.netPnl,
      winRate: s.winRate,
      avgPnl: s.netPnl / list.length,
    });
  }
  return out.sort((a, b) => b.pnl - a.pnl);
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function byWeekday(trades: Trade[]): GroupStat[] {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const stats = groupBy(trades, (t) => {
    const d = new Date(t.date + "T00:00:00");
    return Number.isNaN(d.getTime()) ? "未知" : WEEKDAYS[d.getDay()];
  });
  const rank = (k: string) => {
    const i = WEEKDAYS.indexOf(k);
    return i === -1 ? 99 : order.indexOf(i);
  };
  return stats.sort((a, b) => rank(a.key) - rank(b.key));
}

export interface DayPnl {
  date: string;
  pnl: number;
  count: number;
}

export function dailyPnl(trades: Trade[]): DayPnl[] {
  const map = new Map<string, DayPnl>();
  for (const t of trades) {
    const cur = map.get(t.date) ?? { date: t.date, pnl: 0, count: 0 };
    cur.pnl += t.pnl;
    cur.count++;
    map.set(t.date, cur);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface Filter {
  from?: string;
  to?: string;
  symbol?: string;
  setup?: string;
  account?: string;
  direction?: "all" | "long" | "short";
}

export function filterTrades(trades: Trade[], f: Filter): Trade[] {
  return trades.filter((t) => {
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (f.symbol && f.symbol !== "all" && t.symbol !== f.symbol) return false;
    if (f.setup && f.setup !== "all" && t.setup !== f.setup) return false;
    if (f.account && f.account !== "all" && t.account !== f.account) return false;
    if (f.direction && f.direction !== "all" && t.direction !== f.direction) return false;
    return true;
  });
}

export function uniqueValues(trades: Trade[], pick: (t: Trade) => string): string[] {
  return [...new Set(trades.map(pick).filter((v) => v && v.trim()))].sort();
}
