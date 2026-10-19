import { Direction, TradeDraft } from "../types";
import { BuildResult, normalizeDirection, parseDate, parseNumber } from "./csv";

/**
 * 订单历史（委托级）→ 回合级交易。
 *
 * 券商/平台导出的「订单历史 / Order History / 成交明细」每行是一个委托或一笔成交，
 * 只有一个价格、没有开平仓配对。交易日志要的是「一个回合」：开仓价 + 平仓价 + 盈亏。
 * 这里用 FIFO 把同标的的成交按时间顺序配对，卖出平多、买入平空，剩余的反向成交开新仓。
 */

export type OrderFieldKey =
  | "symbol"
  | "side"
  | "kind"
  | "qty"
  | "filled"
  | "price"
  | "status"
  | "time"
  | "fees";

export interface OrderDetection {
  map: Partial<Record<OrderFieldKey, number>>;
  missing: OrderFieldKey[];
}

const ALIASES: Record<OrderFieldKey, string[]> = {
  symbol: ["商品代码", "合约代码", "品种代码", "代码", "标的", "合约", "品种", "symbol", "contract", "instrument", "ticker", "market"],
  side: ["买/卖", "买卖", "买入/卖出", "方向", "交易方向", "多空", "side", "b/s", "buy/sell", "buysell", "action", "direction"],
  kind: ["类型", "订单类型", "委托类型", "order type", "type"],
  qty: ["数量", "委托数量", "手数", "quantity", "qty", "size", "volume", "lots", "contracts"],
  filled: ["填充数量", "已成交数量", "成交数量", "成交量", "filled", "filled qty", "filledqty", "fill qty", "filledquantity"],
  price: ["平均成交价", "成交均价", "成交价", "均价", "avg price", "avgprice", "average price", "fill price", "fillprice", "price", "价格"],
  status: ["状态", "订单状态", "委托状态", "status", "state"],
  time: ["状态时间", "成交时间", "下单时间", "委托时间", "时间", "日期", "time", "date", "datetime", "timestamp", "filled at", "filledat"],
  fees: ["手续费", "佣金", "费用", "commission", "fees", "fee", "cost"],
};

const FILLED = ["已成交", "全部成交", "完全成交", "成交", "部分成交", "filled", "fully filled", "complete", "completed", "executed", "done", "partial", "partially filled"];
const DEAD = ["已取消", "取消", "已撤单", "撤单", "已拒绝", "拒绝", "已过期", "过期", "canceled", "cancelled", "rejected", "expired", "void"];

/** 真正的「成交时刻」列，优先级高于下单时间 */
const FILL_TIME = [
  "状态时间", "成交时间", "成交日期", "成交时刻", "填充时间",
  "filled at", "filledat", "fill time", "filltime", "execution time", "executed at", "last update",
];

