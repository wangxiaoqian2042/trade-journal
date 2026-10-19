/**
 * 回填平仓时间与持有时长。
 *
 * P0 之前导入的交易没有 exitTime 字段，平均持仓这类指标算不出来。
 * 这里用原始订单历史重新配对一遍，按「日期 + 开仓价 + 平仓价 + 数量」匹配已有笔记，
 * 只往 frontmatter 里补 exitTime / holdSeconds 两个字段，不动其它内容。
 *
 * 用法：node backfill-times.cjs <订单历史.csv> <vault 路径> [每手手续费]
 */
import fs from "node:fs";
import path from "node:path";
import { parseCsv } from "../src/services/csv";
import { detectOrderExport, pairOrders } from "../src/services/pairing";
import { parseFrontmatter, stringifyFrontmatter } from "../src/services/frontmatter";

const csvPath = process.argv[2];
const vault = process.argv[3];
const fee = process.argv[4] ? Number(process.argv[4]) : 0;

if (!csvPath || !vault) {
  console.error("用法: backfill-times.cjs <订单历史.csv> <vault 路径> [每手手续费]");
  process.exit(1);
}

const dir = path.join(vault, "Trading");
const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
const det = detectOrderExport(rows[0]);
if (!det) {
  console.error("这不是委托级导出，无法配对");
  process.exit(1);
}
const { drafts } = pairOrders(rows.slice(1), det, { feePerContract: fee });

const keyOf = (date: string, entry: number, exit: number, qty: number) =>
  [date, entry.toFixed(2), exit.toFixed(2), qty.toFixed(4)].join("|");

const wanted = new Map(drafts.map((d) => [keyOf(d.date, d.entry, d.exit, d.quantity), d]));
console.log(`配对出 ${drafts.length} 个回合，待匹配 ${wanted.size} 个`);

let patched = 0;
let skipped = 0;
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));

for (const file of files) {
  const full = path.join(dir, file);
  const raw = fs.readFileSync(full, "utf8");
  const { data, body } = parseFrontmatter(raw);

  const key = keyOf(
    String(data.date ?? ""),
    Number(data.entry ?? 0),
    Number(data.exit ?? 0),
    Number(data.quantity ?? 0)
  );
  const hit = wanted.get(key);
  if (!hit) continue;

  if (data.exitTime && data.holdSeconds !== undefined) {
    skipped++;
    continue;
  }

  const next = {
    ...data,
    exitTime: hit.exitTime ?? data.exitTime,
    holdSeconds: hit.holdSeconds ?? data.holdSeconds,
  };
  fs.writeFileSync(full, stringifyFrontmatter(next, body));
  patched++;
  wanted.delete(key);
}

console.log(`回填完成：更新 ${patched} 个文件，跳过 ${skipped} 个（已有字段）`);
if (wanted.size) {
  console.log(`未匹配 ${wanted.size} 个回合（可能是已删除或改动过价格）：`);
  for (const [k] of [...wanted].slice(0, 5)) console.log("  ", k);
}
