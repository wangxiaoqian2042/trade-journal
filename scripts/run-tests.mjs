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
// 唯一目录 + 删除失败可忽略：受限环境里 rmSync 可能被安全策略挡下，
// 不能因为清不掉上次的临时目录就让整套测试跑不起来。
const outDir = join(root, `.tmp-${process.pid}-${Date.now()}`);

const cases = [
  {
    name: "逻辑断言",
    entry: "scripts/test.ts",
    out: "test.mjs",
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
  });

  process.stdout.write(`\n── ${c.name} ──\n`);
  try {
    execFileSync(process.execPath, [outfile], { stdio: "inherit" });
  } catch {
    failed++;
  }
}

try {
  rmSync(outDir, { recursive: true, force: true });
} catch {
  /* 删不掉就留着，文件名带 pid 不会互相覆盖 */
}

if (failed) {
  console.error(`\n${failed} 套测试未通过`);
  process.exit(1);
}
console.log("\n全部测试通过");
