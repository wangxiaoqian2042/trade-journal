import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { FakeVault } from "./obsidian-stub";
import { TradeStore } from "../src/services/store";
import { parseCsv, detectColumns, buildDrafts } from "../src/services/csv";
import { summarize } from "../src/services/analytics";

const vault = new FakeVault();
const app = { vault } as never;

const store = new TradeStore(app, "Trading");

// 用法：node vaulttest.cjs [某个 csv]  —— 不传则用 examples/ 里的示例数据
const csvPath =
  process.argv[2] || fileURLToPath(new URL("../examples/示例交易.csv", import.meta.url));
const txt = fs.readFileSync(csvPath, "utf8");
const rows = parseCsv(txt);
const map = detectColumns(rows[0]);
const { drafts } = buildDrafts(rows.slice(1), rows[0], map);

const r1 = await store.importDrafts(drafts, []);
console.log("导入结果:", r1);

const all = await store.loadAll();
const inMemSum = drafts.reduce((a, b) => a + b.pnl, 0);
const loadedSum = all.reduce((a, b) => a + b.pnl, 0);
console.log(`内存 ${drafts.length} 笔 / 读回 ${all.length} 笔`);
console.log(`内存合计 ${inMemSum.toFixed(2)} / 读回合计 ${loadedSum.toFixed(2)}`);
console.log("文件数:", vault.files.size);
console.log("样例文件:", [...vault.files.keys()][0]);
console.log("---- 文件内容 ----");
console.log([...vault.files.values()][0]);

const s = summarize(all);
console.log(
  `汇总: ${s.count} 笔 净盈亏 ${s.netPnl.toFixed(2)} 胜率 ${(s.winRate * 100).toFixed(1)}% 最大回撤 ${s.maxDrawdown.toFixed(2)}`
);

const r2 = await store.importDrafts(drafts, all);
console.log("重复导入:", r2);
