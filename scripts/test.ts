/* 逻辑自测：CSV 解析 + 指标计算，构建成 CJS 后用 node 跑 */
import { parseCsv, detectColumns, buildDrafts, parseDate, parseNumber, normalizeDirection } from "../src/services/csv";
import {
  summarize,
  equityCurve,
  groupBy,
  byWeekday,
  dailyPnl,
  drawdownEpisodes,
  drawdownStats,
  classifyPnl,
} from "../src/services/analytics";
import { stringifyFrontmatter, parseFrontmatter } from "../src/services/frontmatter";
import { Trade, tradeKey } from "../src/types";
import { detectOrderExport, pairOrders, contractMultiplier } from "../src/services/pairing";
import {
  resolveRange,
  prevRange,
  filterTrades,
  hasActiveQuery,
  sessionOf,
  weekdayOf,
  weekdayIndex,
  applyDrill,
  drillLabel,
  emptyQuery,
  DashboardQuery,
} from "../src/services/query";
import { buildSnapshot } from "../src/services/aggregate";
import {
  DEFAULT_LAYOUT,
  columnsForWidth,
  moveWidget,
  normalizeLayout,
  resizeWidget,
  spanFor,
} from "../src/services/layout";
import { formatMetric, compareMetric, REGISTRY_BY_ID } from "../src/services/metrics";
import { buildInsights, headline, highlights } from "../src/services/insights";
import { auditTrades, hasGap } from "../src/services/quality";
import { accountFolder, noteFilePath } from "../src/services/paths";
import {
  accountFromInboxPath,
  decodeCsv,
  isInsideInbox,
  isWorkFolder,
  parseInboxCsv,
} from "../src/services/inbox";

let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (!cond) {
    failed++;
    console.log(`✗ ${name}`, extra ?? "");
  } else {
    console.log(`✓ ${name}`);
  }
}

/* ---- 解析基础 ---- */
ok("parseNumber $1,234.50", parseNumber("$1,234.50") === 1234.5, parseNumber("$1,234.50"));
ok("parseNumber (250.00)", parseNumber("(250.00)") === -250);
ok("parseNumber -1.5", parseNumber("-1.5") === -1.5);
ok("parseDate ISO", parseDate("2026-10-09 09:31:22").date === "2026-10-09");
ok("parseDate 取时间", parseDate("2026-10-09 09:31:22").time === "09:31");
ok("parseDate US", parseDate("10/09/2026").date === "2026-10-09", parseDate("10/09/2026"));
ok("parseDate DD/MM", parseDate("25/09/2026").date === "2026-09-25", parseDate("25/09/2026"));
ok("parseDate 紧凑", parseDate("20261009").date === "2026-10-09", parseDate("20261009"));
ok("parseDate 带点", parseDate("25.09.2026").date === "2026-09-25", parseDate("25.09.2026"));
ok("parseDate 拒绝垃圾", parseDate("MNQZ6").date === "", parseDate("MNQZ6"));
ok("parseDate 拒绝非法月", parseDate("2026-13-45").date === "", parseDate("2026-13-45"));
ok("direction 做多", normalizeDirection("做多") === "long");
ok("direction Sell", normalizeDirection("SELL") === "short");

/* ---- CSV ---- */
const enCsv = `Symbol,Side,Qty,Entry Price,Exit Price,Commission,Trade Date,Strategy
AAPL,Buy,100,228.40,231.10,1.20,2026-10-09,突破
TSLA,Sell,50,412.00,408.50,1.00,2026-10-09,反转
"BTC,USD",Buy,0.5,68000,69000,2.00,2026-10-10,回踩`;

const rows = parseCsv(enCsv);
ok("CSV 行数", rows.length === 4, rows.length);
ok("CSV 引号内逗号", rows[3][0] === "BTC,USD", rows[3][0]);

const header = rows[0];
const map = detectColumns(header);
ok("识别 symbol", map.symbol === 0, map);
ok("识别 side", map.direction === 1, map);
ok("识别 qty", map.quantity === 2, map);
ok("识别 entry", map.entry === 3, map);
ok("识别 exit", map.exit === 4, map);
ok("识别 fees", map.fees === 5, map);
ok("识别 date", map.date === 6, map);
ok("识别 setup", map.setup === 7, map);
ok("未误映射 pnl", map.pnl === undefined, map.pnl);

const built = buildDrafts(rows.slice(1), header, map);
ok("生成 3 笔", built.drafts.length === 3, built.errors);
ok("无错误", built.errors.length === 0, built.errors);
ok("多头盈亏", Math.abs(built.drafts[0].pnl - (2.7 * 100 - 1.2)) < 1e-6, built.drafts[0].pnl);
ok("空头盈亏", Math.abs(built.drafts[1].pnl - (3.5 * 50 - 1)) < 1e-6, built.drafts[1].pnl);
ok("方向识别 sell", built.drafts[1].direction === "short");

const zhCsv = `日期,标的,方向,数量,开仓价,平仓价,手续费,盈亏,策略,账户
2026-10-08,ES,多,1,5840.25,5846.50,2.5,600,突破,主账户`;
const zhRows = parseCsv(zhCsv);
const zhMap = detectColumns(zhRows[0]);
const zhBuilt = buildDrafts(zhRows.slice(1), zhRows[0], zhMap);
ok("中文表头识别", zhBuilt.drafts.length === 1, zhBuilt.errors);
ok("已有盈亏列直接用", zhBuilt.drafts[0].pnl === 600 - 2.5, zhBuilt.drafts[0].pnl);
ok("中文方向", zhBuilt.drafts[0].direction === "long");

const tabCsv = "date\tsymbol\tside\tqty\tentry\texit\n2026-10-07\tMNQ\tlong\t2\t20500\t20560";
const tRows = parseCsv(tabCsv);
ok("TSV 分隔符", tRows[0].length === 6, tRows[0]);

const badRows = parseCsv("symbol,entry,exit\n,100,110\nAAA,,,");
const badBuilt = buildDrafts(badRows.slice(1), badRows[0], detectColumns(badRows[0]));
ok("脏数据被拦截", badBuilt.drafts.length === 0 && badBuilt.errors.length === 2, badBuilt);

