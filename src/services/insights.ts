import { Trade } from "../types";
import { DashboardSnapshot } from "./aggregate";
import { GroupStat, byWeekday, groupBy } from "./analytics";

/**
 * 概要视图的「结论层」。
 *
 * 这里只做一件事：把已经算好的数字翻译成人话。
 * 所有判断都基于可复现的阈值，不猜、不预测、不给玄学建议——
 * 用户能顺着每条结论回到仪表盘核对。
 */

export type InsightTone = "good" | "bad" | "info";

export interface Insight {
  id: string;
  tone: InsightTone;
  /** 一句话结论 */
  text: string;
  /** 支撑数字 / 上下文 */
  detail?: string;
}

const TONE_ORDER: Record<InsightTone, number> = { bad: 0, good: 1, info: 2 };

function fmtMoney(v: number, cur: string): string {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  const body =
    abs >= 1000
      ? abs.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : abs.toFixed(2);
  return `${sign}${cur}${body}`;
}

const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;
const plural = (n: number, unit: string) => `${n} ${unit}`;

/** 概览顶部那句话：本期发生了什么 */
export function headline(s: DashboardSnapshot, cur: string): string {
  const { base, prevBase } = s;
  if (!base.s.count) return "这个区间没有交易。";

  const days = base.days.length;
  const verb = base.s.netPnl >= 0 ? "净赚" : "净亏";
  const parts = [
    `${days} 个交易日、${base.s.count} 笔，${verb} ${fmtMoney(Math.abs(base.s.netPnl), cur)}`,
    `胜率 ${pct(base.s.winRate)}`,
  ];
  if (base.s.losses > 0 && base.s.wins > 0) parts.push(`盈亏比 ${base.s.profitFactor.toFixed(2)}`);

  if (prevBase.s.count) {
    const delta = base.s.netPnl - prevBase.s.netPnl;
    parts.push(
      delta === 0
        ? "与上期打平"
        : `${delta > 0 ? "比上期多" : "比上期少"} ${fmtMoney(Math.abs(delta), cur)}`
    );
  }
  return parts.join("，") + "。";
}

export interface Highlight {
  dimension: string;
  key: string;
  pnl: number;
  count: number;
  winRate: number;
}

/** 只看至少打过 2 笔的维度，避免单笔运气被当成规律 */
const MIN_SAMPLE = 2;

export function highlights(trades: Trade[]): { strong: Highlight[]; weak: Highlight[] } {
  const dims: { name: string; items: GroupStat[] }[] = [
    { name: "策略", items: groupBy(trades, (t) => t.setup) },
    { name: "标的", items: groupBy(trades, (t) => t.symbol) },
    { name: "星期", items: byWeekday(trades).filter((w) => w.key !== "未知") },
  ];

  const strong: Highlight[] = [];
  const weak: Highlight[] = [];

  for (const d of dims) {
    const usable = d.items.filter((i) => i.count >= MIN_SAMPLE);
    if (!usable.length) continue;
    let max = usable[0];
    let min = usable[0];
    for (const i of usable) {
      if (i.pnl > max.pnl) max = i;
      if (i.pnl < min.pnl) min = i;
    }
    if (max.pnl > 0) strong.push({ dimension: d.name, ...max });
    if (min.pnl < 0 && min.key !== max.key) weak.push({ dimension: d.name, ...min });
  }

  strong.sort((a, b) => b.pnl - a.pnl);
  weak.sort((a, b) => a.pnl - b.pnl);
  return { strong, weak };
}

