import { Trade } from "../types";
import {
  DayPnl,
  DrawdownEpisode,
  DrawdownStats,
  Summary,
  dailyPnl,
  drawdownEpisodes,
  drawdownStats,
  summarize,
} from "./analytics";

/**
 * 指标注册表。
 *
 * 每个指标是一个纯函数，只依赖「一次统计结果」；新增指标不需要改渲染层，
 * 只要往 REGISTRY 里加一条。卡片、环比、导出全部从同一张表取。
 */

export type MetricFormat = "money" | "pct" | "num" | "ratio" | "duration" | "days";
export type MetricCategory = "performance" | "volume" | "average" | "risk";

/** 一次算好，所有指标共用，避免每个指标都遍历一遍交易 */
export interface MetricBase {
  trades: Trade[];
  s: Summary;
  days: DayPnl[];
  /** 平均持仓秒数；没有可用的平仓时间时为 null */
  holdAvg: number | null;
  /** 参与持仓时间统计的笔数 */
  holdCount: number;
  /** 回撤分段明细 */
  dd: DrawdownEpisode[];
  /** 回撤汇总（水下时间、平均恢复…） */
  ddStats: DrawdownStats;
}

export interface MetricDef {
  id: string;
  name: string;
  /** 短说明，鼠标悬停用 */
  desc: string;
  category: MetricCategory;
  format: MetricFormat;
  /** 没有意义时返回 null（例如没有亏损笔时的盈亏比），UI 显示 — */
  compute: (b: MetricBase) => number | null;
  /**
   * 展示用变换：把"数值大小"转成"带方向的展示值"。
   * 最大回撤算出来是正数（跌幅），但展示成负数才不会被读成盈利。
   */
  display?: (v: number) => number;
  hint?: (b: MetricBase) => string;
}

export function makeBase(trades: Trade[]): MetricBase {
  const s = summarize(trades);
  const holdValues = trades
    .map((t) => t.holdSeconds)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0);
  return {
    trades,
    s,
    days: dailyPnl(trades),
    holdAvg: holdValues.length ? holdValues.reduce((a, b) => a + b, 0) / holdValues.length : null,
    holdCount: holdValues.length,
    dd: drawdownEpisodes(trades),
    ddStats: drawdownStats(trades),
  };
}

const safeRatio = (n: number, d: number): number | null => (d ? n / d : null);

