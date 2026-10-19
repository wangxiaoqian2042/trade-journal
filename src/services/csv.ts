import { Direction, TradeDraft } from "../types";

export type FieldKey =
  | "date"
  | "time"
  | "symbol"
  | "direction"
  | "quantity"
  | "entry"
  | "exit"
  | "pnl"
  | "fees"
  | "setup"
  | "account"
  | "stop"
  | "target"
  | "notes";

export const FIELD_LABELS: Record<FieldKey, string> = {
  date: "日期",
  time: "时间",
  symbol: "标的",
  direction: "方向",
  quantity: "数量",
  entry: "开仓价",
  exit: "平仓价",
  pnl: "盈亏",
  fees: "手续费",
  setup: "策略",
  account: "账户",
  stop: "止损",
  target: "止盈",
  notes: "备注",
};

const ALIASES: Record<FieldKey, string[]> = {
  date: ["date", "日期", "trade date", "trade_date", "entry date", "open date", "opened", "opened at", "openedat", "entered", "enteredat", "entered at", "exit date", "closed at", "close date", "close time", "date/time", "datetime", "time", "日期时间", "开仓时间", "平仓时间", "entry time", "open time", "exit time", "trade day", "trade_day", "tradeday"],
  time: ["time", "时间", "clock", "hour", "entry time", "开仓时间"],
  symbol: ["symbol", "ticker", "instrument", "contract", "market", "pair", "代码", "标的", "品种", "合约", "股票"],
  direction: ["direction", "side", "type", "action", "position", "long/short", "b/s", "方向", "多空", "买卖", "交易方向"],
  quantity: ["quantity", "qty", "size", "shares", "volume", "contracts", "lots", "units", "数量", "手数", "股数", "成交量"],
  entry: ["entry", "entry price", "entry_price", "open price", "open_price", "avg entry", "buy price", "price in", "开仓价", "买入价", "建仓价", "开仓均价"],
  exit: ["exit", "exit price", "exit_price", "close price", "close_price", "avg exit", "sell price", "price out", "平仓价", "卖出价", "出场价", "平仓均价"],
  pnl: ["pnl", "p&l", "p/l", "profit", "profit/loss", "net pnl", "net profit", "realized pnl", "realized p&l", "gross pnl", "gain", "盈亏", "净盈亏", "收益", "盈亏金额", "利润"],
  fees: ["fees", "fee", "commission", "commissions", "commission fee", "cost", "costs", "total fees", "手续费", "佣金", "费用"],
  setup: ["setup", "strategy", "playbook", "system", "pattern", "setup name", "策略", "战法", "玩法", "交易系统"],
  account: ["account", "acct", "account name", "portfolio", "account number", "账户", "账号", "子账户"],
  stop: ["stop", "stop loss", "stop_loss", "sl", "止损", "止损价"],
  target: ["target", "take profit", "take_profit", "tp", "止盈", "止盈价"],
  notes: ["notes", "note", "comment", "comments", "remarks", "memo", "description", "备注", "说明", "笔记"],
};