/** 规则化的结论清单。阈值写死在这里，方便以后调 */
export function buildInsights(s: DashboardSnapshot, cur: string): Insight[] {
  const b = s.base;
  const out: Insight[] = [];
  const n = b.s.count;
  if (!n) return out;

  // 样本量先开口：小样本下所有比率都不可靠
  if (n < 20) {
    out.push({
      id: "sample",
      tone: "info",
      text: `样本只有 ${plural(n, "笔")}，胜率和盈亏比的波动会很大`,
      detail: "同一个策略再打 20 笔，数字可能完全变样",
    });
  }

  // 单笔亏损 vs 平均盈利：决定「一次失手要几笔才补回来」
  if (b.s.losses > 0 && b.s.avgWin > 0) {
    const worst = Math.abs(b.s.worstTrade);
    const ratio = worst / b.s.avgWin;
    if (ratio >= 2) {
      out.push({
        id: "tailRisk",
        tone: "bad",
        text: `最大单笔亏损是平均盈利的 ${ratio.toFixed(1)} 倍`,
        detail: `亏一次要 ${Math.ceil(ratio)} 笔盈利才补回来（${fmtMoney(b.s.worstTrade, cur)} / ${fmtMoney(b.s.avgWin, cur)}）`,
      });
    }
  }

  if (b.s.maxLossStreak >= 4) {
    out.push({
      id: "lossStreak",
      tone: "bad",
      text: `最长连亏 ${plural(b.s.maxLossStreak, "笔")}`,
      detail: "连亏段通常是仓位和情绪同时失控的地方",
    });
  }

  // 利润集中度：只有一个策略在赚钱，说明样本还不足以证明别的策略有效
  const setups = groupBy(b.trades, (t) => t.setup).filter((g) => g.pnl > 0);
  if (b.s.netPnl > 0 && setups.length) {
    const top = setups[0];
    const share = top.pnl / b.s.netPnl;
    if (share >= 0.6 && b.s.netPnl > 0) {
      out.push({
        id: "concentration",
        tone: "info",
        text: `${pct(share)} 的利润来自「${top.key}」`,
        detail: `${top.count} 笔带来 ${fmtMoney(top.pnl, cur)}，其余策略合计只占 ${pct(1 - share)}`,
      });
    }
  }

  // 水下时间：比最大回撤更能反映「拿不拿得住」
  if (b.days.length >= 5) {
    const tu = b.ddStats.timeUnderwater;
    if (tu >= 0.5) {
      out.push({
        id: "underwater",
        tone: "bad",
        text: `${pct(tu)} 的交易日都在水下`,
        detail: `权益低于前高的日子有 ${Math.round(tu * b.days.length)} 天，共 ${b.days.length} 个交易日`,
      });
    } else if (tu <= 0.2) {
      out.push({
        id: "underwater",
        tone: "good",
        text: `只有 ${pct(tu)} 的交易日在水下`,
        detail: "资金曲线基本贴着新高走",
      });
    }
  }

  // 当前仍被套：给一个明确的"还差多少"
  if (b.ddStats.current > 0) {
    const peak = b.s.netPnl + b.ddStats.current;
    const ratio = peak > 0 ? b.ddStats.current / peak : 0;
    out.push({
      id: "currentDd",
      tone: "info",
      text: `当前还在水下 ${fmtMoney(b.ddStats.current, cur)}`,
      detail: ratio > 0 ? `距前高回落 ${pct(ratio, 1)}，需要这么多盈利才能回本` : undefined,
    });
  }

  // 手续费：小账户最容易忽略的漏损
  if (b.s.fees > 0 && b.s.grossProfit > 0) {
    const rate = b.s.fees / b.s.grossProfit;
    if (rate >= 0.15) {
      out.push({
        id: "fees",
        tone: "bad",
        text: `手续费吃掉毛利的 ${pct(rate)}`,
        detail: `${fmtMoney(b.s.fees, cur)} 手续费 / ${fmtMoney(b.s.grossProfit, cur)} 毛利`,
      });
    }
  }

  // 数据缺口要摆明，不能让用户以为指标坏了
  const withStop = b.trades.filter((t) => typeof t.stop === "number" && t.stop > 0).length;
  if (n > 0) {
    out.push({
      id: "stopCoverage",
      tone: "info",
      text:
        withStop === 0
          ? `R 倍数暂不可用：${n} 笔里 0 笔填了止损价`
          : `R 倍数可覆盖 ${withStop}/${n} 笔`,
      detail:
        withStop === 0
          ? "在笔记 frontmatter 补 stop: 价格，卡片和回撤统计会自动用上"
          : undefined,
    });
  }

  return out.sort((a, x) => TONE_ORDER[a.tone] - TONE_ORDER[x.tone]);
}