/* ---- 驼峰表头（Tradovate / Apex 这类导出）---- */
const tvHeader = "Id,ContractName,EnteredAt,ExitedAt,EntryPrice,ExitPrice,Fees,PnL,Size,Type,TradeDay,Commissions".split(",");
const tvMap = detectColumns(tvHeader);
ok("驼峰 日期=EnteredAt", tvMap.date === 2, tvMap);
ok("驼峰 开仓=EntryPrice", tvMap.entry === 4, tvMap);
ok("驼峰 平仓=ExitPrice", tvMap.exit === 5, tvMap);
ok("驼峰 盈亏=PnL", tvMap.pnl === 7, tvMap);
ok("驼峰 数量=Size", tvMap.quantity === 8, tvMap);
ok("驼峰 方向=Type", tvMap.direction === 9, tvMap);
ok("驼峰 标的=ContractName", tvMap.symbol === 1, tvMap);
ok("驼峰 不误判止盈", tvMap.target === undefined, tvMap.target);
ok("驼峰 两段手续费分开认", tvMap.fees === 6 && tvMap.fees2 === 11, `${tvMap.fees},${tvMap.fees2}`);
ok("驼峰 平仓时间=ExitedAt", tvMap.exitTime === 3, tvMap.exitTime);

// 带 Commissions 列时两段手续费相加：1.44 + 1.00
const tvFull = parseCsv(
  "Id,ContractName,EnteredAt,ExitedAt,EntryPrice,ExitPrice,Fees,PnL,Size,Type,TradeDay,Commissions\n1,MNQZ6,09/21/2026 21:34:02 +08:00,09/21/2026 21:34:33 +08:00,30225.5,30238.75,1.44,-53,2,Short,09/21/2026,1.00"
);
const tvFullBuilt = buildDrafts(tvFull.slice(1), tvFull[0], detectColumns(tvFull[0]));
ok("两段手续费相加 2.44", Math.abs((tvFullBuilt.drafts[0]?.fees ?? 0) - 2.44) < 1e-9, tvFullBuilt.drafts[0]?.fees);
ok("净盈亏 = 毛 - 两段手续费", Math.abs((tvFullBuilt.drafts[0]?.pnl ?? 0) + 55.44) < 1e-9, tvFullBuilt.drafts[0]?.pnl);

const tvRows = parseCsv(
  "Id,ContractName,EnteredAt,ExitedAt,EntryPrice,ExitPrice,Fees,PnL,Size,Type\n1,MNQZ6,09/21/2026 21:34:02 +08:00,09/21/2026 21:34:33 +08:00,30225.5,30238.75,1.44,-53,2,Short"
);
const tvBuilt = buildDrafts(tvRows.slice(1), tvRows[0], tvMap);
ok("驼峰数据可导入", tvBuilt.drafts.length === 1, tvBuilt.errors);
ok("驼峰时间解析", tvBuilt.drafts[0]?.time === "21:34", tvBuilt.drafts[0]?.time);
ok("驼峰平仓时刻保留秒", tvBuilt.drafts[0]?.exitTime === "21:34:33", tvBuilt.drafts[0]?.exitTime);
ok("驼峰盈亏扣费", tvBuilt.drafts[0]?.pnl === -54.44, tvBuilt.drafts[0]?.pnl);

const tvBuilt2 = buildDrafts(tvRows.slice(1), tvRows[0], tvMap, { pnlIncludesFees: true });
ok("可选不再扣手续费", tvBuilt2.drafts[0]?.pnl === -53, tvBuilt2.drafts[0]?.pnl);

/* ---- frontmatter 往返 ---- */
const fm = stringifyFrontmatter(
  { type: "trade", date: "2026-10-09", symbol: "AAPL", entry: 228.4, pnl: -12.5, setup: "突破", tags: ["trade", "a b"] },
  "# 复盘\n今天手快。"
);
const back = parseFrontmatter(fm);
ok("frontmatter symbol", back.data.symbol === "AAPL");
ok("frontmatter 数字", back.data.entry === 228.4);
ok("frontmatter 负数", back.data.pnl === -12.5);
ok("frontmatter 数组", Array.isArray(back.data.tags) && (back.data.tags as string[]).length === 2, back.data.tags);
ok("frontmatter 正文", back.body.includes("今天手快"), back.body);

/* ---- 指标 ---- */
const mk = (pnl: number, date: string, extra: Partial<Trade> = {}): Trade => ({
  id: "x" + Math.random(),
  date,
  time: "09:30",
  symbol: "AAPL",
  direction: "long",
  entry: 100,
  exit: 100 + pnl,
  quantity: 1,
  fees: 0,
  pnl,
  setup: "突破",
  account: "主账户",
  stop: null,
  target: null,
  tags: [],
  notes: "",
  ...extra,
});

const sample: Trade[] = [
  mk(100, "2026-10-01"),
  mk(-50, "2026-10-02"),
  mk(-80, "2026-10-03"),
  mk(200, "2026-10-06"),
  mk(0, "2026-10-07"),
];
const s = summarize(sample);
ok("总盈亏", s.netPnl === 170, s.netPnl);
ok("胜率 2/4", Math.abs(s.winRate - 0.5) < 1e-9, s.winRate);
ok("盈亏比", Math.abs(s.profitFactor - 300 / 130) < 1e-9, s.profitFactor);
ok("最大回撤", s.maxDrawdown === 130, s.maxDrawdown);
ok("连胜连亏", s.maxWinStreak === 1 && s.maxLossStreak === 2, [s.maxWinStreak, s.maxLossStreak]);
ok("权益曲线末值", equityCurve(sample).at(-1)!.equity === 170);
ok("按策略分组", groupBy(sample, (t) => t.setup)[0].count === 5);
ok("星期分组有 5 项", byWeekday(sample).length <= 5, byWeekday(sample).map((w) => w.key));
ok("日盈亏聚合", dailyPnl(sample).length === 5);

