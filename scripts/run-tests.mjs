/**
 * 跑两套测试：逻辑断言（scripts/test.ts）与渲染冒烟（scripts/render-test.tsx）。
 * 用 esbuild 的 JS API 现场打包，不依赖全局命令，CI 与本地同一个入口。
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, ".tmp");

const cases = [
  {
    name: "逻辑断言",
    entry: "scripts/test.ts",
    out: "test.mjs",
    format: "esm",
  },
  {
    name: "收件箱集成",
    entry: "scripts/inbox-test.ts",
    out: "inbox-test.mjs",
    format: "esm",
  },
  {
    name: "渲染冒烟",
    entry: "scripts/render-test.tsx",
    out: "render-test.cjs",
    // react-dom/server 里带 dynamic require，必须走 cjs
    format: "cjs",
  },
];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let failed = 0;

for (const c of cases) {
  const outfile = join(outDir, c.out);
  await build({
    entryPoints: [join(root, c.entry)],
    bundle: true,
    platform: "node",
    format: c.format,
    outfile,
    loader: { ".tsx": "tsx", ".ts": "ts" },
    jsx: "automatic",
    logLevel: "error",
    absWorkingDir: root,
    alias: { obsidian: join(root, "scripts/obsidian-stub.ts") },
  });

  process.stdout.write(`\n── ${c.name} ──\n`);
  try {
    execFileSync(process.execPath, [outfile], { stdio: "inherit" });
  } catch {
    failed++;
  }
}

rmSync(outDir, { recursive: true, force: true });

if (failed) {
  console.error(`\n${failed} 套测试未通过`);
  process.exit(1);
}
console.log("\n全部测试通过");
