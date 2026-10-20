import React, { useEffect, useMemo, useState } from "react";
import { Direction, Trade, TradeDraft } from "../types";
import { dailyPnl, uniqueValues } from "../services/analytics";
import {
  DashboardQuery,
  Drill,
  PRESET_LABELS,
  Preset,
  addDays,
  applyDrill,
  drillLabel,
  emptyQuery,
  hasActiveQuery,
  filterTrades,
  toISO,
} from "../services/query";
import { buildSnapshot } from "../services/aggregate";
import { WidgetLayout } from "../services/layout";
import { Dashboard } from "./Dashboard";
import { Overview } from "./Overview";
import { TradeTable } from "./TradeTable";
import { ImportPanel } from "./ImportPanel";
import {
  CurrencyContext,
  Empty,
  Segmented,
  Select,
  money,
  toneClass,
} from "./ui";

export type Tab = "overview" | "dashboard" | "trades" | "import";

const PRESETS: Preset[] = [
  "today",
  "yesterday",
  "week",
  "month",
  "quarter",
  "year",
  "all",
  "custom",
];

export interface JournalAppProps {
  trades: Trade[];
  currency: string;
  initialTab?: Tab;
  /** 仅用于预览：预填一段 CSV 内容 */
  csvPrefill?: string;
  loading?: boolean;
  onImport: (drafts: TradeDraft[]) => Promise<{ created: number; skipped: number }>;
  onDelete?: (t: Trade) => Promise<void>;
  /** 批量删除（一次点击删多笔）；不传则退回逐条调用 onDelete */
  onDeleteMany?: (ts: Trade[]) => Promise<void>;
  /** 批量设置策略（空字符串 = 清除） */
  onSetSetup?: (ts: Trade[], setup: string) => Promise<void>;
  onOpen?: (t: Trade) => void;
  onReload?: () => void;
  /** 仪表盘显示哪些指标卡（来自插件设置） */
  cardIds?: string[];
  onCardsChange?: (ids: string[]) => void;
  /** 仪表盘组件布局 */
  layout?: WidgetLayout[];
  onLayoutChange?: (next: WidgetLayout[]) => void;
}

