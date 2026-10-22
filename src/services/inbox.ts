import { TradeDraft } from "../types";
import { buildDrafts, detectColumns, parseCsv } from "./csv";
import { detectOrderExport, pairOrders } from "./pairing";

/**
 * 导入收件箱。
 *
 * 约定：`<交易目录>/_inbox/<账户>/xxx.csv`。
 * 账户来自第一层子目录名，文件本身不需要带账户信息——
 * 这样从券商网站下载的原文件可以直接丢进去，不用改名。
 */

export const INBOX_IMPORTED = "_imported";
export const INBOX_ERROR = "_error";

/** 只处理这些扩展名 */
export const CSV_EXTENSIONS = ["csv", "txt", "tsv"];

/** 路径是否在收件箱里（含收件箱本身） */
export function isInsideInbox(inboxPath: string, path: string): boolean {
  const base = inboxPath.replace(/\/+$/, "");
  return path === base || path.startsWith(base + "/");
}

/** 是否是收件箱的工作目录（导入成功 / 失败），这些目录不再扫描 */
export function isWorkFolder(name: string): boolean {
  return name === INBOX_IMPORTED || name === INBOX_ERROR;
}

/**
 * 从收件箱路径推出账户名。
 * `Trading/_inbox/AMP/a.csv` → "AMP"；直接放在根目录 → null。
 */
export function accountFromInboxPath(inboxPath: string, path: string): string | null {
  const base = inboxPath.replace(/\/+$/, "");
  if (!path.startsWith(base + "/")) return null;
  const rest = path.slice(base.length + 1).split("/").filter(Boolean);
  if (rest.length < 2) return null;
  const folder = rest[0];
  if (isWorkFolder(folder)) return null;
  return folder.trim() || null;
}

/**
 * CSV 解码：优先 UTF-8，出现替换字符就按 GBK 再试一次。
 * 国内券商的导出经常是 GBK，直接按 UTF-8 读会变成一堆问号。
 */
export function decodeCsv(bytes: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  if (utf8.includes("\uFFFD")) {
    try {
      return new TextDecoder("gbk").decode(bytes);
    } catch {
      // 浏览器不支持 gbk 时保留 utf-8 结果
    }
  }
  return utf8.replace(/^\uFEFF/, "");
}

/** 一条「这种格式的文件属于哪个账户」的记忆 */
export interface InboxRule {
  /** 表头签名，见 formatSignature */
  signature: string;
  account: string;
  /** 给人看的表头片段，设置里显示用 */
  sample: string;
  /** 学习时间，ISO */
  at: string;
}

/**
 * 表头签名：把列名归一化后排序去重。
 * 同一个券商的导出即使列顺序变了，签名也一样，比看文件名可靠。
 */
export function formatSignature(header: string[]): string {
  const tokens = header
    .map((h) =>
      h
        .replace(/^\uFEFF/, "")
        .trim()
        .toLowerCase()
        .replace(/[\s_\-.]+/g, "")
        .replace(/[^a-z0-9\u4e00-\u9fa5]/g, "")
    )
    .filter(Boolean);
  return [...new Set(tokens)].sort().join("|");
}

/** 取 CSV 的表头（只解析第一行，大文件也不浪费） */
export function headerOf(text: string): string[] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  return parseCsv(firstLine)[0] ?? [];
}

export function findRule(rules: InboxRule[] | undefined, signature: string): InboxRule | null {
  if (!rules || !signature) return null;
  for (let i = rules.length - 1; i >= 0; i--) {
    if (rules[i].signature === signature) return rules[i];
  }
  return null;
}

export interface InboxParseResult {
  drafts: TradeDraft[];
  errors: { row: number; message: string }[];
  /** row = 一行一回合；pair = 委托级，已配对 */
  mode: "row" | "pair";
  /** 文件里识别到的账户列值（会被目录名覆盖） */
  csvAccount: string;
}

/**
 * 把一份 CSV 变成可写入的交易草稿。
 *
 * 自动判定「一行一回合」还是「委托级需要配对」，
 * 并把账户统一改成调用方给的账户（目录名）。
 */
export function parseInboxCsv(text: string, account: string): InboxParseResult {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return { drafts: [], errors: [{ row: 1, message: "文件为空或没有数据行" }], mode: "row", csvAccount: "" };
  }

  const header = rows[0];
  const dataRows = rows.slice(1);
  const order = detectOrderExport(header);

  if (order) {
    // 委托级导出：按 AMP 的手续费默认值配对，账户仍然由目录决定
    const paired = pairOrders(dataRows, order, { feePerContract: 0.72 });
    return {
      drafts: paired.drafts.map((d) => ({ ...d, account })),
      errors: paired.errors,
      mode: "pair",
      csvAccount: "",
    };
  }

  const map = detectColumns(header);
  const built = buildDrafts(dataRows, header, map);
  const csvAccount = built.drafts.find((d) => d.account)?.account ?? "";
  return {
    drafts: built.drafts.map((d) => ({ ...d, account })),
    errors: built.errors,
    mode: "row",
    csvAccount,
  };
}