/* ---------- 订单历史 → 回合配对 ---------- */
ok("MNQ 每点 2", contractMultiplier("F.US.MNQZ26") === 2, contractMultiplier("F.US.MNQZ26"));
ok("MES 每点 5", contractMultiplier("MESZ26") === 5);
ok("股票认不出", contractMultiplier("AAPL") === null);

const ordHead = ["商品代码", "买/卖", "类型", "数量", "填充数量", "平均成交价", "手续费", "下单时间", "状态", "状态时间"];
const ordDet = detectOrderExport(ordHead)!;
ok("识别委托级导出", ordDet !== null);
ok("时间列取状态时间", ordHead[ordDet.map.time!] === "状态时间", ordHead[ordDet.map.time!]);
ok("成交价取平均成交价", ordHead[ordDet.map.price!] === "平均成交价");

const ordRows = [
  // 空头：先卖后买，盈利 20 点
  ["F.US.MNQZ26", "卖出", "市价", "2", "2", "100", "", "2026-10-01 09:30:00", "已成交", "2026-10-01 09:30:00"],
  ["F.US.MNQZ26", "买入", "止损", "2", "2", "80.5", "", "2026-10-01 09:30:10", "已成交", "2026-10-01 09:45:00"],
  // 多头：先买后卖，亏 10 点
  ["F.US.MNQZ26", "买入", "市价", "1", "1", "100", "", "2026-10-02 10:00:00", "已成交", "2026-10-02 10:00:01"],
  ["F.US.MNQZ26", "卖出", "市价", "1", "1", "90", "", "2026-10-02 10:05:00", "已成交", "2026-10-02 10:05:00"],
  // 故意排在后面的取消单
  ["F.US.MNQZ26", "买入", "限价", "5", "0", "", "", "2026-10-02 10:06:00", "已取消", "2026-10-02 10:07:00"],
];
const pr = pairOrders(ordRows, ordDet, { feePerContract: 0.5 });
ok("配对出 2 个回合", pr.drafts.length === 2, pr.drafts.length);
ok("跳过取消单", pr.meta.dead === 1, pr.meta.dead);
const shortTrip = pr.drafts[0];
ok("第一笔是空单", shortTrip.direction === "short", shortTrip.direction);
ok("空单毛盈亏 19.5点×2手×$2 = 78", Math.abs(shortTrip.pnl + shortTrip.fees - 78) < 1e-6, shortTrip.pnl);
ok("空单手续费 2 手 × 单边 × 2", Math.abs(shortTrip.fees - 2) < 1e-6, shortTrip.fees);
const longTrip = pr.drafts[1];
ok("第二笔是多单", longTrip.direction === "long", longTrip.direction);
ok("多单毛盈亏 -20", Math.abs(longTrip.pnl + longTrip.fees + 20) < 1e-6, longTrip.pnl);
ok("配对备注带持有时间", longTrip.notes.includes("持有"), longTrip.notes);
ok("没有未平仓", pr.meta.open.length === 0, pr.meta.open);

// 同一秒内多笔成交也要按秒排序，不能靠行号
const tieRows = [
  ["F.US.MESZ26", "买入", "市价", "1", "1", "100", "", "2026-10-03 09:00:00", "已成交", "2026-10-03 09:00:00"],
  ["F.US.MESZ26", "卖出", "市价", "1", "1", "110", "", "2026-10-03 09:00:00", "已成交", "2026-10-03 09:59:59"],
];
const tie = pairOrders(tieRows, ordDet, {});
ok("按秒排序后是盈利", tie.drafts[0].pnl > 0, tie.drafts[0].pnl);
ok("持有近 1 小时", /59 分钟|1 小时/.test(tie.drafts[0].notes), tie.drafts[0].notes);

// 开平仓不成对时给出未平仓提示，而不是硬凑
const openRows = [
  ["F.US.MNQZ26", "买入", "市价", "1", "1", "100", "", "2026-10-04 09:00:00", "已成交", "2026-10-04 09:00:00"],
];
const op = pairOrders(openRows, ordDet, {});
ok("未平仓不生成交易", op.drafts.length === 0 && op.meta.open.length === 1, op.meta.open);

/* ================= P0：查询 / 指标 / 环比 ================= */

const T = "2026-10-19"; // 周一
const q = (preset: any, extra: any = {}) => ({ preset, filters: {}, ...extra });

ok("今天", JSON.stringify(resolveRange(q("today"), T)) === JSON.stringify({ from: T, to: T }), resolveRange(q("today"), T));
ok("昨天", resolveRange(q("yesterday"), T)!.from === "2026-10-18");
ok("本周从周一开始", resolveRange(q("week"), T)!.from === "2026-10-19", resolveRange(q("week"), T));
ok("本周到周日结束", resolveRange(q("week"), T)!.to === "2026-10-25");
ok("周日属于上一起点的那一周", resolveRange(q("week"), "2026-10-25")!.from === "2026-10-19", resolveRange(q("week"), "2026-10-25"));
ok("本月", JSON.stringify(resolveRange(q("month"), T)) === JSON.stringify({ from: "2026-10-01", to: "2026-10-31" }));
ok("本季度 Q4", JSON.stringify(resolveRange(q("quarter"), T)) === JSON.stringify({ from: "2026-10-01", to: "2026-12-31" }));
ok("今年", JSON.stringify(resolveRange(q("year"), T)) === JSON.stringify({ from: "2026-01-01", to: "2026-12-31" }));
ok("全部时间为 null", resolveRange(q("all"), T) === null);
ok("自定义区间", JSON.stringify(resolveRange(q("custom", { customFrom: "2026-09-01", customTo: "2026-09-30" }), T)) === JSON.stringify({ from: "2026-09-01", to: "2026-09-30" }));
ok("自定义区间颠倒会纠正", resolveRange(q("custom", { customFrom: "2026-09-30", customTo: "2026-09-01" }), T)!.from === "2026-09-01");
ok("自定义区间不完整返回 null", resolveRange(q("custom", { customFrom: "2026-09-01" }), T) === null);

