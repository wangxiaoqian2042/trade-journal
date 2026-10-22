/** 收件箱监听：用内存 vault 跑完整流程（扫描 → 导入 → 挪文件 → 去重 → 失败归档） */
import { FakeVault } from "./obsidian-stub";
import { TradeStore } from "../src/services/store";
import { InboxWatcher } from "../src/services/InboxWatcher";

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

const watcher = new InboxWatcher({
  app: app as never,
  store,
  inboxPath: "Trading/_inbox",
  onImported: () => reloaded++,
});

const r1 = await watcher.scan();
ok("扫到 1 个文件", r1.files === 1, r1);
ok("导入 2 笔", r1.created === 2, r1);
ok("回调触发一次", reloaded === 1, reloaded);
ok("源文件已移走", !vault.files.has("Trading/_inbox/AMP/trades.csv"));
ok("落到 _imported", vault.files.has("Trading/_inbox/_imported/AMP/trades.csv"));
ok("按账户写入笔记", [...vault.files.keys()].filter((k) => k.startsWith("Trading/AMP/")).length === 2, [...vault.files.keys()]);

const r2 = await watcher.scan();
ok("再扫不重复导入", r2.files === 0 && r2.created === 0, r2);

// 同一份数据换个文件名再放进来：应被去重挡掉
vault.files.set("Trading/_inbox/AMP/again.csv", csv);
const r3 = await watcher.scan();
ok("同数据不同文件名被判重复", r3.created === 0 && r3.skipped === 2, r3);
ok("重复文件也挪走", vault.files.has("Trading/_inbox/_imported/AMP/again.csv"));

// 无法解析的文件：进 _error 并写日志
vault.files.set("Trading/_inbox/AMP/bad.csv", "foo,bar\n1,2");
const r4 = await watcher.scan();
ok("坏文件计入失败", r4.failed === 1, r4);
ok("坏文件进 _error", vault.files.has("Trading/_inbox/_error/AMP/bad.csv"));
ok("有对应日志", vault.files.has("Trading/_inbox/_error/AMP/bad.log"));

// 根目录直接放文件：不知道账户，拒绝并说明
vault.files.set("Trading/_inbox/loose.csv", csv);
const r5 = await watcher.scan();
ok("根目录文件被拒绝", r5.failed === 1, r5);
ok("根目录文件进 _error/根目录", vault.files.has("Trading/_inbox/_error/根目录/loose.csv"));

console.log(failed === 0 ? "\n收件箱集成全部通过" : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
