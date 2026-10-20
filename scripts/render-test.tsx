/**
 * 渲染冒烟测试：不开浏览器，直接把界面渲染成 HTML 字符串。
 * 能抓到运行时报错、hooks 顺序问题、关键区块缺失，比截图快且稳定。
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JournalApp } from "../src/components/JournalApp";
import { Dashboard } from "../src/components/Dashboard";
import { Overview } from "../src/components/Overview";
import { buildSnapshot } from "../src/services/aggregate";
import { DrawdownTable } from "../src/components/charts";
import { Trade } from "../src/types";

function makeTrades(n = 40): Trade[] {
  const out: Trade[] = [];
  const setups = ["Opening Range Breakout", "Range Reversal", "Failed Breakout", "Trend Pullback"];
  const symbols = ["MNQZ26", "MESZ26", "NQZ26"];
  for (let i = 0; i < n; i++) {
    const d = new Date(2026, 8, 17 + (i % 30));
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
    const win = i % 3 !== 0;
    const pnl = win ? 120 + i * 7 : -(60 + i * 5);
    out.push({
      id: `t${i}`,
      date,
      time: `21:${String(10 + (i % 45)).padStart(2, "0")}`,
      symbol: symbols[i % symbols.length],
      direction: i % 2 === 0 ? "short" : "long",
      entry: 30000 + i,
      exit: 30000 + i + (win ? 20 : -12),
      quantity: 6,
      fees: 4.32,
      pnl,
      setup: setups[i % setups.length],
      account: "AMP",
      stop: null,
      target: null,
      exitTime: `22:${String(10 + (i % 45)).padStart(2, "0")}:00`,
      holdSeconds: 1800 + i * 60,
      session: "ny",
      tags: ["trade"],
      notes: "",
    });
  }
  return out;
}

const trades = makeTrades();
const failures: string[] = [];

function expect(name: string, cond: boolean) {
  if (!cond) failures.push(name);
  console.log(`${cond ? "✓" : "✗"} ${name}`);
}

/* ---------- 1. 整页渲染 ---------- */
const html = renderToStaticMarkup(
  React.createElement(JournalApp, {
    trades,
    currency: "$",
    onImport: async () => ({ created: 0, skipped: 0 }),
  })
);

expect("整页渲染不抛错", html.length > 5000);
expect("有时间档胶囊（本月）", html.includes("本月"));
expect("默认选中全部时间", html.includes("tj-preset is-active") && html.includes("全部时间"));
expect("渲染出 6 张指标卡", (html.match(/tj-stat-label/g) || []).length === 6);
expect("图表区块：累计盈亏", html.includes("累计盈亏"));
expect("图表区块：每日盈亏月历", html.includes("每日盈亏") && html.includes("tj-cal-grid"));
expect("月历有周次列", html.includes("tj-cal-wn"));
expect("策略表现带度量切换", html.includes("策略表现") && html.includes("tj-bar-switch"));
expect("回撤区块", html.includes("回撤") && html.includes("tj-chart-svg"));
expect("最近交易表", html.includes("最近交易") && html.includes("tj-recent"));
expect("方向标签", html.includes("做空") && html.includes("做多"));
expect("货币符号生效", html.includes("$"));

/* ---------- 2. 环比：本月档应该有「较上月」 ---------- */
const monthSnap = buildSnapshot(trades, { preset: "month", filters: {} }, "2026-10-19");
const monthHtml = renderToStaticMarkup(
  React.createElement(Dashboard, {
    snapshot: monthSnap,
    cur: "$",
    allDays: monthSnap.days,
  })
);
expect("本月档出现环比文字", monthHtml.includes("较上月"), true);
expect("环比带三角标记", monthHtml.includes("▲") || monthHtml.includes("▼"));
expect("本月档标题显示月份", monthHtml.includes("2026 年 10 月"));

/* ---------- 3. 全部时间档不显示环比（没有可比周期） ---------- */
const allSnap = buildSnapshot(trades, { preset: "all", filters: {} }, "2026-10-19");
const allHtml = renderToStaticMarkup(
  React.createElement(Dashboard, { snapshot: allSnap, cur: "$", allDays: allSnap.days })
);
expect("全部时间不显示环比", !allHtml.includes("较上期") && !allHtml.includes("较上月"));
expect("全部时间仍显示指标", allHtml.includes("净盈亏"));

/* ---------- 4. 空数据不崩 ---------- */
const emptyHtml = renderToStaticMarkup(
  React.createElement(Dashboard, {
    snapshot: buildSnapshot([], { preset: "month", filters: {} }, "2026-10-19"),
    cur: "$",
    allDays: [],
  })
);
expect("空数据渲染不抛错", emptyHtml.includes("还没有交易数据"));

/* ---------- 5. 网格与拖拽把手 ---------- */
expect("渲染出网格容器", html.includes("tj-grid"));
expect("9 个 widget 全部上屏", (html.match(/data-widget-id/g) || []).length === 9);
expect("默认（只读）不显示把手", !html.includes("tj-widget-handle"));

const editableHtml = renderToStaticMarkup(
  React.createElement(Dashboard, {
    snapshot: monthSnap,
    cur: "$",
    allDays: monthSnap.days,
    onCardsChange: () => {},
    onLayoutChange: () => {},
  })
);
expect("可编辑时出现拖拽把手", editableHtml.includes("tj-widget-handle"));
expect("可编辑时出现拉伸柄", (editableHtml.match(/tj-widget-resize/g) || []).length === 9);
expect("可编辑时出现重置布局按钮", editableHtml.includes("重置布局"));
expect("网格列数变量已设置", editableHtml.includes("--tj-cols"));