function normHeader(h: string): string {
  return h
    .replace(/^\uFEFF/, "")
    .trim()
    // 驼峰拆词：EnteredAt → Entered At，ExitPrice → Exit Price
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_\-.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 解析 CSV（自动识别分隔符，支持引号、换行、转义） */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const firstLine = clean.slice(0, clean.indexOf("\n") === -1 ? clean.length : clean.indexOf("\n"));
  const candidates = [",", ";", "\t", "|"];
  let delim = ",";
  let best = -1;
  for (const c of candidates) {
    const count = firstLine.split(c).length - 1;
    if (count > best) {
      best = count;
      delim = c;
    }
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export type ColumnMap = Partial<Record<FieldKey, number>>;

/** 根据表头自动推断列映射：先全局精确匹配，再对剩余字段做包含匹配 */
export function detectColumns(header: string[]): ColumnMap {
  const norm = header.map(normHeader);
  const compact = norm.map((h) => h.replace(/ /g, ""));
  const map: ColumnMap = {};
  const used = new Set<number>();
  const fields = Object.keys(ALIASES) as FieldKey[];

  const exactHit = (key: FieldKey, i: number): boolean =>
    ALIASES[key].some(
      (a) => norm[i] === a || compact[i] === a.replace(/ /g, "")
    );

  const fuzzyHit = (key: FieldKey, i: number): boolean => {
    const h = norm[i];
    const hc = compact[i];
    return ALIASES[key].some((a) => {
      if (a.length < 4) return false;
      const ac = a.replace(/ /g, "");
      if (h.includes(a) || (h.length >= 4 && a.includes(h))) return true;
      return hc.includes(ac) || (hc.length >= 4 && ac.includes(hc));
    });
  };

  // 第一轮：精确匹配（避免 "ExitPrice" 被日期列的 "ExitedAt" 抢走）
  for (const key of fields) {
    const idx = norm.findIndex((h, i) => !used.has(i) && h !== "" && exactHit(key, i));
    if (idx !== -1) {
      map[key] = idx;
      used.add(idx);
    }
  }

  // 第二轮：包含匹配（别名至少 4 个字符，防止 "tp"/"sl" 这类短词误伤）
  for (const key of fields) {
    if (map[key] !== undefined) continue;
    const idx = norm.findIndex((h, i) => !used.has(i) && h !== "" && fuzzyHit(key, i));
    if (idx !== -1) {
      map[key] = idx;
      used.add(idx);
    }
  }

  // date 与 time 若指向同一列，优先保留 date（datetime 里会拆出时间）
  if (map.date !== undefined && map.time === map.date) delete map.time;
  return map;
}

export function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  let v = raw.trim();
  if (!v || v === "-" || v.toLowerCase() === "n/a") return null;
  let negative = false;
  if (/^\(.*\)$/.test(v)) {
    negative = true;
    v = v.slice(1, -1);
  }
  v = v.replace(/[^\d.,\-]/g, "");
  // 千分位与欧洲小数逗号的处理
  if (/,\d{1,2}$/.test(v) && !/\./.test(v)) v = v.replace(",", ".");
  else v = v.replace(/,/g, "");
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

export function normalizeDirection(raw: string | undefined): Direction | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (/(long|buy|bought|^b$|^l$|做多|多|买入|买|看多)/.test(v)) return "long";
  if (/(short|sell|sold|^s$|做空|空|卖出|卖|看空)/.test(v)) return "short";
  return null;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** 归一化日期，返回 { date: YYYY-MM-DD, time: HH:mm } */
export function parseDate(raw: string | undefined): { date: string; time: string } {
  const empty = { date: "", time: "" };
  if (!raw) return empty;
  const v = raw.trim();
  if (!v) return empty;

  let time = "";
  const tm = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i.exec(v);
  if (tm) {
    let h = Number(tm[1]);
    const ampm = tm[4]?.toLowerCase();
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    time = `${String(h).padStart(2, "0")}:${tm[2]}`;
  }

  const iso = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(v);
  if (iso) return { date: buildDate(Number(iso[1]), Number(iso[2]), Number(iso[3])), time };

  const compactDay = /(^|\s)(\d{4})(\d{2})(\d{2})(\s|$)/.exec(v);
  if (compactDay) {
    return { date: buildDate(Number(compactDay[2]), Number(compactDay[3]), Number(compactDay[4])), time };
  }

  const us = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(v);
  if (us) {
    const a = Number(us[1]);
    const b = Number(us[2]);
    // 默认 MM/DD/YYYY；若首个数字 > 12 视为 DD/MM/YYYY
    const [m, d] = a > 12 ? [b, a] : [a, b];
    return { date: buildDate(Number(us[3]), m, d), time };
  }

  const mon = /([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})/.exec(v);
  if (mon && MONTHS[mon[1].toLowerCase()]) {
    return {
      date: buildDate(Number(mon[3]), Number(MONTHS[mon[1].toLowerCase()]), Number(mon[2])),
      time,
    };
  }

  // 认不出来就返回空，让调用方报错，而不是塞一个垃圾日期进去
  return { date: "", time };
}

function buildDate(y: number, m: number, d: number): string {
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return "";
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export interface BuildResult {
  drafts: TradeDraft[];
  errors: { row: number; message: string }[];
}

export function buildDrafts(
  rows: string[][],
  header: string[],
  map: ColumnMap,
  opts: { pnlIncludesFees?: boolean } = {}
): BuildResult {
  const drafts: TradeDraft[] = [];
  const errors: { row: number; message: string }[] = [];
  const get = (r: string[], key: FieldKey): string | undefined => {
    const idx = map[key];
    if (idx === undefined) return undefined;
    return r[idx];
  };

  rows.forEach((r, i) => {
    const line = i + 2; // 表头占第 1 行
    if (r.every((c) => !c || !c.trim())) return;

    const rawSymbol = get(r, "symbol");
    const symbol = (rawSymbol ?? "").trim();
    if (!symbol) {
      errors.push({
        row: line,
        message: map.symbol === undefined ? "没有映射「标的」列" : "标的为空",
      });
      return;
    }

    const rawDate = get(r, "date");
    const { date, time: dateTime } = parseDate(rawDate);
    const explicitTime = (get(r, "time") ?? "").trim();
    const time = dateTime || (/^\d{1,2}:\d{2}/.test(explicitTime) ? explicitTime.slice(0, 5) : "");
    const finalDate = date;
    if (!finalDate) {
      errors.push({
        row: line,
        message:
          map.date === undefined
            ? "没有映射「日期」列"
            : `日期无法识别：${(rawDate ?? "").slice(0, 24) || "（空）"}`,
      });
      return;
    }

    const direction = normalizeDirection(get(r, "direction")) ?? "long";
    const quantity = parseNumber(get(r, "quantity")) ?? 0;
    const entry = parseNumber(get(r, "entry")) ?? 0;
    const exit = parseNumber(get(r, "exit")) ?? 0;
    const fees = Math.abs(parseNumber(get(r, "fees")) ?? 0);
    const rawPnl = parseNumber(get(r, "pnl"));
    const gross = (exit - entry) * quantity * (direction === "long" ? 1 : -1);
    const pnl =
      rawPnl !== null
        ? opts.pnlIncludesFees
          ? rawPnl
          : rawPnl - fees
        : gross - fees;

    if (entry === 0 && exit === 0 && rawPnl === null) {
      errors.push({
        row: line,
        message:
          map.pnl === undefined && map.entry === undefined && map.exit === undefined
            ? "「盈亏」和「开仓价 / 平仓价」都没映射"
            : "这一行既没有价格也没有盈亏",
      });
      return;
    }

    drafts.push({
      date: finalDate,
      time,
      symbol,
      direction,
      entry,
      exit,
      quantity,
      fees,
      pnl,
      setup: (get(r, "setup") ?? "").trim(),
      account: (get(r, "account") ?? "").trim(),
      stop: parseNumber(get(r, "stop")),
      target: parseNumber(get(r, "target")),
      tags: ["trade"],
      notes: (get(r, "notes") ?? "").trim(),
    });
  });

  return { drafts, errors };
}