export const REGISTRY: MetricDef[] = [
  /* ---------- performance ---------- */
  {
    id: "netPnL",
    name: "净盈亏",
    desc: "已扣手续费的合计盈亏",
    category: "performance",
    format: "money",
    compute: (b) => b.s.netPnl,
    hint: (b) => `手续费 ${b.s.fees.toFixed(2)}`,
  },
  {
    id: "winRate",
    name: "胜率",
    desc: "盈利笔数 ÷ 有结果的笔数（不含打平）",
    category: "performance",
    format: "pct",
    compute: (b) => (b.s.wins + b.s.losses ? b.s.winRate : null),
    hint: (b) => `${b.s.wins} 胜 / ${b.s.losses} 负`,
  },
  {
    id: "profitFactor",
    name: "盈亏比",
    desc: "总盈利 ÷ 总亏损（毛额，不含手续费）",
    category: "performance",
    format: "ratio",
    compute: (b) => (Number.isFinite(b.s.profitFactor) ? b.s.profitFactor : null),
    hint: (b) => `毛利 ${b.s.grossProfit.toFixed(2)} / 毛亏 ${b.s.grossLoss.toFixed(2)}`,
  },
  {
    id: "expectancy",
    name: "期望值 / 笔",
    desc: "净盈亏 ÷ 交易笔数",
    category: "performance",
    format: "money",
    compute: (b) => (b.s.count ? b.s.expectancy : null),
    hint: (b) => `${b.s.count} 笔`,
  },
  {
    id: "maxDrawdown",
    name: "最大回撤",
    desc: "权益曲线从高点到低点的最大跌幅",
    category: "performance",
    format: "money",
    compute: (b) => b.s.maxDrawdown,
    // 回撤是"跌了多少"，展示成负数才不会和盈利混淆
    display: (v) => -Math.abs(v),
    hint: () => "按平仓顺序累计",
  },
  {
    id: "currentDrawdown",
    name: "当前回撤",
    desc: "最新权益距历史最高点还差多少；0 表示正在新高",
    category: "risk",
    format: "money",
    compute: (b) => (b.trades.length ? b.ddStats.current : null),
    display: (v) => -Math.abs(v),
    hint: (b) => (b.ddStats.current === 0 ? "正在历史新高" : "水下中"),
  },
  {
    id: "avgRecovery",
    name: "平均恢复",
    desc: "每次回撤后，用几个交易日回到前高（只算已收复的）",
    category: "risk",
    format: "days",
    compute: (b) => b.ddStats.avgRecoveryDays,
    hint: (b) => {
      const done = b.dd.filter((e) => e.recovered).length;
      return `${done}/${b.dd.length} 段已收复`;
    },
  },
  {
    id: "longestDrawdown",
    name: "最长回撤",
    desc: "最久的一段回撤持续了几个交易日（含等待收复的时间）",
    category: "risk",
    format: "days",
    compute: (b) => b.ddStats.longestDays,
    hint: (b) => (b.dd.length ? (b.ddStats.longestRecovered ? "已收复" : "仍未收复") : "没有回撤"),
  },
  {
    id: "timeUnderwater",
    name: "水下时间",
    desc: "权益低于前高的交易日占比；越低说明资金曲线越顺",
    category: "risk",
    format: "pct",
    compute: (b) => (b.days.length ? b.ddStats.timeUnderwater : null),
    hint: (b) => `${b.days.length} 个交易日`,
  },
  {
    id: "bestDay",
    name: "最佳单日",
    desc: "单日盈亏的最大值",
    category: "performance",
    format: "money",
    compute: (b) => (b.days.length ? Math.max(...b.days.map((d) => d.pnl)) : null),
  },
  {
    id: "worstDay",
    name: "最差单日",
    desc: "单日盈亏的最小值",
    category: "performance",
    format: "money",
    compute: (b) => (b.days.length ? Math.min(...b.days.map((d) => d.pnl)) : null),
  },
  {
    id: "bestTrade",
    name: "最大单笔盈利",
    desc: "单笔盈亏的最大值",
    category: "performance",
    format: "money",
    compute: (b) => (b.trades.length ? b.s.bestTrade : null),
  },
  {
    id: "worstTrade",
    name: "最大单笔亏损",
    desc: "单笔盈亏的最小值",
    category: "performance",
    format: "money",
    compute: (b) => (b.trades.length ? b.s.worstTrade : null),
  },
  {
    id: "longestWinStreak",
    name: "最长连胜",
    desc: "连续盈利的最大笔数",
    category: "performance",
    format: "num",
    compute: (b) => b.s.maxWinStreak,
  },
  {
    id: "longestLossStreak",
    name: "最长连亏",
    desc: "连续亏损的最大笔数",
    category: "performance",
    format: "num",
    compute: (b) => b.s.maxLossStreak,
  },

  /* ---------- volume ---------- */
  {
    id: "numTrades",
    name: "总交易数",
    desc: "当前时间档内的交易笔数",
    category: "volume",
    format: "num",
    compute: (b) => b.s.count,
    hint: (b) => `${b.days.length} 个交易日`,
  },
  {
    id: "numWinTrades",
    name: "盈利笔数",
    category: "volume",
    desc: "盈亏 > 0 的笔数",
    format: "num",
    compute: (b) => b.s.wins,
  },
  {
    id: "numLossTrades",
    name: "亏损笔数",
    desc: "盈亏 < 0 的笔数",
    category: "volume",
    format: "num",
    compute: (b) => b.s.losses,
  },
  {
    id: "tradingDays",
    name: "交易天数",
    desc: "有交易的自然日数量",
    category: "volume",
    format: "num",
    compute: (b) => b.days.length,
  },
  {
    id: "feesTotal",
    name: "手续费合计",
    desc: "当前时间档内的手续费总额",
    category: "volume",
    format: "money",
    compute: (b) => b.s.fees,
  },

  /* ---------- average ---------- */
  {
    id: "avgWin",
    name: "平均盈利",
    desc: "盈利笔的平均盈亏",
    category: "average",
    format: "money",
    compute: (b) => (b.s.wins ? b.s.avgWin : null),
  },
  {
    id: "avgLoss",
    name: "平均亏损",
    desc: "亏损笔的平均亏损（正数表示亏损额）",
    category: "average",
    format: "money",
    compute: (b) => (b.s.losses ? b.s.avgLoss : null),
  },
  {
    id: "avgRR",
    name: "平均盈亏比",
    desc: "平均盈利 ÷ 平均亏损",
    category: "average",
    format: "ratio",
    compute: (b) => (b.s.losses && b.s.wins ? safeRatio(b.s.avgWin, b.s.avgLoss) : null),
    hint: () => "超过 1 才算正的期望",
  },
  {
    id: "avgHoldTime",
    name: "平均持仓",
    desc: "开仓到平仓的平均时长",
    category: "average",
    format: "duration",
    compute: (b) => b.holdAvg,
    hint: (b) =>
      b.holdCount < b.trades.length ? `${b.holdCount}/${b.trades.length} 笔有平仓时间` : "全部有平仓时间",
  },
  {
    id: "avgDailyPnl",
    name: "日均盈亏",
    desc: "净盈亏 ÷ 交易天数",
    category: "average",
    format: "money",
    compute: (b) => (b.days.length ? b.s.netPnl / b.days.length : null),
  },
];