export function JournalApp(props: JournalAppProps) {
  const { trades, currency, loading } = props;
  const [tab, setTab] = useState<Tab>(props.initialTab ?? "dashboard");
  const [query, setQuery] = useState<DashboardQuery>(emptyQuery("all"));
  /** 从图表下钻过来时记一笔来源，好在列表上方提示"为什么只剩这几笔" */
  const [drillFrom, setDrillFrom] = useState<string | null>(null);

  // 命令面板“导入 CSV”等外部入口切换 tab
  useEffect(() => {
    if (props.initialTab) setTab(props.initialTab);
  }, [props.initialTab]);

  const symbols = useMemo(() => uniqueValues(trades, (t) => t.symbol), [trades]);
  const setups = useMemo(() => uniqueValues(trades, (t) => t.setup), [trades]);
  const accounts = useMemo(() => uniqueValues(trades, (t) => t.account), [trades]);

  // 唯一的数据入口：仪表盘和交易表格吃同一份快照，口径不会分叉
  const snapshot = useMemo(() => buildSnapshot(trades, query), [trades, query]);
  const filtered = snapshot.trades;
  const totalPnl = snapshot.base.s.netPnl;
  const allDays = useMemo(() => dailyPnl(trades), [trades]);

  const f = query.filters;
  const patch = (p: Partial<DashboardQuery["filters"]>) => {
    setDrillFrom(null);
    setQuery((q) => ({ ...q, filters: { ...q.filters, ...p } }));
  };

  /** 切时间档：同时清掉手工日期，避免两个区间互相打架 */
  const setPreset = (p: Preset) => {
    setDrillFrom(null);
    setQuery((q) => {
      if (p === "custom") {
        const end = toISO(new Date());
        return {
          ...q,
          preset: p,
          customFrom: q.customFrom ?? addDays(end, -29),
          customTo: q.customTo ?? end,
          filters: { ...q.filters, from: undefined, to: undefined },
        };
      }
      return {
        ...q,
        preset: p,
        customFrom: undefined,
        customTo: undefined,
        filters: { ...q.filters, from: undefined, to: undefined },
      };
    });
  };

  /** 手动改日期即进入自定义档 */
  const setCustomDate = (key: "customFrom" | "customTo", v: string) => {
    setDrillFrom(null);
    setQuery((q) => ({
      ...q,
      preset: "custom",
      customFrom: key === "customFrom" ? v || undefined : q.customFrom,
      customTo: key === "customTo" ? v || undefined : q.customTo,
      filters: { ...q.filters, from: undefined, to: undefined },
    }));
  };

  /**
   * 图表下钻：改成对应查询条件，并切到交易记录页。
   * 不额外存一份"下钻过滤"，因为同一份 query 既喂仪表盘又喂表格，
   * 这样点完日历再点回仪表盘，看到的也是同一天的数据，不会前后不一致。
   */
  const drill = (d: Drill) => {
    setQuery((q) => applyDrill(q, d));
    setDrillFrom(drillLabel(d));
    setTab("trades");
  };

  const clearAll = () => {
    setQuery(emptyQuery("all"));
    setDrillFrom(null);
  };

  const hasFilter = hasActiveQuery(query);

  const optAll = [{ value: "all", label: "全部" }];
  const oneOf = (v: string) => (v && v !== "all" ? [v] : []);

  return (
    <CurrencyContext.Provider value={currency}>
      <div className="tj-root">
        <header className="tj-header">
          <div className="tj-title">
            <h2>交易日志</h2>
            <div className="tj-title-meta">
              <span>{trades.length} 笔记录</span>
              <span className="tj-dot" />
              <span className={toneClass(totalPnl)}>
                当前筛选 {money(totalPnl, currency)}
              </span>
            </div>
          </div>

          <div className="tj-header-right">
            <Segmented<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: "overview", label: "速览" },
                { value: "dashboard", label: "仪表盘" },
                { value: "trades", label: "交易记录" },
                { value: "import", label: "导入" },
              ]}
            />
            {props.onReload && (
              <button
                type="button"
                className="tj-btn"
                onClick={props.onReload}
                disabled={loading}
                title="重新读取 vault 里的交易笔记"
              >
                {loading ? "读取中…" : "刷新"}
              </button>
            )}
          </div>
        </header>

        {tab !== "import" && trades.length > 0 && (
          <>
            <div className="tj-presets">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`tj-preset ${query.preset === p ? "is-active" : ""}`}
                  onClick={() => setPreset(p)}
                >
                  {PRESET_LABELS[p]}
                </button>
              ))}
              <span className="tj-preset-range">{snapshot.label}</span>
            </div>

            <div className="tj-filters">
              <label className="tj-field">
                <span>从</span>
                <input
                  type="date"
                  value={query.preset === "custom" ? query.customFrom ?? "" : ""}
                  onChange={(e) => setCustomDate("customFrom", e.target.value)}
                />
              </label>
              <label className="tj-field">
                <span>到</span>
                <input
                  type="date"
                  value={query.preset === "custom" ? query.customTo ?? "" : ""}
                  onChange={(e) => setCustomDate("customTo", e.target.value)}
                />
              </label>
            <Select
              label="标的"
              value={f.symbols?.[0] ?? "all"}
              onChange={(v) => patch({ symbols: oneOf(v) })}
              options={[...optAll, ...symbols.map((s) => ({ value: s, label: s }))]}
            />
            <Select
              label="策略"
              value={f.setups?.[0] ?? "all"}
              onChange={(v) => patch({ setups: oneOf(v) })}
              options={[
                ...optAll,
                ...setups.map((s) => ({ value: s, label: s })),
              ]}
            />
            {accounts.length > 1 && (
              <Select
                label="账户"
                value={f.accounts?.[0] ?? "all"}
                onChange={(v) => patch({ accounts: oneOf(v) })}
                options={[
                  ...optAll,
                  ...accounts.map((s) => ({ value: s, label: s })),
                ]}
              />
            )}
            <Select
              label="方向"
              value={f.directions?.[0] ?? "all"}
              onChange={(v) =>
                patch({ directions: v === "all" ? [] : [v as Direction] })
              }
              options={[
                { value: "all", label: "全部" },
                { value: "long", label: "做多" },
                { value: "short", label: "做空" },
              ]}
            />
            {hasFilter && (
              <button type="button" className="tj-link" onClick={clearAll}>
                清除筛选
              </button>
            )}
            </div>
          </>
        )}

        <div className="tj-body">
          {tab === "import" && (
            <ImportPanel
              existing={trades}
              cur={currency}
              initialCsv={props.csvPrefill}
              onImport={async (drafts) => {
                const r = await props.onImport(drafts);
                if (r.created > 0) props.onReload?.();
                return r;
              }}
            />
          )}

          {tab === "overview" &&
            (trades.length === 0 ? (
              <Empty>
                <p>还没有交易记录。</p>
                <button type="button" className="tj-btn primary" onClick={() => setTab("import")}>
                  导入 CSV
                </button>
              </Empty>
            ) : (
              <Overview snapshot={snapshot} cur={currency} />
            ))}

          {tab === "dashboard" &&
            (trades.length === 0 ? (
              <Empty>
                <p>还没有交易记录。</p>
                <button type="button" className="tj-btn primary" onClick={() => setTab("import")}>
                  导入 CSV
                </button>
              </Empty>
            ) : (
              <Dashboard
                snapshot={snapshot}
                cur={currency}
                allDays={allDays}
                onOpen={props.onOpen}
                onDrill={drill}
                cardIds={props.cardIds}
                onCardsChange={props.onCardsChange}
                layout={props.layout}
                onLayoutChange={props.onLayoutChange}
              />
            ))}

          {tab === "trades" &&
            (trades.length === 0 ? (
              <Empty>
                <p>还没有交易记录。</p>
                <button type="button" className="tj-btn primary" onClick={() => setTab("import")}>
                  导入 CSV
                </button>
              </Empty>
            ) : (
              <>
                {drillFrom && (
                  <div className="tj-drill-bar">
                    <span>
                      从图表下钻：<b>{drillFrom}</b> · 命中 {filtered.length} 笔
                    </span>
                    <button type="button" className="tj-link" onClick={clearAll}>
                      清除条件
                    </button>
                    <button type="button" className="tj-link" onClick={() => setTab("dashboard")}>
                      返回仪表盘
                    </button>
                  </div>
                )}
                <TradeTable
                  trades={filtered}
                  cur={currency}
                  onOpen={props.onOpen}
                  onDelete={
                    props.onDelete
                      ? async (t) => {
                          await props.onDelete?.(t);
                          props.onReload?.();
                        }
                      : undefined
                  }
                  onDeleteMany={
                    props.onDeleteMany
                      ? async (ts) => {
                          await props.onDeleteMany?.(ts);
                          props.onReload?.();
                        }
                      : props.onDelete
                        ? async (ts) => {
                            for (const t of ts) await props.onDelete?.(t);
                            props.onReload?.();
                          }
                        : undefined
                  }
                  onSetSetup={
                    props.onSetSetup
                      ? async (ts, setup) => {
                          await props.onSetSetup?.(ts, setup);
                          props.onReload?.();
                        }
                      : undefined
                  }
                />
              </>
            ))}
        </div>
      </div>
    </CurrencyContext.Provider>
  );
}

/** 供其它模块复用的过滤入口（交易表格等） */
export { filterTrades };
