import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  GRID_COLUMNS,
  MIN_H,
  MIN_W,
  ROW_HEIGHT,
  WidgetLayout,
  columnsForWidth,
  moveWidget,
  resizeWidget,
  spanFor,
} from "../services/layout";

export interface DragHandleProps {
  onPointerDown: (e: React.PointerEvent) => void;
  title: string;
  className: string;
}

interface DragState {
  id: string;
  pointerId: number;
}

interface ResizeState {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  w: number;
  h: number;
  colPx: number;
}

/**
 * 自研网格：CSS Grid 流式排布 + 表头拖拽换位 + 右下角拉伸。
 *
 * 为什么不用 react-grid-layout：
 * 1. 它是绝对定位 + 坐标碰撞，宽度变化时要自己算重排，Obsidian 侧边栏里很容易错位；
 * 2. 只为换位和拉伸两个动作引 100KB+ 不划算；
 * 3. 流式网格在窄屏天然降级，不需要额外写断点逻辑。
 */
export function DashboardGrid(props: {
  layout: WidgetLayout[];
  editable: boolean;
  onChange?: (next: WidgetLayout[]) => void;
  children: (id: string, drag: DragHandleProps) => React.ReactNode;
}) {
  const { layout, editable, onChange, children } = props;
  const [live, setLive] = useState<WidgetLayout[]>(layout);
  const [cols, setCols] = useState(GRID_COLUMNS);
  const [dragging, setDragging] = useState<string | null>(null);
  const [resizing, setResizing] = useState<string | null>(null);

  const gridRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;

  // 外部布局变化（重置、同步）时跟随
  useEffect(() => {
    setLive(layout);
  }, [layout]);

  // 容器宽度决定列数：侧边栏 4 列，主区域 12 列
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const apply = () => setCols(columnsForWidth(el.clientWidth));
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const colPx = useMemo(() => {
    const width = gridRef.current?.clientWidth ?? 0;
    return width > 0 ? width / cols : 80;
  }, [cols, live.length]);

  const startDrag = (id: string) => (e: React.PointerEvent) => {
    if (!editable) return;
    // 只认左键/触摸，避免右键菜单和滚轮误触
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { id, pointerId: e.pointerId };
    setDragging(id);
  };

  const startResize = (item: WidgetLayout) => (e: React.PointerEvent) => {
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    // 拉伸开始时现算列宽，避免首次渲染时容器宽度还是 0
    const width = gridRef.current?.clientWidth ?? 0;
    resizeRef.current = {
      id: item.id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      w: item.w,
      h: item.h,
      colPx: width > 0 ? width / cols : colPx || 80,
    };
    setResizing(item.id);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag) {
      const target = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest?.("[data-widget-id]") as HTMLElement | null;
      const targetId = target?.getAttribute("data-widget-id");
      if (targetId && targetId !== drag.id) {
        setLive((prev) => {
          const from = prev.findIndex((x) => x.id === drag.id);
          const to = prev.findIndex((x) => x.id === targetId);
          return moveWidget(prev, from, to);
        });
      }
      return;
    }

    const rs = resizeRef.current;
    if (rs) {
      const dx = e.clientX - rs.startX;
      const dy = e.clientY - rs.startY;
      // 当前列宽下的像素差 → 折算回 12 列基准
      const dw = Math.round((dx / rs.colPx) * (GRID_COLUMNS / cols));
      const dh = Math.round(dy / ROW_HEIGHT);
      setLive((prev) =>
        resizeWidget(prev, rs.id, Math.max(MIN_W, rs.w + dw), Math.max(MIN_H, rs.h + dh))
      );
    }
  };

  const finish = () => {
    const changed = Boolean(dragRef.current || resizeRef.current);
    dragRef.current = null;
    resizeRef.current = null;
    setDragging(null);
    setResizing(null);
    if (!changed) return;
    // 只是按了一下没真动，就别写盘了
    const next = liveRef.current;
    const same =
      next.length === layout.length &&
      next.every((x, i) => x.id === layout[i].id && x.w === layout[i].w && x.h === layout[i].h);
    if (!same) onChange?.(next);
  };

  return (
    <div
      ref={gridRef}
      className={`tj-grid ${editable ? "is-editable" : ""} ${dragging ? "is-dragging" : ""}`}
      style={{ ["--tj-cols" as string]: String(cols) }}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onPointerLeave={(e) => {
        // 指针离开容器且没有捕获时，视为取消
        if (!dragRef.current && !resizeRef.current) return;
        if (e.buttons === 0) finish();
      }}
    >
      {live.map((item) => {
        const span = spanFor(item.w, cols);
        const drag: DragHandleProps = {
          onPointerDown: startDrag(item.id),
          title: editable ? "按住拖动换位" : "",
          className: editable ? "tj-widget-handle" : "",
        };
        return (
          <div
            key={item.id}
            data-widget-id={item.id}
            className={`tj-widget ${dragging === item.id ? "is-being-dragged" : ""} ${
              resizing === item.id ? "is-being-resized" : ""
            }`}
            style={{
              gridColumn: `span ${span}`,
              minHeight: `${item.h * ROW_HEIGHT}px`,
            }}
          >
            {children(item.id, drag)}
            {editable && (
              <span
                className="tj-widget-resize"
                onPointerDown={startResize(item)}
                title="拖动改变大小"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
