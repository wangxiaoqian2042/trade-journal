export type Direction = "long" | "short";

/** 交易时段（按开仓时间、本地时区推断） */
export type Session = "asia" | "europe" | "ny" | "off";

/** 一笔交易的结果分类；打平区间内的交易不算赢也不算输 */
export type Outcome = "win" | "loss" | "be";

export interface Trade {
  /** vault 内的文件路径，作为唯一 id */
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm，可为空
  symbol: string;
  direction: Direction;
  entry: number;
  exit: number;
  quantity: number;
  fees: number;
  /** 净盈亏，已扣手续费 */
  pnl: number;
  setup: string;
  account: string;
  stop: number | null;
  target: number | null;
  /** 平仓时间 HH:mm[:ss]，订单历史配对时能拿到 */
  exitTime?: string;
  /** 持有时长（秒）；有开平时间才能算 */
  holdSeconds?: number | null;
  /** 交易时段，读取时按开仓时间推导，不落盘 */
  session?: Session;
  /** 结果分类，读取时按打平区间推导，不落盘；缺省时按 pnl 正负判断 */
  outcome?: Outcome;
  tags: string[];
  notes: string;
}

export interface TradeDraft extends Omit<Trade, "id"> {
  /** 导入去重用 */
  source?: string;
}

export function tradeKey(t: {
  date: string;
  symbol: string;
  entry: number;
  exit: number;
  quantity: number;
}): string {
  const r = (n: number) => (Number.isFinite(n) ? n.toFixed(6) : "0");
  return [
    t.date,
    t.symbol.trim().toUpperCase(),
    r(t.entry),
    r(t.exit),
    r(t.quantity),
  ].join("|");
}
