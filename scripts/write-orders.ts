/**
 * 把券商订单历史直接写进 vault（不经过 Obsidian UI）。
 * 用法： node /tmp/write-amp.cjs <订单历史.csv> <vault 根目录> [每手手续费]
 */
import fs from "node:fs";
import path from "node:path";
import { parseCsv } from "../src/services/csv";
import { detectOrderExport, pairOrders } from "../src/services/pairing";
import { stringifyFrontmatter } from "../src/services/frontmatter";
import { TradeDraft } from "../src/types";

const [src, vault, feeArg] = process.argv.slice(2);
if (!src || !vault) {
  console.error("参数不足");
  process.exit(1);
}
const fee = Number(feeArg ?? 0.72);

const rows = parseCsv(fs.readFileSync(src, "utf8"));
const det = detectOrderExport(rows[0]);
if (!det) {
  console.error("这份 CSV 不是委托级导出");
  process.exit(1);
}
const res = pairOrders(rows.slice(1), det, { feePerContract: fee });
if (!res.drafts.length) {
  console.error("没有配出任何回合");
  process.exit(1);
}

const dir = path.join(vault, "Trading");
fs.mkdirSync(dir, { recursive: true });

const slug = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]/g, "").replace(/\s+/g, "-").slice(0, 40);
const body = (d: TradeDraft) =>
  stringifyFrontmatter(
    {
      type: "trade",
      date: d.date,
      time: d.time || undefined,
      symbol: d.symbol,
      direction: d.direction,
      entry: d.entry,
      exit: d.exit,
      quantity: d.quantity,
      fees: d.fees,
      pnl: d.pnl,
      setup: d.setup || undefined,
      account: d.account || undefined,
      stop: d.stop ?? undefined,
      target: d.target ?? undefined,
      tags: d.tags.length ? d.tags : ["trade"],
      created: new Date().toISOString().slice(0, 19),
    },
    d.notes
  );

let created = 0;
for (const d of res.drafts) {
  const stamp = `${d.date.replace(/-/g, "")}${(d.time || "").replace(":", "")}`;
  const base = `${stamp}-${slug(d.symbol) || "trade"}-${slug(d.setup) || "trade"}`;
  let file = path.join(dir, `${base}.md`);
  let n = 1;
  while (fs.existsSync(file)) file = path.join(dir, `${base}-${n++}.md`);
  fs.writeFileSync(file, body(d), "utf8");
  created++;
}

console.log(`写入 ${created} 个文件 → ${dir}`);
console.log(
  `成交 ${res.meta.fills} 笔 → 回合 ${res.meta.trips} 个，毛 ${res.meta.gross.toFixed(2)}，费 ${res.meta.fees.toFixed(2)}，净 ${(
    res.meta.gross - res.meta.fees
  ).toFixed(2)}`
);
if (res.meta.open.length) console.log("未平仓:", res.meta.open);
