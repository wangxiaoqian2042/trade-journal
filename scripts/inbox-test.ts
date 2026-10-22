/** 收件箱：内存 vault 跑完整流程（目录投递 / 弹窗归户 / 规则记忆 / 去重 / 失败归档） */
import { FakeVault } from "./obsidian-stub";
import { TradeStore } from "../src/services/store";
import { InboxWatcher } from "../src/services/InboxWatcher";
import { InboxRule } from "../src/services/inbox";

let failed = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  if (!cond) failed++;
  console.log(`${cond ? "✓" : "✗"} ${name}`, cond ? "" : extra ?? "");
};

const csv = `ContractName,EnteredAt,ExitedAt,EntryPrice,ExitPrice,Fees,PnL,Size,Type
MNQZ6,09/21/2026 21:34:02 +08:00,09/21/2026 21:34:33 +08:00,30225.5,30238.75,1.44,-53,2,Short
MNQZ6,09/22/2026 21:00:00 +08:00,09/22/2026 21:10:00 +08:00,30300,30320,1.44,40,2,Long`;

const vault = new FakeVault();
vault.folders.add("Trading");
vault.folders.add("Trading/_inbox");
vault.folders.add("Trading/_inbox/AMP");
vault.files.set("Trading/_inbox/AMP/trades.csv", csv);

const app = { vault } as never;
const store = new TradeStore(app, "Trading");
let reloaded = 0;
const rules: InboxRule[] = [];
let asked = 0;
let answer: string | null = "topstepx";

const watcher = new InboxWatcher({
  app: app as never,
  store,
  inboxPath: "Trading/_inbox",
  onImported: () => reloaded++,
  getRules: () => rules,
  learnRule: (r) => {
    const i = rules.findIndex((x) => x.signature === r.signature);
    if (i >= 0) rules.splice(i, 1);
    rules.push(r);
  },
  askAccount: async () => {
    asked++;
    return answer;
  },
});

/* 1. 目录投递 */
const r1 = await watcher.scan();
ok("扫到 1 个文件", r1.files === 1, r1);
ok("导入 2 笔", r1.created === 2, r1);
ok("回调触发一次", reloaded === 1, reloaded);
ok("源文件已移走", !vault.files.has("Trading/_inbox/AMP/trades.csv"));
ok("落到 _imported", vault.files.has("Trading/_inbox/_imported/AMP/trades.csv"));
ok("按账户写入笔记", [...vault.files.keys()].filter((k) => k.startsWith("Trading/AMP/")).length === 2);

const r2 = await watcher.scan();
ok("再扫不重复导入", r2.files === 0 && r2.created === 0, r2);

/* 2. 同数据换文件名：数据级去重 */
vault.files.set("Trading/_inbox/AMP/again.csv", csv);
const r3 = await watcher.scan();
ok("同数据不同文件名被判重复", r3.created === 0 && r3.skipped === 2, r3);
ok("重复文件也挪走", vault.files.has("Trading/_inbox/_imported/AMP/again.csv"));

/* 3. 根目录文件：没有规则时问一次，选完记住 */
vault.files.set("Trading/_inbox/loose.csv", csv.replace("MNQZ6", "MNQZ6"));
const r4 = await watcher.scan();
ok("根目录文件先问账户", asked === 1, asked);
ok("问完按选择导入", r4.created === 2, r4);
ok("落到所选账户的 _imported", vault.files.has("Trading/_inbox/_imported/topstepx/loose.csv"), [...vault.files.keys()]);
ok("学会了归户规则", rules.length === 1 && rules[0].account === "topstepx", rules);
ok("规则存了表头样本", rules[0].sample.includes("ContractName"), rules[0].sample);

/* 4. 同格式再来一次：不再问，直接归户 */
const csv2 = csv.replace("09/21/2026", "09/25/2026").replace("09/22/2026", "09/26/2026");
vault.files.set("Trading/_inbox/loose2.csv", csv2);
const r5 = await watcher.scan();
ok("同格式不再弹窗", asked === 1, asked);
ok("按规则导入", r5.created === 2, r5);
ok("规则导入也挪文件", vault.files.has("Trading/_inbox/_imported/topstepx/loose2.csv"));

/* 5. 用户选「稍后处理」：文件留在原地 */
answer = null;
vault.files.set("Trading/_inbox/park.csv", csv.replace("MNQZ6", "MESZ6"));
// 换一份表头不同的文件，确保没有规则
vault.files.set("Trading/_inbox/park.csv", "Symbol,Date,Qty,Entry,Exit,PnL\nMESZ6,2026-10-01,1,5000,5010,50");
const r6 = await watcher.scan();
ok("稍后处理时不导入", r6.created === 0, r6);
ok("稍后处理时文件留在原处", vault.files.has("Trading/_inbox/park.csv"), [...vault.files.keys()]);
const askedAfterPark = asked;
await watcher.scan();
ok("稍后处理不会反复弹窗", asked === askedAfterPark, `${askedAfterPark} → ${asked}`);

/* 6. 坏文件进 _error */
vault.files.set("Trading/_inbox/AMP/bad.csv", "foo,bar\n1,2");
const r7 = await watcher.scan();
ok("坏文件计入失败", r7.failed === 1, r7);
ok("坏文件进 _error", vault.files.has("Trading/_inbox/_error/AMP/bad.csv"));
ok("有对应日志", vault.files.has("Trading/_inbox/_error/AMP/bad.log"));

console.log(failed === 0 ? "\n收件箱集成全部通过" : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