ok("上月", JSON.stringify(prevRange(q("month"), resolveRange(q("month"), T))) === JSON.stringify({ from: "2026-09-01", to: "2026-09-30" }), prevRange(q("month"), resolveRange(q("month"), T)));
ok("上季度", JSON.stringify(prevRange(q("quarter"), resolveRange(q("quarter"), T))) === JSON.stringify({ from: "2026-07-01", to: "2026-09-30" }));
ok("上周", JSON.stringify(prevRange(q("week"), resolveRange(q("week"), T))) === JSON.stringify({ from: "2026-10-12", to: "2026-10-18" }));
ok("全部时间没有上期", prevRange(q("all"), null) === null);
ok("二月长度不串月", JSON.stringify(resolveRange(q("month"), "2026-03-15")) === JSON.stringify({ from: "2026-03-01", to: "2026-03-31" }));

/* ---- 过滤：时间档与手工日期取交集 ---- */
const mkTrade = (date: string, pnl: number, symbol = "MNQ", direction: "long" | "short" = "long", hold?: number): Trade => ({
  id: date + pnl,
  date,
  time: "21:55",
  symbol,
  direction,
  entry: 100,
  exit: 100 + pnl / 2,
  quantity: 1,
  fees: 0,
  pnl,
  setup: "ORB",
  account: "AMP",
  stop: null,
  target: null,
  holdSeconds: hold ?? null,
  tags: [],
  notes: "",
});

const universe: Trade[] = [
  mkTrade("2026-09-10", 100),
  mkTrade("2026-10-01", 200),
  mkTrade("2026-10-02", -50),
  mkTrade("2026-10-19", 300),
  mkTrade("2026-10-20", -80, "MES", "short"),
];

ok("本月筛出 4 笔（9 月那笔被排除）", filterTrades(universe, q("month"), resolveRange(q("month"), T)).length === 4, filterTrades(universe, q("month"), resolveRange(q("month"), T)).length);
ok("时间档与手工日期取交集", filterTrades(universe, { preset: "month", filters: { from: "2026-10-02" } }, resolveRange(q("month"), T)).length === 3);
ok("方向筛选", filterTrades(universe, { preset: "all", filters: { directions: ["short"] } }, null).length === 1);
ok("标的筛选", filterTrades(universe, { preset: "all", filters: { symbols: ["MES"] } }, null).length === 1);
ok("全部时间只受筛选影响", filterTrades(universe, { preset: "all", filters: {} }, null).length === 5);
ok("hasActiveQuery 认识日期", hasActiveQuery({ preset: "all", filters: { from: "2026-10-01" } }) === true);

/* ---- 指标 ---- */
const snap = buildSnapshot(universe, q("month"), T);
ok("快照笔数", snap.trades.length === 4, snap.trades.length);
ok("快照净盈亏 370", Math.abs((snap.metrics.netPnL.value ?? 0) - 370) < 1e-9, snap.metrics.netPnL.value);
ok("快照上期净盈亏 100", Math.abs((snap.metrics.netPnL.prev ?? 0) - 100) < 1e-9, snap.metrics.netPnL.prev);
ok("环比文字带正号", snap.metrics.netPnL.deltaText.startsWith("+"), snap.metrics.netPnL.deltaText);
ok("环比方向为 up", snap.metrics.netPnL.tone === "up");
ok("交易数指标", snap.metrics.numTrades.value === 4);
ok("胜率 2/4", Math.abs((snap.metrics.winRate.value ?? 0) - 0.5) < 1e-9, snap.metrics.winRate.value);
ok("盈亏比 500/130", Math.abs((snap.metrics.profitFactor.value ?? 0) - 500 / 130) < 1e-9, snap.metrics.profitFactor.value);
ok("最大回撤展示为负数 -80", Math.abs((snap.metrics.maxDrawdown.value ?? 0) + 80) < 1e-9, snap.metrics.maxDrawdown.value);
ok("最差单日 -80", snap.metrics.worstDay.value === -80);
ok("手续费指标存在", snap.metrics.feesTotal.value === 0);

const noLoss = buildSnapshot([mkTrade("2026-10-02", 100)], q("month"), T);
ok("没有亏损笔时盈亏比为 null", noLoss.metrics.profitFactor.value === null, noLoss.metrics.profitFactor.value);
ok("没有亏损笔时平均盈亏比为 null", noLoss.metrics.avgRR.value === null);
ok("空区间不报错", buildSnapshot([], q("month"), T).metrics.netPnL.value === 0);

const holdSnap = buildSnapshot([mkTrade("2026-10-02", 100, "MNQ", "long", 5400), mkTrade("2026-10-03", 50, "MNQ", "long", 1800), mkTrade("2026-10-04", 10)], q("month"), T);
ok("平均持仓 3600 秒", holdSnap.metrics.avgHoldTime.value === 3600, holdSnap.metrics.avgHoldTime.value);
ok("持仓格式化为小时", formatMetric(3600, "duration") === "1.0 小时", formatMetric(3600, "duration"));
const holdDef = REGISTRY_BY_ID.get("avgHoldTime")!;
ok("缺平仓时间时给出覆盖率提示", holdDef.hint!(holdSnap.base).includes("2/3"), holdDef.hint!(holdSnap.base));

ok("环比下降", compareMetric(1, 2, "num").tone === "down");
ok("环比无法比较给横线", compareMetric(null, 2, "num").text === "—");
ok("金额格式化保留两位", formatMetric(1234.5, "money", "$") === "$1,234.50", formatMetric(1234.5, "money", "$"));
ok("负数金额带减号", formatMetric(-12, "money", "$") === "-$12.00", formatMetric(-12, "money", "$"));

/* ---- 时段 ---- */
ok("21:55 是美盘", sessionOf("21:55") === "ny", sessionOf("21:55"));
ok("03:00 仍是美盘", sessionOf("03:00") === "ny");
ok("09:30 是亚盘", sessionOf("09:30") === "asia");
ok("17:00 是欧盘", sessionOf("17:00") === "europe");
ok("空时间归其他", sessionOf("") === "off");

/* ---- 配对补字段 ---- */
ok("配对写平仓时间", pr.drafts[0].exitTime === "09:45:00", pr.drafts[0].exitTime);
ok("配对写持有秒数", pr.drafts[0].holdSeconds === 900, pr.drafts[0].holdSeconds);
ok("同秒成交按秒算持有时长", tie.drafts[0].holdSeconds === 3599, tie.drafts[0].holdSeconds);


