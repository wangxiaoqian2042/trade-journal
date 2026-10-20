import { Direction, Session, Trade } from "../types";
import { GapKind, hasGap } from "./quality";

export type { Session };

/**
 * 仪表盘的统一查询对象。
 *
 * 所有卡片、图表都从这里拿数据，不再各自过滤 —— 这样切一次时间档，
 * 全页每个数字都会同步变化，不会出现"卡片按本月算、图表按全部算"的错位。
 */

export type Preset =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "quarter"
  | "year"
  | "all"
  | "custom";

/** 闭区间，YYYY-MM-DD */
export interface DateRange {
  from: string;
  to: string;
}

export interface TradeFilters {
  /** 空数组或省略 = 全部 */
  symbols?: string[];
  setups?: string[];
  accounts?: string[];
  /** 空数组或省略 = 多空都算 */
  directions?: Direction[];
  /** 星期过滤：0=周日 … 6=周六；空数组或省略 = 全部 */
  weekdays?: number[];
  /** 数据体检：只保留同时缺这些字段的交易 */
  gaps?: GapKind[];
  /** 额外的手工日期边界，与时间档取交集（用于自定义区间） */
  from?: string;
  to?: string;
}

export interface DashboardQuery {
  preset: Preset;
  /** preset 为 custom 时生效 */
  customFrom?: string;
  customTo?: string;
  filters: TradeFilters;
}

export const PRESET_LABELS: Record<Preset, string> = {
  today: "今天",
  yesterday: "昨天",
  week: "本周",
  month: "本月",
  quarter: "本季度",
  year: "今年",
  all: "全部时间",
  custom: "自定义",
};

export function emptyQuery(preset: Preset = "all"): DashboardQuery {
  return { preset, filters: {} };
}

/* ---------- 日期工具：全部走本地时区，避免 toISOString 的 UTC 偏移 ---------- */