/* ---------- 6. 下钻联动 ---------- */
// 不传 onDrill：日历格子不可点、图表没有 pointer 光标
expect("无 onDrill 时日历格子不可点", !monthHtml.includes("is-pickable"));
expect("无 onDrill 时图表不是可点样式", !monthHtml.includes("tj-chart-svg is-clickable"));

const drillHtml = renderToStaticMarkup(
  React.createElement(Dashboard, {
    snapshot: monthSnap,
    cur: "$",
    allDays: monthSnap.days,
    onDrill: () => {},
  })
);
expect("有 onDrill 时日历格子可点", drillHtml.includes("is-pickable"));
expect("有 onDrill 时标的表现可下钻", drillHtml.includes("按 MNQZ26 查看交易") || /按 .* 查看交易/.test(drillHtml));
expect("有 onDrill 时长空卡片可点", drillHtml.includes("tj-split-card is-clickable"));
expect("有 onDrill 时条形行可点", drillHtml.includes("tj-bar-row is-clickable"));

const openHtml = renderToStaticMarkup(
  React.createElement(Dashboard, {
    snapshot: monthSnap,
    cur: "$",
    allDays: monthSnap.days,
    onOpen: () => {},
  })
);
expect("有 onOpen 时图表可点跳转", openHtml.includes("tj-chart-svg is-clickable"));

/* ---------- 7. 交易记录批量删除 ---------- */
const tableHtml = renderToStaticMarkup(
  React.createElement(JournalApp, {
    trades,
    currency: "$",
    initialTab: "trades",
    onImport: async () => ({ created: 0, skipped: 0 }),
    onDelete: async () => {},
    onDeleteMany: async () => {},
  })
);
expect("筛选后能进批量模式", tableHtml.includes("tj-bulk"));
expect("每行都有勾选框", (tableHtml.match(/type="checkbox"/g) || []).length === trades.length + 1);
expect("全选按钮带笔数", tableHtml.includes(`全选 ${trades.length} 笔`));
expect("未选中时不出删除按钮", !tableHtml.includes("删除所选"));
expect("有勾选列", tableHtml.includes("tj-check-col"));
expect("交易记录页有数据体检条", tableHtml.includes("tj-quality") && tableHtml.includes("数据体检"));
expect("体检条列出缺止损", tableHtml.includes("缺止损"));
expect("体检条列出缺标签", tableHtml.includes("缺标签"));

const noDeleteHtml = renderToStaticMarkup(
  React.createElement(JournalApp, {
    trades,
    currency: "$",
    initialTab: "trades",
    onImport: async () => ({ created: 0, skipped: 0 }),
  })
);
expect("没有删除权限时不显示批量条", !noDeleteHtml.includes("tj-bulk"));

/* ---------- 8. 批量设置策略入口 ---------- */
const setupHtml = renderToStaticMarkup(
  React.createElement(JournalApp, {
    trades,
    currency: "$",
    initialTab: "trades",
    onImport: async () => ({ created: 0, skipped: 0 }),
    onSetSetup: async () => {},
  })
);
expect("有 onSetSetup 时提示可批量设置策略", setupHtml.includes("批量设置策略"));
expect("只有 onSetSetup 也能进批量模式", setupHtml.includes("tj-bulk"));
expect("未选中时不显示策略浮层", !setupHtml.includes("tj-bulk-pop"));
expect("无 onSetSetup 时不提设置策略", !tableHtml.includes("批量设置策略"));

/* ---------- 9. 月历跨月跳转 ---------- */
expect("跨月数据出现月份跳转条", allHtml.includes("tj-cal-months"));
expect("单月数据不显示跳转条", !monthHtml.includes("tj-cal-months"));


/* ---------- 10. 概要视图 ---------- */
const ovHtml = renderToStaticMarkup(
  React.createElement(Overview, { snapshot: allSnap, cur: "$" })
);
expect("概要视图渲染出 hero", ovHtml.includes("tj-hero"));
expect("概要有一句话总结", ovHtml.includes("个交易日") && ovHtml.includes("胜率"));
expect("概要显示结论清单", ovHtml.includes("tj-insights"));
expect("概要区分强项短板", ovHtml.includes("强项") && ovHtml.includes("短板"));
expect("概要说明 R 倍数缺数据", ovHtml.includes("R 倍数"));
expect("概要展示风险指标", ovHtml.includes("平均恢复") || ovHtml.includes("水下时间"));

const overviewTab = renderToStaticMarkup(
  React.createElement(JournalApp, {
    trades,
    currency: "$",
    initialTab: "overview",
    onImport: async () => ({ created: 0, skipped: 0 }),
  })
);
expect("速览页签可进入", overviewTab.includes("tj-overview"));
expect("速览页签出现在分段控件", overviewTab.includes("速览"));

/* ---------- 11. 回撤记录表 ---------- */
const ddHtml = renderToStaticMarkup(
  React.createElement(DrawdownTable, { trades, cur: "$" })
);
expect("回撤记录表渲染", ddHtml.includes("tj-ddtable"));
expect("回撤表有状态标签", ddHtml.includes("已收复") || ddHtml.includes("进行中"));
expect("回撤表显示段数", ddHtml.includes("段回撤"));

console.log(failures.length === 0 ? "\n渲染冒烟全部通过" : `\n${failures.length} 项失败: ${failures.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
