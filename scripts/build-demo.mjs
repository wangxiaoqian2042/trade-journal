import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const outDir = path.resolve("demo");
fs.mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: ["src/demo.tsx"],
  bundle: true,
  format: "iife",
  target: "es2019",
  jsx: "automatic",
  minify: true,
  sourcemap: false,
  outfile: path.join(outDir, "app.js"),
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
});

fs.copyFileSync("styles.css", path.join(outDir, "styles.css"));

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>交易日志 · 界面预览</title>
<link rel="stylesheet" href="./styles.css" />
<style>
  :root {
    --background-primary: #ffffff;
    --background-secondary: #f6f7f9;
    --background-primary-alt: #fcfcfd;
    --text-normal: #1f2328;
    --text-muted: #6b7280;
    --background-modifier-border: #e6e8eb;
    --background-modifier-border-hover: #c9ced6;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #eceef1;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif;
    color: #1f2328;
  }
  .shell {
    max-width: 1220px;
    margin: 0 auto;
    background: #fff;
    min-height: 100vh;
    box-shadow: 0 0 0 1px #e0e3e7, 0 20px 60px rgba(15, 23, 42, 0.06);
  }
  .banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 22px;
    background: #1f2328;
    color: #e8eaed;
    font-size: 12.5px;
  }
  .banner b { font-weight: 600; }
  .banner span { opacity: 0.75; }
  /* 预览页里让容器自然撑开，不模拟 Obsidian 的固定高度 */
  .tj-root { height: auto !important; max-height: none !important; padding-bottom: 60px; }
  .tj-table-wrap { max-height: none !important; }
  /* 预览环境点开交易时给的反馈（插件里会直接打开笔记） */
  .preview-toast {
    position: fixed;
    left: 50%;
    bottom: 26px;
    transform: translateX(-50%);
    max-width: 640px;
    padding: 10px 16px;
    border-radius: 8px;
    background: #1f2328;
    color: #e8eaed;
    font-size: 12.5px;
    line-height: 1.5;
    cursor: pointer;
    box-shadow: 0 10px 30px rgba(15, 23, 42, 0.25);
  }
</style>
</head>
<body class="theme-light">
  <div class="banner">
    <div><b>交易日志 · 界面预览</b> <span>（示例数据，非真实交割单；插件内效果一致）</span></div>
    <span>切到「导入」页可以试粘贴 CSV</span>
  </div>
  <div class="shell"><div id="app"></div></div>
  <script src="./app.js"></script>
</body>
</html>
`;

fs.writeFileSync(path.join(outDir, "index.html"), html, "utf8");
console.log("demo 已生成:", path.join(outDir, "index.html"));
