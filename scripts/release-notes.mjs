/**
 * 从 CHANGELOG.md 抽出当前版本的段落，作为 GitHub Release 的说明。
 *
 * 发布说明必须是"这次改了什么"，不能只丢一个 compare 链接——
 * 所以这里读取 manifest.json 的版本号，找不到对应段落就直接失败，
 * 逼着发版前先把 CHANGELOG 写好。
 */
import fs from "node:fs";

const version = JSON.parse(fs.readFileSync("manifest.json", "utf8")).version;
const md = fs.readFileSync("CHANGELOG.md", "utf8");
const lines = md.split(/\r?\n/);

const start = lines.findIndex((l) => l.startsWith(`## ${version}`));
if (start < 0) {
  console.error(`CHANGELOG.md 里没有 ${version} 的段落，先补上再发版`);
  process.exit(1);
}

let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
if (end < 0) end = lines.length;

const body = lines.slice(start, end).join("\n").trim();
if (body.replace(/^##\s.*$/m, "").trim().length === 0) {
  console.error(`${version} 的段落是空的，写点内容再发版`);
  process.exit(1);
}

process.stdout.write(body + "\n");