/* ================= 网格布局 ================= */
const defLayout = normalizeLayout(undefined);
ok("缺配置时用默认布局", defLayout.length === DEFAULT_LAYOUT.length && defLayout[0].id === "pnlChart");
ok("默认布局顺序完整", defLayout.map((x) => x.id).join(",") === DEFAULT_LAYOUT.map((x) => x.id).join(","));

const dirty = normalizeLayout([
  { id: "drawdown", w: 99, h: 0 },
  { id: "not-a-widget", w: 4, h: 4 },
  { id: "drawdown", w: 6, h: 4 },
  { id: "calendar", w: "7", h: "5" },
]);
ok("未知组件被丢弃", !dirty.some((x) => x.id === "not-a-widget"));
ok("重复组件只留一个", dirty.filter((x) => x.id === "drawdown").length === 1, dirty.length);
ok("超范围尺寸被夹紧", dirty.find((x) => x.id === "drawdown")!.w === 12 && dirty.find((x) => x.id === "drawdown")!.h === 3, dirty[0]);
ok("字符串尺寸能转数字", dirty.find((x) => x.id === "calendar")!.w === 7);
ok("缺失组件自动补齐", dirty.length === DEFAULT_LAYOUT.length, dirty.length);
ok("补齐的排在最后", dirty[dirty.length - 1].id === DEFAULT_LAYOUT[DEFAULT_LAYOUT.length - 1].id, dirty[dirty.length - 1].id);

const moved = moveWidget(normalizeLayout(undefined), 0, 2);
ok("换位：第一个挪到第三", moved[2].id === "pnlChart" && moved[0].id === "calendar", moved.map((x) => x.id).join(","));
ok("换位：数量不变", moved.length === DEFAULT_LAYOUT.length);
ok("越界换位原样返回", moveWidget(defLayout, 0, 99) === defLayout);

const resized = resizeWidget(defLayout, "pnlChart", 2, 99);
ok("拉伸宽度有下限", resized.find((x) => x.id === "pnlChart")!.w === 3);
ok("拉伸高度有上限", resized.find((x) => x.id === "pnlChart")!.h === 12);
ok("拉伸不影响其它组件", resized.find((x) => x.id === "calendar")!.w === 5);

ok("侧边栏宽度用 4 列", columnsForWidth(340) === 4);
ok("中等宽度 8 列", columnsForWidth(800) === 8);
ok("主区域 12 列", columnsForWidth(1200) === 12);
ok("12 列下 w=7 就是 7", spanFor(7, 12) === 7);
ok("4 列下 w=7 折成 2", spanFor(7, 4) === 2);
ok("跨度不会小于 1", spanFor(1, 4) >= 1);

/* ---- 下钻联动 ---- */
// 2026-10-16 是周五，2026-10-17 是周六
ok("weekdayOf 周五=5", weekdayOf("2026-10-16") === 5, weekdayOf("2026-10-16"));
ok("weekdayOf 周六=6", weekdayOf("2026-10-17") === 6);
ok("weekdayOf 非法日期=-1", weekdayOf("2026-13-45") === -1 || weekdayOf("乱码") === -1);
ok("weekdayIndex 周一=1", weekdayIndex("周一") === 1);
ok("weekdayIndex 周日=0", weekdayIndex("周日") === 0);
ok("weekdayIndex 认不出的=-1", weekdayIndex("周八") === -1);

const wkBase = [
  mkTrade("2026-10-12", 100), // 周一
  mkTrade("2026-10-16", -50), // 周五
  mkTrade("2026-10-17", 30), // 周六
];
const wkQ: DashboardQuery = { preset: "all", filters: { weekdays: [5] } };
const wkHits = filterTrades(wkBase, wkQ);
ok("按星期过滤只留周五", wkHits.length === 1 && wkHits[0].date === "2026-10-16", wkHits.length);
ok("星期过滤后算出正确盈亏", wkHits[0].pnl === -50);
ok("空星期数组等于不过滤", filterTrades(wkBase, { preset: "all", filters: { weekdays: [] } }).length === 3);
ok("星期过滤算作有效筛选", hasActiveQuery(wkQ) === true);

const dDate = applyDrill(emptyQuery("all"), { kind: "date", date: "2026-10-16" });
ok("点日历 → 切自定义档", dDate.preset === "custom", dDate.preset);
ok("点日历 → 区间就是那一天", dDate.customFrom === "2026-10-16" && dDate.customTo === "2026-10-16");
ok(
  "点日历 → 解析出的区间正确",
  JSON.stringify(resolveRange(dDate, "2026-10-20")) === JSON.stringify({ from: "2026-10-16", to: "2026-10-16" }),
  resolveRange(dDate, "2026-10-20")
);
ok("点日历 → 前一天=上一天", prevRange(dDate, resolveRange(dDate))?.from === "2026-10-15");

const dSym = applyDrill({ preset: "month", filters: {} }, { kind: "symbol", value: "MNQ" });
ok("点标的 → 只加维度不加时间档", dSym.preset === "month" && dSym.filters.symbols?.[0] === "MNQ");
ok("点标的 → 标签可读", drillLabel({ kind: "symbol", value: "MNQ" }) === "标的 MNQ");

const stacked = applyDrill(dSym, { kind: "weekday", value: 1 });
ok("连续下钻是叠加不是重置", stacked.filters.symbols?.[0] === "MNQ" && stacked.filters.weekdays?.[0] === 1);
ok("连续下钻保留时间档", stacked.preset === "month");

const dDir = applyDrill(emptyQuery("all"), { kind: "direction", value: "short" });
ok("点多空 → 方向过滤", dDir.filters.directions?.[0] === "short");
ok("多空标签", drillLabel({ kind: "direction", value: "long" }) === "做多");
ok("星期标签", drillLabel({ kind: "weekday", value: 5 }) === "周五");
ok("日期标签就是日期", drillLabel({ kind: "date", date: "2026-10-16" }) === "2026-10-16");