const pad = (n: number) => String(n).padStart(2, "0");

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISO(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function addDays(s: string, n: number): string {
  const d = parseISO(s);
  if (!d) return s;
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** 月末：下个月第 0 天 */
export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

export function daysBetween(range: DateRange): number {
  const a = parseISO(range.from);
  const b = parseISO(range.to);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

/* ---------- 时间档 → 区间 ---------- */

/**
 * 解析当前时间档对应的区间；「全部时间」返回 null。
 * @param today 便于测试注入固定日期
 */
export function resolveRange(q: DashboardQuery, today = toISO(new Date())): DateRange | null {
  const t = parseISO(today);
  if (!t) return null;

  switch (q.preset) {
    case "today":
      return { from: today, to: today };

    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }

    case "week": {
      // 周一为一周起点（国内习惯），周日收尾
      const dow = t.getDay(); // 0=周日
      const back = dow === 0 ? 6 : dow - 1;
      const from = addDays(today, -back);
      return { from, to: addDays(from, 6) };
    }

    case "month": {
      const from = new Date(t.getFullYear(), t.getMonth(), 1);
      const to = endOfMonth(t);
      return { from: toISO(from), to: toISO(to) };
    }

    case "quarter": {
      const q0 = Math.floor(t.getMonth() / 3) * 3;
      const from = new Date(t.getFullYear(), q0, 1);
      const to = new Date(t.getFullYear(), q0 + 3, 0);
      return { from: toISO(from), to: toISO(to) };
    }

    case "year": {
      const from = new Date(t.getFullYear(), 0, 1);
      const to = new Date(t.getFullYear(), 11, 31);
      return { from: toISO(from), to: toISO(to) };
    }

    case "custom": {
      const from = q.customFrom?.trim() || "";
      const to = q.customTo?.trim() || "";
      if (!parseISO(from) || !parseISO(to)) return null;
      return from <= to ? { from, to } : { from: to, to: from };
    }

    case "all":
    default:
      return null;
  }
}

/** 上一周期：按自然周期回看；无法比较（全部时间/自定义非法）返回 null */
export function prevRange(q: DashboardQuery, range: DateRange | null): DateRange | null {
  if (!range) return null;
  const from = parseISO(range.from);
  const to = parseISO(range.to);
  if (!from || !to) return null;

  switch (q.preset) {
    case "today":
    case "yesterday":
      return { from: addDays(range.from, -1), to: addDays(range.to, -1) };

    case "week":
      return { from: addDays(range.from, -7), to: addDays(range.to, -7) };

    case "month": {
      const prev = new Date(from.getFullYear(), from.getMonth() - 1, 1);
      return { from: toISO(prev), to: toISO(endOfMonth(prev)) };
    }

    case "quarter": {
      const prev = new Date(from.getFullYear(), from.getMonth() - 3, 1);
      const end = new Date(prev.getFullYear(), prev.getMonth() + 3, 0);
      return { from: toISO(prev), to: toISO(end) };
    }

    case "year":
      return { from: toISO(new Date(from.getFullYear() - 1, 0, 1)), to: toISO(new Date(from.getFullYear() - 1, 11, 31)) };

    case "custom": {
      const len = daysBetween(range);
      if (len <= 0) return null;
      return { from: addDays(range.from, -len), to: addDays(range.from, -1) };
    }

    default:
      return null;
  }
}

/** 给人看的区间描述 */
export function rangeLabel(q: DashboardQuery, range: DateRange | null): string {
  if (!range) return "全部时间";
  const f = parseISO(range.from);
  const t = parseISO(range.to);
  if (!f || !t) return `${range.from} → ${range.to}`;

  if (q.preset === "today") return `今天 · ${range.from}`;
  if (q.preset === "yesterday") return `昨天 · ${range.from}`;
  if (q.preset === "month") return `${f.getFullYear()} 年 ${f.getMonth() + 1} 月`;
  if (q.preset === "quarter") return `${f.getFullYear()} 年 Q${Math.floor(f.getMonth() / 3) + 1}`;
  if (q.preset === "year") return `${f.getFullYear()} 年`;
  if (q.preset === "week") return `${range.from} → ${range.to}`;
  return `${range.from} → ${range.to}`;
}

/* ---------- 过滤 ---------- */

function inList(list: string[] | undefined, value: string): boolean {
  if (!list || list.length === 0) return true;
  return list.includes(value);
}

/** 0=周日 … 6=周六；日期非法返回 -1 */
export function weekdayOf(date: string): number {
  const d = parseISO(date);
  return d ? d.getDay() : -1;
}

export function filterTrades(trades: Trade[], q: DashboardQuery, range?: DateRange | null): Trade[] {
  const r = range === undefined ? resolveRange(q) : range;
  const f = q.filters ?? {};

  // 时间档与手工日期取交集：都给了就取更窄的那一段
  const lo = r?.from && f.from ? (r.from > f.from ? r.from : f.from) : r?.from ?? f.from;
  const hi = r?.to && f.to ? (r.to < f.to ? r.to : f.to) : r?.to ?? f.to;

  return trades.filter((t) => {
    if (lo && t.date < lo) return false;
    if (hi && t.date > hi) return false;
    if (!inList(f.symbols, t.symbol)) return false;
    if (!inList(f.setups, t.setup)) return false;
    if (!inList(f.accounts, t.account)) return false;
    if (f.directions && f.directions.length && !f.directions.includes(t.direction)) return false;
    if (f.weekdays && f.weekdays.length && !f.weekdays.includes(weekdayOf(t.date))) return false;
    if (f.gaps && f.gaps.length && !f.gaps.every((g) => hasGap(t, g))) return false;
    return true;
  });
}

/** 当前查询是否附加了任何条件（用于显示"清除筛选"） */
export function hasActiveQuery(q: DashboardQuery): boolean {
  if (q.preset !== "all") return true;
  const f = q.filters ?? {};
  return Boolean(
    f.from ||
      f.to ||
      (f.symbols && f.symbols.length) ||
      (f.setups && f.setups.length) ||
      (f.accounts && f.accounts.length) ||
      (f.weekdays && f.weekdays.length) ||
      (f.gaps && f.gaps.length) ||
      (f.directions && f.directions.length)
  );
}

/* ---------- 下钻：图表点选 → 查询条件 ---------- */

/**
 * 下钻动作。图表里每一个可点的元素都对应这里的一种，
 * 统一由 applyDrill 翻译成查询条件，避免各处自己拼 filters 拼错。
 */
export type Drill =
  | { kind: "date"; date: string }
  | { kind: "symbol"; value: string }
  | { kind: "setup"; value: string }
  | { kind: "direction"; value: Direction }
  | { kind: "weekday"; value: number };

const WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 星期名（周一…）→ 0..6，认不出返回 -1 */
export function weekdayIndex(label: string): number {
  return WEEKDAY_NAMES.indexOf(label.trim());
}

export function drillLabel(d: Drill): string {
  switch (d.kind) {
    case "date":
      return d.date;
    case "symbol":
      return `标的 ${d.value}`;
    case "setup":
      return `策略 ${d.value}`;
    case "direction":
      return d.value === "long" ? "做多" : "做空";
    case "weekday":
      return WEEKDAY_NAMES[d.value] ?? "未知";
  }
}

/**
 * 把下钻动作套到当前查询上。
 * - 日期：切到自定义档，区间就是那一天（再点日历里别的日子会重新覆盖）
 * - 标的/策略/方向/星期：叠加维度过滤，不动时间档
 * 已有的其它条件保留，这样"先按标的筛，再点某天的"这种连续下钻是叠加而不是重置。
 */
export function applyDrill(q: DashboardQuery, d: Drill): DashboardQuery {
  // 下钻是一次新的"看这一块"，不应该还挂着上一次的体检条件
  const f: TradeFilters = { ...q.filters, gaps: undefined };
  switch (d.kind) {
    case "date":
      return {
        preset: "custom",
        customFrom: d.date,
        customTo: d.date,
        filters: { ...f, from: undefined, to: undefined },
      };
    case "symbol":
      return { ...q, filters: { ...f, symbols: [d.value] } };
    case "setup":
      return { ...q, filters: { ...f, setups: [d.value] } };
    case "direction":
      return { ...q, filters: { ...f, directions: [d.value] } };
    case "weekday":
      return { ...q, filters: { ...f, weekdays: [d.value] } };
  }
}

/* ---------- 交易时段 ---------- */

export const SESSION_LABELS: Record<Session, string> = {
  asia: "亚盘",
  europe: "欧盘",
  ny: "美盘",
  off: "其他",
};

/**
 * 按开仓时间（本地时间，GMT+8）推断交易时段。
 * 期货夜盘的活跃时段正好落在美盘，用它来做时段维度的分组。
 */
export function sessionOf(time: string | undefined): Session {
  const m = /^(\d{1,2}):(\d{2})/.exec((time ?? "").trim());
  if (!m) return "off";
  const h = Number(m[1]);
  if (Number.isNaN(h) || h < 0 || h > 23) return "off";
  if (h >= 6 && h < 15) return "asia";
  if (h >= 15 && h < 21) return "europe";
  if (h >= 21 || h < 6) return "ny";
  return "off";
}
