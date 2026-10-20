/**
 * 仪表盘布局：widget 列表 + 各自占几列、多高。
 *
 * 刻意不用绝对定位的自由拖放，而是「流式网格 + 换位」：
 * 拖拽只改变数组顺序，位置由 CSS Grid 自动排；这样窄屏（侧边栏 340px）
 * 也不会出现卡片叠在一起或拖到画布外面。
 */

export interface WidgetLayout {
  id: string;
  /** 占几列（以 12 列为基准，窄屏按比例折算） */
  w: number;
  /** 高度档位，1 档 = 46px */
  h: number;
}

export const GRID_COLUMNS = 12;
export const ROW_HEIGHT = 46;

export const MIN_W = 3;
export const MAX_W = 12;
export const MIN_H = 3;
export const MAX_H = 12;

/** 默认布局：对齐截图里那套排布 */
export const DEFAULT_LAYOUT: WidgetLayout[] = [
  { id: "pnlChart", w: 7, h: 5 },
  { id: "calendar", w: 5, h: 7 },
  { id: "strategy", w: 6, h: 5 },
  { id: "drawdown", w: 6, h: 5 },
  { id: "ddList", w: 6, h: 5 },
  { id: "weekday", w: 6, h: 5 },
  { id: "symbolPerf", w: 6, h: 5 },
  { id: "recentTrades", w: 6, h: 6 },
  { id: "longShort", w: 6, h: 5 },
];

export const WIDGET_IDS = DEFAULT_LAYOUT.map((w) => w.id);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/**
 * 读取布局时做一次清洗：丢弃不认识的 id、补齐缺失的 widget、把尺寸夹到合法范围。
 * 用户手改 data.json 或老版本升级都靠它兜底，不允许把界面搞崩。
 */
export function normalizeLayout(input: unknown): WidgetLayout[] {
  const src = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const out: WidgetLayout[] = [];

  for (const raw of src) {
    if (!raw || typeof raw !== "object") continue;
    const id = (raw as WidgetLayout).id;
    if (typeof id !== "string" || !WIDGET_IDS.includes(id) || seen.has(id)) continue;
    const w = Number((raw as WidgetLayout).w);
    const h = Number((raw as WidgetLayout).h);
    const def = DEFAULT_LAYOUT.find((d) => d.id === id)!;
    seen.add(id);
    out.push({
      id,
      w: clamp(Number.isFinite(w) ? w : def.w, MIN_W, MAX_W),
      h: clamp(Number.isFinite(h) ? h : def.h, MIN_H, MAX_H),
    });
  }

  // 老配置里没有的 widget 补到末尾
  for (const def of DEFAULT_LAYOUT) {
    if (!seen.has(def.id)) out.push({ ...def });
  }
  return out;
}

/** 拖拽换位：把 from 挪到 to */
export function moveWidget(list: WidgetLayout[], from: number, to: number): WidgetLayout[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** 改某个 widget 的尺寸 */
export function resizeWidget(
  list: WidgetLayout[],
  id: string,
  w: number,
  h: number
): WidgetLayout[] {
  return list.map((x) =>
    x.id === id
      ? { ...x, w: clamp(w, MIN_W, MAX_W), h: clamp(h, MIN_H, MAX_H) }
      : x
  );
}

/** 容器宽度 → 实际列数：宽屏 12 列，侧边栏 4 列 */
export function columnsForWidth(width: number): number {
  if (width >= 980) return 12;
  if (width >= 720) return 8;
  if (width >= 460) return 6;
  return 4;
}

/** 把 12 列基准的宽度折算成当前列数下的跨度 */
export function spanFor(w: number, cols: number): number {
  const span = Math.round((w * cols) / GRID_COLUMNS);
  return Math.min(cols, Math.max(1, span));
}