// 下钻后再点日历，时间区间被新日期覆盖，维度条件保留
const reDrill = applyDrill(stacked, { kind: "date", date: "2026-10-12" });
ok("再点日历会覆盖区间", reDrill.customFrom === "2026-10-12" && reDrill.customTo === "2026-10-12");
ok("再点日历保留维度条件", reDrill.filters.symbols?.[0] === "MNQ" && reDrill.filters.weekdays?.[0] === 1);

// 下钻结果喂给快照，卡片和表格口径一致
const drillSnap = buildSnapshot(wkBase, applyDrill(emptyQuery("all"), { kind: "date", date: "2026-10-16" }), "2026-10-20");
ok("下钻后快照只剩 1 笔", drillSnap.trades.length === 1, drillSnap.trades.length);
ok("下钻后净盈亏=当天", drillSnap.metrics.netPnL.value === -50, drillSnap.metrics.netPnL.value);

/* ---------- 批量设置策略：frontmatter 往返 ---------- */
const mdSample = [
  "---",
  'type: "trade"',
  'date: "2026-09-17"',
  'time: "21:55"',
  'symbol: "F.US.MNQZ26"',
  'direction: "short"',
  "entry: 29676.458333",
  "exit: 29704",
  "quantity: 6",
  "fees: 8.64",
  "pnl: -339.14",
  "tags:",
  '  - "trade"',
  '  - "auto-paired"',
  'created: "2026-10-18T14:18:59"',
  'exitTime: "22:14:05"',
  "holdSeconds: 1125",
  "---",
  "自动配对：市价 → 止损，持有 19 分钟",
  "",
].join("\n");

const before = parseFrontmatter(mdSample);
const withSetup = parseFrontmatter(
  stringifyFrontmatter({ ...before.data, setup: "突破" }, before.body)
);
ok("设置策略写入成功", withSetup.data.setup === "突破", withSetup.data.setup);
ok("其它字段不受影响", withSetup.data.pnl === -339.14 && withSetup.data.quantity === 6);
ok("时间戳字段还在", withSetup.data.exitTime === "22:14:05" && withSetup.data.holdSeconds === 1125);
ok("标签数组还在", Array.isArray(withSetup.data.tags) && withSetup.data.tags.length === 2);
ok("正文保留", withSetup.body.includes("自动配对"));

const cleared = { ...before.data };
delete cleared.setup;
const reCleared = parseFrontmatter(stringifyFrontmatter(cleared, before.body));
ok("清除策略后字段消失", reCleared.data.setup === undefined);
ok("清除后正文仍在", reCleared.body.includes("自动配对"));


/* ---- 回撤分段与恢复（P5） ---- */
const ddTrades = [10, -5, -5, 10].map((p, i) => mkTrade(`2026-10-0${i + 1}`, p));
const eps = drawdownEpisodes(ddTrades);
ok("回撤切成 1 段", eps.length === 1, eps.length);
ok("回撤幅度 10", Math.abs(eps[0].depth - 10) < 1e-9, eps[0].depth);
ok("高点落在 10-01", eps[0].peakDate === "2026-10-01", eps[0].peakDate);
ok("谷底落在 10-03", eps[0].troughDate === "2026-10-03", eps[0].troughDate);
ok("下行 2 个交易日", eps[0].downDays === 2, eps[0].downDays);
ok("恢复 1 个交易日", eps[0].recoveryDays === 1, eps[0].recoveryDays);
ok("标记为已收复", eps[0].recovered === true);
ok("整段持续 3 个交易日", eps[0].durationDays === 3, eps[0].durationDays);

const openEps = drawdownEpisodes([10, -30, 5].map((p, i) => mkTrade(`2026-10-0${i + 1}`, p)));
ok("未收复时 recoveryDays 为 null", openEps[0].recoveryDays === null);
ok("未收复段 recovered=false", openEps[0].recovered === false);
ok("未收复段算到数据末尾", openEps[0].durationDays === 2, openEps[0].durationDays);

const ddS = drawdownStats(ddTrades);
ok("水下占比 2/4", Math.abs(ddS.timeUnderwater - 0.5) < 1e-9, ddS.timeUnderwater);
ok("平均恢复 1 天", ddS.avgRecoveryDays === 1, ddS.avgRecoveryDays);
ok("最长回撤 3 天", ddS.longestDays === 3, ddS.longestDays);
ok("当前已回到新高", ddS.current === 0, ddS.current);

/* ---- 风险指标 ---- */
const ddSnap = buildSnapshot(ddTrades, emptyQuery("all"), T);
ok("平均恢复指标格式化", formatMetric(ddSnap.metrics.avgRecovery.value, "days") === "1 天", formatMetric(ddSnap.metrics.avgRecovery.value, "days"));
ok("水下时间指标 50%", Math.abs((ddSnap.metrics.timeUnderwater.value ?? 0) - 0.5) < 1e-9, ddSnap.metrics.timeUnderwater.value);
ok("当前回撤展示为 0", ddSnap.metrics.currentDrawdown.value === 0, ddSnap.metrics.currentDrawdown.value);
ok("风险类指标已注册", REGISTRY_BY_ID.get("longestDrawdown")?.category === "risk");

const stillDown = buildSnapshot([mkTrade("2026-10-01", 100), mkTrade("2026-10-02", -40)], emptyQuery("all"), T);
ok("回撤中时当前回撤为 -40", Math.abs((stillDown.metrics.currentDrawdown.value ?? 0) + 40) < 1e-9, stillDown.metrics.currentDrawdown.value);
ok("回撤中时不报已恢复", stillDown.metrics.avgRecovery.value === null, stillDown.metrics.avgRecovery.value);

/* ---- 概要结论 ---- */
const smallSnap = buildSnapshot(
  [mkTrade("2026-10-01", 100), mkTrade("2026-10-02", -50)],
  emptyQuery("all"),
  T
);
const insIds = buildInsights(smallSnap, "¥").map((i) => i.id);
ok("小样本给出提示", insIds.includes("sample"), insIds.join(","));
ok("止损全缺时明说 R 倍数不可用", insIds.includes("stopCoverage"), insIds.join(","));
ok("单一策略占满利润时提示集中度", insIds.includes("concentration"), insIds.join(","));

