import { App, EventRef, Notice, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { TradeStore } from "./store";
import { TradeDraft, tradeKey } from "../types";
import { accountFolder } from "./paths";
import {
  CSV_EXTENSIONS,
  INBOX_ERROR,
  INBOX_IMPORTED,
  InboxRule,
  decodeCsv,
  findRule,
  formatSignature,
  headerOf,
  isInsideInbox,
  isWorkFolder,
  parseInboxCsv,
} from "./inbox";

/**
 * 收件箱监听。
 *
 * 三种投递方式都支持：
 * 1. `_inbox/<账户>/x.csv` —— 目录名就是账户，最直接
 * 2. `_inbox/x.csv` + 已学会的格式规则 —— 自动归户，不打扰
 * 3. `_inbox/x.csv` + 没见过的格式 —— 弹一次窗问归哪个账户，记住答案
 *
 * 只在 vault 内活动：不碰文件系统 API，桌面版和手机版都能用。
 */

export interface InboxHost {
  app: App;
  store: TradeStore;
  inboxPath: string;
  /** 有交易写入后回调（刷新已打开的视图） */
  onImported: () => void;
  /** 已学会的归户规则 */
  getRules?: () => InboxRule[];
  /** 学一条新规则（按表头签名去重） */
  learnRule?: (rule: InboxRule) => void;
  /** 问用户归到哪个账户；返回 null 表示稍后处理。不提供则根目录文件保持不动 */
  askAccount?: (files: string[], accounts: string[]) => Promise<string | null>;
}

export interface InboxScanResult {
  files: number;
  created: number;
  skipped: number;
  failed: number;
  /** 留在根目录、等用户决定账户的文件数 */
  pending: number;
}

interface ImportOutcome {
  created: number;
  skipped: number;
  reason?: string;
}

export class InboxWatcher {
  private refs: EventRef[] = [];
  private timer: number | null = null;
  private debounce: number | null = null;
  private busy = false;
  private started = false;
  /** 弹窗还开着时不要重复扫，避免弹第二个 */
  private asking = false;
  /** 用户点过「稍后处理」的文件（同一版本不再追问，改动后会重新问） */
  private skipped = new Set<string>();

  constructor(private host: InboxHost) {}

  start(): void {
    if (this.started) return;
    this.started = true;

    const onTouch = (file: TAbstractFile) => {
      if (isInsideInbox(this.host.inboxPath, file.path)) this.schedule();
    };
    this.refs.push(this.host.app.vault.on("create", onTouch));
    this.refs.push(this.host.app.vault.on("rename", onTouch));

    this.timer = window.setInterval(() => void this.scan(), 60_000);
    void this.prepareAccountFolders();
    void this.scan();
  }

  stop(): void {
    for (const ref of this.refs) this.host.app.vault.offref(ref);
    this.refs = [];
    if (this.timer !== null) window.clearInterval(this.timer);
    if (this.debounce !== null) window.clearTimeout(this.debounce);
    this.timer = null;
    this.debounce = null;
    this.started = false;
  }

  /** 文件可能还在写入，等 1.5 秒再扫 */
  private fileKey(file: TFile): string {
    return `${file.path}@${file.stat?.mtime ?? 0}`;
  }

  private schedule(): void {
    if (this.debounce !== null) window.clearTimeout(this.debounce);
    this.debounce = window.setTimeout(() => {
      this.debounce = null;
      void this.scan();
    }, 1500);
  }

  /** 按已有账户预建收件箱子目录：用户想拖文件夹时不用自己新建 */
  private async prepareAccountFolders(): Promise<void> {
    try {
      const existing = await this.host.store.loadAll();
      const accounts = new Set(existing.map((t) => t.account.trim()).filter(Boolean));
      for (const account of accounts) {
        await this.ensureFolder(`${this.host.inboxPath}/${accountFolder(account)}`);
      }
    } catch {
      // 预建失败不影响主流程
    }
  }

  async scan(): Promise<InboxScanResult> {
    const empty: InboxScanResult = { files: 0, created: 0, skipped: 0, failed: 0, pending: 0 };
    if (this.busy || this.asking) return empty;
    this.busy = true;
    try {
      const root = await this.ensureFolder(this.host.inboxPath);
      if (!root) return empty;

      const result: InboxScanResult = { ...empty };
      const failures: string[] = [];
      const existing = await this.host.store.loadAll();
      const seen = new Set(existing.map(tradeKey));
      const accounts = new Set(existing.map((t) => t.account.trim()).filter(Boolean));
      const unknown: { file: TFile; text: string; signature: string }[] = [];

      for (const child of [...root.children]) {
        // 根目录：先看有没有学会的格式规则，没有就攒起来统一问
        if (child instanceof TFile) {
          if (!CSV_EXTENSIONS.includes(child.extension.toLowerCase())) continue;
          result.files++;
          const text = await this.readText(child);
          if (text === null) {
            result.failed++;
            failures.push(`${child.name}：读取失败`);
            await this.reject(child, "", "读取失败");
            continue;
          }
          const signature = formatSignature(headerOf(text));
          const rule = findRule(this.host.getRules?.(), signature);
          if (rule) {
            const outcome = await this.importText(child, text, rule.account, seen);
            this.tally(result, outcome, child.name, failures);
          } else {
            unknown.push({ file: child, text, signature });
          }
          continue;
        }

        if (!(child instanceof TFolder) || isWorkFolder(child.name)) continue;
        const account = child.name.trim();
        accounts.add(account);

        for (const item of [...child.children]) {
          if (!(item instanceof TFile)) continue;
          if (!CSV_EXTENSIONS.includes(item.extension.toLowerCase())) continue;
          result.files++;
          const outcome = await this.importFile(item, account, seen);
          this.tally(result, outcome, item.name, failures);
        }
      }

      result.pending = unknown.length;
      const toAsk = unknown.filter((u) => !this.skipped.has(this.fileKey(u.file)));
      if (toAsk.length) {
        await this.askAndImport(toAsk, accounts, seen, result, failures);
      }

      if (result.created > 0) {
        this.host.onImported();
        new Notice(`交易日志：自动导入 ${result.created} 笔（跳过重复 ${result.skipped} 笔）`);
      } else if (result.failed > 0 && result.pending === 0) {
        const head = failures.slice(0, 2).join("；");
        const more = failures.length > 2 ? ` 等 ${failures.length} 个文件` : "";
        new Notice(`交易日志：${head}${more}。失败的已挪到 _inbox/_error/，旁边有 .log`, 10000);
      }
      return result;
    } finally {
      this.busy = false;
    }
  }

  /** 问一次账户，然后把攒下的根目录文件全部导入，并记住这个格式 */
  private async askAndImport(
    files: { file: TFile; text: string; signature: string }[],
    accounts: Set<string>,
    seen: Set<string>,
    result: InboxScanResult,
    failures: string[]
  ): Promise<void> {
    if (!this.host.askAccount) return;

    this.asking = true;
    let picked: string | null = null;
    try {
      picked = await this.host.askAccount(
        files.map((f) => f.file.name),
        [...accounts]
      );
    } finally {
      this.asking = false;
    }
    if (!picked) {
      // 稍后处理：文件留在原处。记下来，别每分钟弹一次；文件改动后会重新问
      for (const item of files) this.skipped.add(this.fileKey(item.file));
      return;
    }

    accounts.add(picked);
    for (const item of files) {
      this.skipped.delete(this.fileKey(item.file));
      const outcome = await this.importText(item.file, item.text, picked, seen);
      this.tally(result, outcome, item.file.name, failures);
      if (outcome.created > 0 || outcome.skipped > 0) {
        this.host.learnRule?.({
          signature: item.signature,
          account: picked,
          sample: headerOf(item.text).slice(0, 6).join(","),
          at: new Date().toISOString(),
        });
      }
    }
    result.pending = 0;

    if (result.created > 0) {
      this.host.onImported();
      new Notice(`交易日志：${result.created} 笔已归到 ${picked}，下次同类文件会自动归户`);
    }
  }

  private tally(
    result: InboxScanResult,
    outcome: ImportOutcome,
    name: string,
    failures: string[]
  ): void {
    result.created += outcome.created;
    result.skipped += outcome.skipped;
    if (outcome.created === 0 && outcome.skipped === 0) {
      result.failed++;
      failures.push(`${name}：${outcome.reason ?? "没有可导入的记录"}`);
    }
  }

  private async readText(file: TFile): Promise<string | null> {
    try {
      const bytes = await this.host.app.vault.readBinary(file);
      return decodeCsv(bytes);
    } catch {
      return null;
    }
  }

  private async importFile(
    file: TFile,
    account: string,
    seen: Set<string>
  ): Promise<ImportOutcome> {
    const text = await this.readText(file);
    if (text === null) {
      await this.reject(file, account, "读取失败");
      return { created: 0, skipped: 0, reason: "读取失败" };
    }
    return this.importText(file, text, account, seen);
  }

  private async importText(
    file: TFile,
    text: string,
    account: string,
    seen: Set<string>
  ): Promise<ImportOutcome> {
    const parsed = parseInboxCsv(text, account);
    if (!parsed.drafts.length) {
      const why = parsed.errors
        .slice(0, 5)
        .map((x) => `第 ${x.row} 行：${x.message}`)
        .join("\n");
      await this.reject(file, account, `没有可导入的记录。\n${why}`);
      const first = parsed.errors[0];
      return {
        created: 0,
        skipped: 0,
        reason: first ? `第 ${first.row} 行：${first.message}` : "没有可导入的记录",
      };
    }

    const fresh: TradeDraft[] = [];
    let skipped = 0;
    for (const d of parsed.drafts) {
      const key = tradeKey(d);
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      fresh.push(d);
    }

    if (!fresh.length) {
      // 数据层面完全重复：挪走，不再写一遍
      await this.accept(file, account);
      return { created: 0, skipped };
    }

    const res = await this.host.store.importDrafts(fresh, []);
    await this.accept(file, account);
    return { created: res.created, skipped: skipped + res.skipped };
  }

  private async accept(file: TFile, account: string): Promise<void> {
    await this.moveTo(`${this.host.inboxPath}/${INBOX_IMPORTED}/${account}`, file);
  }

  private async reject(file: TFile, account: string, reason: string): Promise<void> {
    const dir = `${this.host.inboxPath}/${INBOX_ERROR}/${account || "根目录"}`;
    const moved = await this.moveTo(dir, file);
    try {
      await this.host.app.vault.create(`${dir}/${moved.basename}.log`, `${moved.name}\n\n${reason}\n`);
    } catch {
      // 日志写不进去就算了，文件已经在 _error 里
    }
  }

  private async moveTo(folder: string, file: TFile): Promise<TFile> {
    await this.ensureFolder(folder);
    let target = normalizePath(`${folder}/${file.name}`);
    let n = 1;
    while (this.host.app.vault.getAbstractFileByPath(target)) {
      target = normalizePath(`${folder}/${file.basename}-${n}.${file.extension}`);
      n++;
    }
    await this.host.app.vault.rename(file, target);
    const moved = this.host.app.vault.getAbstractFileByPath(target);
    return moved instanceof TFile ? moved : file;
  }

  private async ensureFolder(path: string): Promise<TFolder | null> {
    const clean = normalizePath(path);
    const existing = this.host.app.vault.getAbstractFileByPath(clean);
    if (existing instanceof TFolder) return existing;

    const parts = clean.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join("/");
      if (!(this.host.app.vault.getAbstractFileByPath(p) instanceof TFolder)) {
        try {
          await this.host.app.vault.createFolder(p);
        } catch {
          // 并发创建，忽略
        }
      }
    }
    const created = this.host.app.vault.getAbstractFileByPath(clean);
    return created instanceof TFolder ? created : null;
  }
}
