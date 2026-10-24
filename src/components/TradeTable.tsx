import React, { useEffect, useMemo, useRef, useState } from "react";
import { Trade } from "../types";
import { fmtNum, fmtPct, money, toneClass } from "./ui";

type SortKey = "date" | "symbol" | "pnl" | "quantity" | "setup";

export function TradeTable(props: {
  trades: Trade[];
  cur: string;
  onOpen?: (t: Trade) => void;
  onDelete?: (t: Trade) => void | Promise<void>;
  /** 批量删除；不传则退化成逐条删 */
  onDeleteMany?: (ts: Trade[]) => Promise<void>;
  /** 批量设置策略（传空字符串表示清除） */
  onSetSetup?: (ts: Trade[], setup: string) => Promise<void>;
}) {
  const { trades, cur, onOpen, onDelete, onDeleteMany, onSetSetup } = props;
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "date", dir: -1 });
  const [limit, setLimit] = useState(60);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  // 删除改成「点两次」：第一次变成确认态，第二次才执行；不用原生 confirm
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [setupValue, setSetupValue] = useState("");
  const headBox = useRef<HTMLInputElement | null>(null);
  const canSelect = Boolean(onDeleteMany || onDelete || onSetSetup);

  const rows = useMemo(() => {
    const sorted = [...trades].sort((a, b) => {
      const k = sort.key;
      if (k === "date") {
        return (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")) * sort.dir;
      }
      if (k === "symbol" || k === "setup") {
        return a[k].localeCompare(b[k]) * sort.dir;
      }
      return (a[k] - b[k]) * sort.dir;
    });
    return sorted;
  }, [trades, sort]);

  const visible = rows.slice(0, limit);

  /* ---------- 多选 ---------- */
  const idSet = useMemo(() => new Set(trades.map((t) => t.id)), [trades]);

  // 列表变了（删除、刷新、换筛选）就把已经不存在的勾选清掉，避免删错对象
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const next = new Set([...prev].filter((id) => idSet.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [idSet]);

  const selectedRows = useMemo(() => rows.filter((t) => selected.has(t.id)), [rows, selected]);
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;

  // 表头勾选框的「半选」状态只能用 DOM 属性设置
  useEffect(() => {
    if (headBox.current) {
      headBox.current.indeterminate = selectedRows.length > 0 && !allSelected;
    }
  }, [selectedRows.length, allSelected]);

  const toggle = (id: string) => {
    setConfirmBulk(false);
    setConfirmId(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setConfirmBulk(false);
    setConfirmId(null);
    setSelected(allSelected ? new Set<string>() : new Set(rows.map((t) => t.id)));
  };

  const removeSelected = async () => {
    if (!selectedRows.length || busy) return;
    if (!confirmBulk) {
      setConfirmBulk(true);
      return;
    }
    setConfirmBulk(false);
    setBusy(true);
    try {
      if (onDeleteMany) await onDeleteMany(selectedRows);
      else if (onDelete) for (const t of selectedRows) await onDelete(t);
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  };

  /** 已有策略，供快速点选；按使用次数从多到少 */
  const setupOptions = useMemo(() => {
    const count = new Map<string, number>();
    for (const t of trades) {
      const s = (t.setup || "").trim();
      if (s) count.set(s, (count.get(s) ?? 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  }, [trades]);

  /** 给选中的笔记批量打策略；空字符串 = 清除 */
  const applySetup = async (value: string) => {
    if (!onSetSetup || !selectedRows.length || busy) return;
    setBusy(true);
    try {
      await onSetSetup(selectedRows, value.trim());
      setSetupOpen(false);
      setSetupValue("");
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  };

  const head = (key: SortKey, label: string, cls = "") => (
    <th
      className={`${cls} ${sort.key === key ? "is-sorted" : ""}`}
      onClick={() =>
        setSort((s) =>
          s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: -1 }
        )
      }
    >
      {label}
      {sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );

  if (!trades.length) {
    return <div className="tj-chart-empty">这个筛选条件下没有交易</div>;
  }

  return (
    <div className={`tj-table-wrap ${canSelect ? "has-bulk" : ""}`}>
      {canSelect && (
        <div className={`tj-bulk ${selectedRows.length ? "is-active" : ""}`}>
          <label className="tj-bulk-all">
            <input
              ref={headBox}
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              disabled={!rows.length}
            />
            <span>{allSelected ? "取消全选" : `全选 ${rows.length} 笔`}</span>
          </label>

          {selectedRows.length > 0 ? (
            <>
              <span className="tj-bulk-count">
                已选 <b>{selectedRows.length}</b> 笔 · 合计{" "}
                <span className={toneClass(selectedRows.reduce((a, b) => a + b.pnl, 0))}>
                  {money(
                    selectedRows.reduce((a, b) => a + b.pnl, 0),
                    cur
                  )}
                </span>
              </span>
              {onSetSetup && (
                <div className="tj-bulk-setup">
                  <button
                    type="button"
                    className="tj-btn"
                    onClick={() => setSetupOpen((v) => !v)}
                    disabled={busy}
                  >
                    设置策略 {setupOpen ? "▴" : "▾"}
                  </button>
                  {setupOpen && (
                    <div className="tj-bulk-pop">
                      <div className="tj-bulk-pop-head">
                        给这 {selectedRows.length} 笔笔记设置策略
                      </div>
                      {setupOptions.length > 0 && (
                        <div className="tj-bulk-chips">
                          {setupOptions.slice(0, 8).map((s) => (
                            <button
                              key={s}
                              type="button"
                              className="tj-chip"
                              onClick={() => void applySetup(s)}
                              disabled={busy}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="tj-bulk-pop-row">
                        <input
                          type="text"
                          value={setupValue}
                          placeholder="输入策略名，如 突破 / 回踩"
                          onChange={(e) => setSetupValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void applySetup(setupValue);
                            if (e.key === "Escape") setSetupOpen(false);
                          }}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="tj-btn primary"
                          onClick={() => void applySetup(setupValue)}
                          disabled={!setupValue.trim() || busy}
                        >
                          应用
                        </button>
                      </div>
                      <button
                        type="button"
                        className="tj-link tj-bulk-clear"
                        onClick={() => void applySetup("")}
                        disabled={busy}
                      >
                        清除这些笔记的策略
                      </button>
                    </div>
                  )}
                </div>
              )}
              <button
                type="button"
                className="tj-btn tj-btn-danger"
                onClick={() => void removeSelected()}
                disabled={busy}
              >
                {busy
                  ? "处理中…"
                  : confirmBulk
                    ? `再点一次确认删除 ${selectedRows.length} 笔`
                    : `删除所选 ${selectedRows.length} 笔`}
              </button>
              <button
                type="button"
                className="tj-link"
                onClick={() => {
                  setSelected(new Set());
                  setConfirmBulk(false);
                }}
              >
                取消选择
              </button>
            </>
          ) : (
            <span className="tj-bulk-hint">
              {onSetSetup
                ? "勾选左侧方框后可批量设置策略或删除（筛选结果可一次全选）"
                : "勾选左侧方框可批量删除（筛选结果可一次全选）"}
            </span>
          )}
        </div>
      )}

      <table className="tj-table">
        <thead>
          <tr>
            {canSelect && <th className="tj-check-col" />}
            {head("date", "日期")}
            {head("symbol", "标的")}
            <th>方向</th>
            {head("quantity", "数量", "tj-num")}
            <th className="tj-num">开仓</th>
            <th className="tj-num">平仓</th>
            <th className="tj-num">手续费</th>
            {head("pnl", "盈亏", "tj-num")}
            {head("setup", "策略")}
            <th>账户</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((t) => (
            <tr
              key={t.id}
              onDoubleClick={() => onOpen?.(t)}
              className={selected.has(t.id) ? "is-selected" : ""}
            >
              {canSelect && (
                <td className="tj-check-col">
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onChange={() => toggle(t.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`选择 ${t.date} ${t.symbol}`}
                  />
                </td>
              )}
              <td className="tj-nowrap">
                {t.date}
                {t.time && <span className="tj-muted"> {t.time}</span>}
              </td>
              <td className="tj-symbol">{t.symbol}</td>
              <td>
                <span className={`tj-dir ${t.direction}`}>
                  {t.direction === "long" ? "多" : "空"}
                </span>
              </td>
              <td className="tj-num">{fmtNum(t.quantity, t.quantity % 1 === 0 ? 0 : 3)}</td>
              <td className="tj-num">{fmtNum(t.entry)}</td>
              <td className="tj-num">{fmtNum(t.exit)}</td>
              <td className="tj-num tj-muted">{fmtNum(t.fees)}</td>
              <td className={`tj-num ${toneClass(t.pnl)}`}>{money(t.pnl, cur)}</td>
              <td>{t.setup || <span className="tj-muted">—</span>}</td>
              <td>{t.account || <span className="tj-muted">—</span>}</td>
              <td className="tj-actions">
                {onOpen && (
                  <button type="button" className="tj-link" onClick={() => onOpen(t)}>
                    打开
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    className="tj-link tj-danger"
                    onClick={() => {
                      if (confirmId === t.id) {
                        setConfirmId(null);
                        void onDelete(t);
                      } else {
                        setConfirmId(t.id);
                      }
                    }}
                  >
                    {confirmId === t.id ? "确认删除" : "删除"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="tj-table-foot">
        <span className="tj-muted">
          显示 {visible.length} / {rows.length} 笔
        </span>
        <span className={`tj-muted`}>
          合计 <span className={toneClass(rows.reduce((a, b) => a + b.pnl, 0))}>
            {money(rows.reduce((a, b) => a + b.pnl, 0), cur)}
          </span>
          {" · "}胜率{" "}
          {fmtPct(
            rows.filter((r) => r.pnl > 0).length /
              Math.max(1, rows.filter((r) => r.pnl !== 0).length)
          )}
        </span>
        {visible.length < rows.length && (
          <button type="button" className="tj-btn" onClick={() => setLimit((l) => l + 120)}>
            加载更多
          </button>
        )}
      </div>
    </div>
  );
}