const badSnap = buildSnapshot(
  [-10, -10, -10, -10, 5, 20].map((p, i) => mkTrade(`2026-11-0${i + 1}`, p)),
  emptyQuery("all"),
  T
);
const badIns = buildInsights(badSnap, "¥");
ok("问题类结论排在最前", badIns[0]?.tone === "bad", badIns.map((i) => i.tone).join(","));
ok("连亏 4 笔被抓到", badIns.some((i) => i.id === "lossStreak"), badIns.map((i) => i.id).join(","));

const line = headline(smallSnap, "¥");
ok("概要一句话含笔数", line.includes("2 笔"), line);
ok("概要一句话含胜率", line.includes("胜率"), line);

const hlTrades = [
  mkTrade("2026-10-01", 100),
  mkTrade("2026-10-02", 120),
  { ...mkTrade("2026-10-03", -100), setup: "反转" },
  { ...mkTrade("2026-10-04", -200), setup: "反转" },
];
const hl = highlights(hlTrades);
ok("强项挑出赚钱策略", hl.strong[0]?.key === "ORB", hl.strong.map((h) => h.key).join(","));
ok("短板挑出亏钱策略", hl.weak[0]?.key === "反转", hl.weak.map((h) => h.key).join(","));
ok("单笔策略不算规律", highlights([mkTrade("2026-10-01", 100)]).strong.length === 0);


/* ---- 打平区间（P5-3） ---- */
ok("阈值内算打平", classifyPnl(5, 10) === "be", classifyPnl(5, 10));
ok("刚过阈值算赢", classifyPnl(11, 10) === "win");
ok("负向过阈值算亏", classifyPnl(-11, 10) === "loss");
ok("默认阈值 0 时 0 算打平", classifyPnl(0) === "be");

const beTrades = [
  { ...mkTrade("2026-10-01", 100), outcome: "win" as const },
  { ...mkTrade("2026-10-02", 3), outcome: "be" as const },
  { ...mkTrade("2026-10-03", -2), outcome: "be" as const },
  { ...mkTrade("2026-10-04", -50), outcome: "loss" as const },
];
const beSum = summarize(beTrades);
ok("打平不计入胜", beSum.wins === 1, beSum.wins);
ok("打平不计入负", beSum.losses === 1, beSum.losses);
ok("打平单独计数", beSum.breakeven === 2, beSum.breakeven);
ok("胜率排除打平", Math.abs(beSum.winRate - 0.5) < 1e-9, beSum.winRate);
ok("毛利只算赢家", beSum.grossProfit === 100, beSum.grossProfit);

const streakTrades = [
  { ...mkTrade("2026-10-01", 100), outcome: "win" as const },
  { ...mkTrade("2026-10-02", 1), outcome: "be" as const },
  { ...mkTrade("2026-10-03", 100), outcome: "win" as const },
];
ok("打平不打断连胜", summarize(streakTrades).maxWinStreak === 2, summarize(streakTrades).maxWinStreak);

/* ---- 数据体检（P5-1） ---- */
const gapTrade = {
  ...mkTrade("2026-10-01", 10),
  setup: "",
  stop: null,
  exitTime: undefined,
  holdSeconds: null,
  tags: ["trade"],
  notes: "",
};
const fullTrade = {
  ...mkTrade("2026-10-02", 20),
  setup: "突破",
  stop: 99,
  exitTime: "22:10:00",
  holdSeconds: 600,
  tags: ["突破"],
  notes: "按计划进的，回踩不破加了一次",
};
ok("缺策略能识别", hasGap(gapTrade, "setup"));
ok("缺止损能识别", hasGap(gapTrade, "stop"));
ok("缺平仓时间能识别", hasGap(gapTrade, "exitTime"));
ok("只有自动标签也算缺标签", hasGap(gapTrade, "tags"));
ok("正文过短算没复盘", hasGap(gapTrade, "notes"));
ok("字段齐全不算缺", !hasGap(fullTrade, "setup") && !hasGap(fullTrade, "tags") && !hasGap(fullTrade, "notes"));

const audit = auditTrades([gapTrade, { ...gapTrade }, fullTrade]);
ok("体检按缺口统计", audit.every((g) => g.count === 2), audit.map((g) => g.count).join(","));
ok("体检按影响面排序", audit[0].count >= audit[audit.length - 1].count);
ok("全缺时不返回 0 项", audit.length === 5, audit.length);

const gapQuery = { preset: "all" as const, filters: { gaps: ["setup" as const] } };
ok("按缺口筛选", filterTrades([gapTrade, fullTrade], gapQuery, null).length === 1);
const twoGapQuery = {
  preset: "all" as const,
  filters: { gaps: ["setup" as const, "stop" as const] },
};
ok("多个缺口取交集", filterTrades([gapTrade, fullTrade], twoGapQuery, null).length === 1);
ok("体检条件算有效查询", hasActiveQuery(gapQuery) === true);
ok("下钻会清掉体检条件", applyDrill(gapQuery, { kind: "symbol", value: "MNQ" }).filters.gaps === undefined);

const gapSnap = buildSnapshot(
  [
    { ...mkTrade("2026-10-01", 100), setup: "" },
    { ...mkTrade("2026-10-02", -50), setup: "" },
    { ...mkTrade("2026-10-03", 80), setup: "" },
    { ...mkTrade("2026-10-04", 20), setup: "" },
  ],
  emptyQuery("all"),
  T
);
ok("速览页提示缺策略", buildInsights(gapSnap, "¥").some((i) => i.id === "setupGap"));


/* ---- 多账户 ---- */
const accA = { ...mkTrade("2026-10-01", 100), account: "AMP" };
const accB = { ...mkTrade("2026-10-01", 100), account: "Tradovate" };
ok("同成交不同账户不会被当成重复", tradeKey(accA) !== tradeKey(accB), tradeKey(accA));
ok("账户名大小写与空格不影响去重", tradeKey({ ...accA, account: "  amp " }) === tradeKey(accA));
ok(
  "账户筛选只留该账户",
  filterTrades([accA, accB], { preset: "all", filters: { accounts: ["AMP"] } }, null).length === 1
);
const noAcc = { ...mkTrade("2026-10-02", 5), account: "" };
ok(
  "空账户可单独筛出",
  filterTrades([accA, noAcc], { preset: "all", filters: { accounts: [""] } }, null).length === 1
);
ok(
  "选账户算有效查询",
  hasActiveQuery({ preset: "all", filters: { accounts: ["AMP"] } }) === true
);