function norm(h: string): string {
  return h
    .replace(/^\uFEFF/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase()
    .replace(/[_\-.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 判断这份 CSV 是不是「委托级」导出；是则返回列映射 */
export function detectOrderExport(header: string[]): OrderDetection | null {
  if (!header.length) return null;
  const normed = header.map(norm);
  const compact = normed.map((h) => h.replace(/[\s/]/g, ""));
  const map: Partial<Record<OrderFieldKey, number>> = {};
  const used = new Set<number>();

  const hit = (keys: string[], i: number): boolean =>
    keys.some((a) => {
      const ac = a.replace(/[\s/]/g, "").toLowerCase();
      return normed[i] === a || compact[i] === ac;
    });

  // 先精确，再包含（别名至少 4 字符，且表头不能太短）
  for (const pass of ["exact", "fuzzy"] as const) {
    for (const key of Object.keys(ALIASES) as OrderFieldKey[]) {
      if (map[key] !== undefined) continue;
      const idx = normed.findIndex((h, i) => {
        if (used.has(i) || h === "") return false;
        if (pass === "exact") return hit(ALIASES[key], i);
        return ALIASES[key].some((a) => {
          if (a.length < 4) return false;
          const ac = a.replace(/[\s/]/g, "").toLowerCase();
          return compact[i].includes(ac) || (compact[i].length >= 4 && ac.includes(compact[i]));
        });
      });
      if (idx !== -1) {
        map[key] = idx;
        used.add(idx);
      }
    }
  }

  // 委托级导出的特征：有买卖方向 + 价格，且数量/成交数量/状态至少两项
  const signals = ["qty", "filled", "status"].filter((k) => map[k as OrderFieldKey] !== undefined);
  if (map.symbol === undefined || map.side === undefined || map.price === undefined) return null;
  if (signals.length < 2) return null;

  // 时间列优先用「成交/状态时间」：下单时间只是委托提交时刻，
  // 挂单可能几分钟后才成交，用下单时间会把持有时间算错、把配对顺序排乱
  const fillIdx = normed.findIndex((h, i) =>
    FILL_TIME.some((a) => h === a || compact[i] === a.replace(/[\s/]/g, "").toLowerCase())
  );
  if (fillIdx !== -1) map.time = fillIdx;
  else if (map.time === undefined && map.status !== undefined) {
    // 有些导出没有时间列，那就没法配对
    return null;
  }

  const missing = (Object.keys(ALIASES) as OrderFieldKey[]).filter(
    (k) => map[k] === undefined
  );
  return { map, missing };
}

/** 合约每点价值（$ / 点），用于把价差换算成金额 */
const MULTIPLIERS: [string, number][] = [
  ["MNQ", 2], ["NQ", 20], ["MES", 5], ["ES", 50], ["MYM", 0.5], ["YM", 5],
  ["M2K", 5], ["RTY", 50], ["M6E", 12500], ["6E", 125000], ["6B", 62500],
  ["6J", 1250000], ["6A", 100000], ["MCL", 100], ["CL", 1000], ["QM", 500],
  ["MGC", 10], ["GC", 100], ["SIL", 1000], ["SI", 5000], ["MHG", 2500],
  ["HG", 25000], ["MNG", 2500], ["NG", 10000], ["ZN", 1000], ["ZB", 1000],
  ["ZF", 1000], ["ZT", 1000], ["BTC", 5], ["MBT", 0.1], ["ETH", 50],
];

/** 从 F.US.MNQZ26 这类合约代号里取出品种并返回每点价值；认不出返回 null */
export function contractMultiplier(symbol: string): number | null {
  const parts = symbol.toUpperCase().split(/[.:/\s|_-]+/).filter(Boolean);
  const root = parts.length ? parts[parts.length - 1] : "";
  if (!root) return null;
  for (const [code, mult] of MULTIPLIERS) {
    if (root.startsWith(code)) return mult;
  }
  return null;
}

interface Fill {
  row: number;
  symbol: string;
  side: Direction;
  qty: number;
  price: number;
  at: string;
  date: string;
  time: string;
  kind: string;
  feePerUnit: number;
}

interface Lot {
  side: Direction;
  qty: number;
  price: number;
  at: string;
  date: string;
  time: string;
  kind: string;
  feePerUnit: number;
}

export interface PairMeta {
  totalRows: number;
  fills: number;
  dead: number;
  trips: number;
  gross: number;
  fees: number;
  open: { symbol: string; side: Direction; qty: number; at: string }[];
  unknownSymbols: string[];
}

export interface PairResult extends BuildResult {
  meta: PairMeta;
}

function statusKind(raw: string): "filled" | "dead" | "other" {
  const v = raw.trim().toLowerCase();
  if (!v) return "other";
  if (FILLED.some((s) => v === s || v.includes(s))) return "filled";
  if (DEAD.some((s) => v.includes(s))) return "dead";
  return "other";
}

/**
 * 把委托级成交配对成回合级交易。
 * @param feePerContract 每手往返手续费（成交行里没有手续费列或为空时使用）
 */
export function pairOrders(
  rows: string[][],
  det: OrderDetection,
  opts: { feePerContract?: number } = {}
): PairResult {
  const { map } = det;
  const feeDefault = Math.abs(opts.feePerContract ?? 0);
  const errors: { row: number; message: string }[] = [];
  const fills: Fill[] = [];
  const unknown = new Set<string>();
  let dead = 0;

  const cell = (r: string[], k: OrderFieldKey): string => {
    const i = map[k];
    return i === undefined ? "" : (r[i] ?? "").trim();
  };

  rows.forEach((r, i) => {
    const line = i + 2;
    if (r.every((c) => !c || !c.trim())) return;

    const status = cell(r, "status");
    const kind = statusKind(status);
    if (kind === "dead") {
      dead++;
      return;
    }

    const qtyFilled = parseNumber(cell(r, "filled"));
    const qtyOrdered = parseNumber(cell(r, "qty"));
    const qty = qtyFilled !== null && qtyFilled > 0 ? qtyFilled : qtyOrdered ?? 0;
    if (kind === "other" && status !== "" && qtyFilled !== null && qtyFilled <= 0) {
      // 未成交的挂单
      dead++;
      return;
    }
    if (qty <= 0) {
      errors.push({ row: line, message: `数量为 0（状态：${status || "空"}）` });
      return;
    }

    const symbol = cell(r, "symbol");
    if (!symbol) {
      errors.push({ row: line, message: "标的为空" });
      return;
    }

    const side = normalizeDirection(cell(r, "side"));
    if (!side) {
      errors.push({ row: line, message: `方向无法识别：${cell(r, "side") || "（空）"}` });
      return;
    }

    const price = parseNumber(cell(r, "price"));
    if (price === null || price === 0) {
      errors.push({ row: line, message: `成交价为空：${cell(r, "price") || "（空）"}` });
      return;
    }

    const at = cell(r, "time");
    const { date, time } = parseDate(at);
    if (!date) {
      errors.push({ row: line, message: `时间无法识别：${at.slice(0, 24) || "（空）"}` });
      return;
    }

    const feeRaw = parseNumber(cell(r, "fees"));
    const feePerUnit = feeRaw !== null && feeRaw > 0 ? feeRaw / qty : feeDefault;

    if (contractMultiplier(symbol) === null) unknown.add(symbol);

    fills.push({
      row: line,
      symbol,
      side,
      qty,
      price,
      at: stamp(at, date, time),
      date,
      time,
      kind: cell(r, "kind") || (side === "long" ? "买入" : "卖出"),
      feePerUnit,
    });
  });

  fills.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.row - b.row));

  const books = new Map<string, Lot[]>();
  const drafts: TradeDraft[] = [];

  for (const f of fills) {
    const mult = contractMultiplier(f.symbol) ?? 1;
    const book = books.get(f.symbol) ?? [];
    books.set(f.symbol, book);

    let remaining = f.qty;
    while (remaining > 1e-9 && book.length && book[0].side !== f.side) {
      const lot = book[0];
      const take = Math.min(remaining, lot.qty);
      const direction = lot.side;
      const gross = (f.price - lot.price) * take * mult * (direction === "long" ? 1 : -1);
      const fees = (lot.feePerUnit + f.feePerUnit) * take;
      drafts.push({
        date: lot.date,
        time: lot.time,
        exitTime: clockOf(f.at),
        holdSeconds: secondsBetween(lot.at, f.at),
        symbol: f.symbol,
        direction,
        entry: round(lot.price),
        exit: round(f.price),
        quantity: round(take),
        fees: round(fees),
        pnl: round(gross - fees),
        setup: "",
        account: "",
        stop: null,
        target: null,
        tags: ["trade", "auto-paired"],
        notes: `自动配对：${lot.kind} → ${f.kind}，持有 ${duration(lot.at, f.at)}`,
        source: `pair:${f.symbol}:${lot.at}:${f.at}:${take}`,
      });
      lot.qty -= take;
      remaining -= take;
      if (lot.qty <= 1e-9) book.shift();
    }

    if (remaining > 1e-9) {
      book.push({
        side: f.side,
        qty: remaining,
        price: f.price,
        at: f.at,
        date: f.date,
        time: f.time,
        kind: f.kind,
        feePerUnit: f.feePerUnit,
      });
    }
  }

  drafts.sort((a, b) => (`${a.date} ${a.time}` < `${b.date} ${b.time}` ? -1 : 1));

  const open: PairMeta["open"] = [];
  for (const [symbol, book] of books) {
    for (const lot of book) {
      if (lot.qty > 1e-9) open.push({ symbol, side: lot.side, qty: round(lot.qty), at: lot.at });
    }
  }

  return {
    drafts,
    errors,
    meta: {
      totalRows: rows.length,
      fills: fills.length,
      dead,
      trips: drafts.length,
      gross: round(drafts.reduce((s, d) => s + d.pnl + d.fees, 0)),
      fees: round(drafts.reduce((s, d) => s + d.fees, 0)),
      open,
      unknownSymbols: [...unknown],
    },
  };
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** 带秒的排序时间戳：同一分钟内多笔成交时靠秒区分先后（配对顺序全靠这个） */
function stamp(raw: string, date: string, time: string): string {
  const m = /(\d{1,2}):(\d{2}):(\d{2})/.exec(raw);
  if (m) {
    return `${date} ${String(Number(m[1])).padStart(2, "0")}:${m[2]}:${m[3]}`;
  }
  return `${date} ${(time || "00:00") + ":00"}`;
}

function duration(a: string, b: string): string {
  const t1 = Date.parse(a.replace(" ", "T"));
  const t2 = Date.parse(b.replace(" ", "T"));
  if (!Number.isFinite(t1) || !Number.isFinite(t2) || t2 < t1) return "—";
  const min = Math.round((t2 - t1) / 60000);
  if (min < 1) return "不到 1 分钟";
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
}

/** "YYYY-MM-DD HH:mm:ss" → "HH:mm:ss" */
function clockOf(at: string): string | undefined {
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/.exec(at.trim());
  if (!m) return undefined;
  return `${m[1].padStart(2, "0")}:${m[2]}${m[3] ? `:${m[3]}` : ""}`;
}

/** 两个时间戳之间的秒数；跨夜靠完整日期比较，不会算成负数 */
function secondsBetween(a: string, b: string): number | null {
  const t1 = Date.parse(a.replace(" ", "T"));
  const t2 = Date.parse(b.replace(" ", "T"));
  if (!Number.isFinite(t1) || !Number.isFinite(t2) || t2 < t1) return null;
  return Math.round((t2 - t1) / 1000);
}