export const REGISTRY_BY_ID = new Map(REGISTRY.map((m) => [m.id, m]));

/** 仪表盘默认展示的 6 张卡 */
export const DEFAULT_CARDS = [
  "netPnL",
  "numTrades",
  "winRate",
  "profitFactor",
  "expectancy",
  "maxDrawdown",
];

export function pickMetrics<T extends { id: string }>(defs: T[], ids: string[]): T[] {
  const map = new Map(defs.map((d) => [d.id, d]));
  return ids.map((id) => map.get(id)).filter((d): d is T => Boolean(d));
}

/** 按 format 格式化；null 统一显示 — */
export function formatMetric(value: number | null | undefined, format: MetricFormat, cur = "¥"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  switch (format) {
    case "money":
      return money(value, cur);
    case "pct":
      return `${(value * 100).toFixed(1)}%`;
    case "ratio":
      return Number.isFinite(value) ? value.toFixed(2) : "∞";
    case "duration":
      return duration(value);
    case "days":
      return `${Math.round(value)} 天`;
    case "num":
    default:
      return Math.abs(value) >= 1000 ? value.toLocaleString("zh-CN") : String(Math.round(value * 100) / 100);
  }
}

function money(v: number, cur: string): string {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  const body = abs >= 1000 ? abs.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : abs.toFixed(2);
  return `${sign}${cur}${body}`;
}

/** 秒 → 人话 */
export function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const min = seconds / 60;
  if (min < 1) return "不到 1 分钟";
  if (min < 60) return `${Math.round(min)} 分钟`;
  const h = min / 60;
  if (h < 24) return h < 10 ? `${h.toFixed(1)} 小时` : `${Math.round(h)} 小时`;
  const d = h / 24;
  return `${d.toFixed(1)} 天`;
}

/** 环比：返回差值和方向；无法比较时 delta 为 null */
export function compareMetric(
  cur: number | null,
  prev: number | null,
  format: MetricFormat
): { delta: number | null; text: string; tone: "up" | "down" | "flat" } {
  if (cur === null || prev === null || !Number.isFinite(cur) || !Number.isFinite(prev)) {
    return { delta: null, text: "—", tone: "flat" };
  }
  const delta = cur - prev;
  const tone = Math.abs(delta) < 1e-9 ? "flat" : delta > 0 ? "up" : "down";
  const abs = Math.abs(delta);
  let body: string;
  if (format === "pct") body = `${(abs * 100).toFixed(1)}%`;
  else if (format === "ratio") body = abs.toFixed(2);
  else if (format === "duration") body = duration(abs);
  else if (format === "days") body = `${Math.round(abs)} 天`;
  else if (format === "money") body = abs.toFixed(2);
  else body = abs >= 1000 ? Math.round(abs).toLocaleString("zh-CN") : String(Math.round(abs * 100) / 100);
  return { delta, text: tone === "up" ? `+${body}` : tone === "down" ? `-${body}` : body, tone };
}