/* ---- 账户目录（方案 B：写入按账户分目录）---- */
const pathDraft = { ...mkTrade("2026-10-09", 100), time: "21:34", symbol: "MNQ", setup: "突破", account: "AMP" };
ok("有账户时写到子目录", noteFilePath("Trading", pathDraft) === "Trading/AMP/202610092134-MNQ-突破.md", noteFilePath("Trading", pathDraft));
ok("空账户留在根目录", noteFilePath("Trading", { ...pathDraft, account: "" }) === "Trading/202610092134-MNQ-突破.md", noteFilePath("Trading", { ...pathDraft, account: "" }));
ok("账户名里的斜杠被清掉", accountFolder("A/B") === "AB", accountFolder("A/B"));
ok("账户名首尾空格被清掉", accountFolder("  AMP  ") === "AMP");
ok("路径不会出现双斜杠", !noteFilePath("Trading/", { ...pathDraft, account: "AMP" }).includes("//"), noteFilePath("Trading/", pathDraft));
ok("未分类账户不建目录", noteFilePath("Trading", { ...pathDraft, account: "   " }) === noteFilePath("Trading", { ...pathDraft, account: "" }));


/* ---- 每日盈亏跟随账户 ---- */
const accDays = [
  { ...mkTrade("2026-10-01", 100), account: "AMP" },
  { ...mkTrade("2026-10-01", 300), account: "TV" },
  { ...mkTrade("2026-10-02", -50), account: "TV" },
];
const allSnap2 = buildSnapshot(accDays, emptyQuery("all"), T);
const ampSnap2 = buildSnapshot(accDays, { preset: "all", filters: { accounts: ["AMP"] } }, T);
const tvSnap2 = buildSnapshot(accDays, { preset: "all", filters: { accounts: ["TV"] } }, T);
ok("全部账户每日盈亏合并", allSnap2.days.find((d) => d.date === "2026-10-01")?.pnl === 400);
ok("单账户每日盈亏只算自己", ampSnap2.days.find((d) => d.date === "2026-10-01")?.pnl === 100, ampSnap2.days);
ok("另一账户不同日", tvSnap2.days.length === 2 && tvSnap2.days[0].pnl === 300, tvSnap2.days);


/* ---- 导入收件箱 ---- */
const inbox = "Trading/_inbox";
ok("路径在收件箱内", isInsideInbox(inbox, "Trading/_inbox/AMP/a.csv"));
ok("同名前缀不算收件箱", !isInsideInbox(inbox, "Trading/_inbox2/AMP/a.csv"));
ok("账户取自第一层目录", accountFromInboxPath(inbox, "Trading/_inbox/AMP/a.csv") === "AMP");
ok("多套一层仍取第一层", accountFromInboxPath(inbox, "Trading/_inbox/AMP/2026/a.csv") === "AMP");
ok("根目录文件没有账户", accountFromInboxPath(inbox, "Trading/_inbox/a.csv") === null);
ok("_imported 里的不算", accountFromInboxPath(inbox, "Trading/_inbox/_imported/AMP/a.csv") === null);
ok("_error 里的不算", accountFromInboxPath(inbox, "Trading/_inbox/_error/AMP/a.csv") === null);
ok("工作目录识别", isWorkFolder("_imported") && isWorkFolder("_error") && !isWorkFolder("AMP"));

const utf8Bytes = new TextEncoder().encode("\uFEFF日期,标的\n2026-10-01,MNQ");
ok("UTF-8 BOM 被去掉", decodeCsv(utf8Bytes.buffer as ArrayBuffer).startsWith("日期"));
const gbkBytes = new Uint8Array([0xc8, 0xd5, 0xc6, 0xda, 0x2c, 0xb1, 0xea, 0xb5, 0xc4]); // "日期,标的"
ok("GBK 自动回退", decodeCsv(gbkBytes.buffer as ArrayBuffer) === "日期,标的", decodeCsv(gbkBytes.buffer as ArrayBuffer));

const inboxRow = parseInboxCsv(
  "ContractName,EnteredAt,ExitedAt,EntryPrice,ExitPrice,Fees,PnL,Size,Type\nMNQZ6,09/21/2026 21:34:02 +08:00,09/21/2026 21:34:33 +08:00,30225.5,30238.75,1.44,-53,2,Short",
  "Tradovate"
);
ok("收件箱按行解析", inboxRow.mode === "row" && inboxRow.drafts.length === 1, inboxRow);
ok("账户由目录名覆盖", inboxRow.drafts[0]?.account === "Tradovate", inboxRow.drafts[0]?.account);
ok("单行盈亏仍扣费", Math.abs((inboxRow.drafts[0]?.pnl ?? 0) + 54.44) < 1e-9, inboxRow.drafts[0]?.pnl);

const inboxOrder = parseInboxCsv(
  "商品代码,买/卖,类型,数量,限价,止损价,填充数量,平均成交价,手续费,下单时间,状态,状态时间,订单编号,期限\n" +
    "F.US.MNQZ26,卖出,市价,6,,,6,29815.75,,2026-10-19 21:44:34,已成交,2026-10-19 21:44:34,1,GTC\n" +
    "F.US.MNQZ26,买入,市价,6,,,6,29752.25,,2026-10-19 21:44:52,已成交,2026-10-19 21:44:52,2,GTC",
  "AMP"
);
ok("收件箱识别委托级并配对", inboxOrder.mode === "pair" && inboxOrder.drafts.length === 1, inboxOrder);
ok("配对后账户也覆盖", inboxOrder.drafts[0]?.account === "AMP", inboxOrder.drafts[0]?.account);

ok("空文件给出错误", parseInboxCsv("", "AMP").drafts.length === 0);

console.log(failed === 0 ? "\n全部通过" : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
