/* 用 vault 里的真实交易跑一遍快照，验证 P0 的查询/指标/环比链路 */
import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "../src/services/frontmatter";
import { Trade } from "../src/types";
import { buildSnapshot } from "../src/services/aggregate";
import { Preset, resolveRange, prevRange, rangeLabel } from "../src/services/query";
import { REGISTRY, formatMetric } from "../src/services/metrics";
import { sessionOf } from "../src/services/query";

/**
 * 用某个目录里的交易笔记跑一遍快照，验证查询 / 指标 / 环比链路。
 * 用法：node snapshot-check.cjs <交易目录> [今天 YYYY-MM-DD]
 */
const dir = process.argv[2];
if (!dir) {
  console.error("用法：node snapshot-check.cjs <交易目录> [今天]");
  process.exit(1);
}
const today = process.argv[3] || undefined;

const trades: Trade[] = [];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md"))) {
  const { data, body } = parseFrontmatter(fs.readFileSync(path.join(dir, f), "utf8"));
  const time = String(data.time ?? "");
  trades.push({
    id: f,
    date: String(data.date ?? "").slice(0, 10),
    time,
    symbol: String(data.symbol ?? ""),
    direction: data.direction === "short" ? "short" : "long",
    entry: Number(data.entry ?? 0),
    exit: Number(data.exit ?? 0),
    quantity: Number(data.quantity ?? 0),
    fees: Number(data.fees ?? 0),
    pnl: Number(data.pnl ?? 0),
    setup: String(data.setup ?? ""),
    account: String(data.account ?? ""),
    stop: data.stop === undefined ? null : Number(data.stop),
    target: data.target === undefined ? null : Number(data.target),
    exitTime: data.exitTime ? String(data.exitTime) : undefined,
    holdSeconds: data.holdSeconds === undefined ? null : Number(data.holdSeconds),
    session: sessionOf(time),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    notes: body.trim(),
  });
}

console.log(`读取 ${trades.length} 笔；日期 ${trades.map((t) => t.date).sort()[0]} → ${trades.map((t) => t.date).sort().at(-1)}`);
console.log(`有平仓时间的笔数：${trades.filter((t) => t.holdSeconds != null).length}`);

const presets: Preset[] = ["today", "week", "month", "quarter", "year", "all"];
for (const preset of presets) {
  const snap = buildSnapshot(trades, { preset, filters: {} }, today);
  const r = resolveRange({ preset, filters: {} }, today);
  const p = prevRange({ preset, filters: {} }, r);
  console.log(
    `\n[${preset}] ${rangeLabel({ preset, filters: {} }, r)}  当期 ${snap.trades.length} 笔 / 上期 ${snap.prevTrades.length} 笔` +
      (p ? `  (上期 ${p.from} → ${p.to})` : "")
  );
  const ids = ["netPnL", "numTrades", "winRate", "profitFactor", "expectancy", "maxDrawdown", "avgHoldTime"];
  for (const id of ids) {
    const def = REGISTRY.find((d) => d.id === id)!;
    const m = snap.metrics[id];
    console.log(
      `   ${def.name.padEnd(8, "　")} ${formatMetric(m.value, def.format, "$").padStart(14)}` +
        `   环比 ${m.deltaText} (${m.tone})`
    );
  }
}
