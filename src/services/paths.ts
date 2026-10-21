import { TradeDraft } from "../types";

/**
 * 笔记落盘路径。
 *
 * 单独一个模块是为了能脱离 Obsidian 运行时做单元测试——
 * 路径写错会把文件丢到奇怪的地方，这种错误不该只能靠手点来发现。
 */

/** 文件名里不能出现的字符，统一去掉 */
function slug(s: string): string {
  return s
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 40);
}

/** 去掉多余斜杠，和 Obsidian 的 normalizePath 行为对齐 */
function tidy(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/|\/$/g, "");
}

/**
 * 账户目录名。
 *
 * 空账户（未分类）留在根目录，不单独建文件夹——历史笔记大多是这个状态，
 * 强行归到一个「未分类」目录反而让老用户找不到自己的文件。
 */
export function accountFolder(account: string): string {
  return slug((account || "").trim());
}

/** 一笔交易应该写到哪个文件：`<根目录>/<账户>/<日期时间-标的-策略>.md` */
export function noteFilePath(basePath: string, d: TradeDraft): string {
  const stamp = `${d.date.replace(/-/g, "")}${(d.time || "").replace(":", "")}`;
  const acct = accountFolder(d.account);
  const name = `${stamp}-${slug(d.symbol) || "trade"}-${slug(d.setup) || "trade"}.md`;
  return tidy(acct ? `${basePath}/${acct}/${name}` : `${basePath}/${name}`);
}
