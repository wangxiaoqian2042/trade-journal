import { App, EventRef, Notice, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { TradeStore } from "./store";
import { TradeDraft, tradeKey } from "../types";
import {
  CSV_EXTENSIONS,
  INBOX_ERROR,
  INBOX_IMPORTED,
  decodeCsv,
  isInsideInbox,
  isWorkFolder,
  parseInboxCsv,
} from "./inbox";

/**
 * 收件箱监听。
 *
 * 只在 vault 内活动：不碰文件系统 API，桌面版和手机版都能用。
 * 触发点有三个：插件加载、vault 里新建/移入文件、每 60 秒兜底扫一次。
 */

export interface InboxHost {
  app: App;
  store: TradeStore;
  /** vault 内的收件箱路径，如 Trading/_inbox */
  inboxPath: string;
  /** 有交易写入后回调（刷新已打开的视图） */
  onImported: () => void;
}

export interface InboxScanResult {
  files: number;
  created: number;
  skipped: number;
  failed: number;
}

export class InboxWatcher {
  private refs: EventRef[] = [];
  private timer: number | null = null;
  private debounce: number | null = null;
  private busy = false;
  private started = false;

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
  private schedule(): void {
    if (this.debounce !== null) window.clearTimeout(this.debounce);
    this.debounce = window.setTimeout(() => {
      this.debounce = null;
      void this.scan();
    }, 1500);
  }

  async scan(): Promise<InboxScanResult> {
    const empty: InboxScanResult = { files: 0, created: 0, skipped: 0, failed: 0 };
    if (this.busy) return empty;
    this.busy = true;
    try {
      const root = await this.ensureFolder(this.host.inboxPath);
      if (!root) return empty;

      // _imported / _error 等到真的要用时再建，避免空目录污染 vault
      const result: InboxScanResult = { ...empty };
      const existing = await this.host.store.loadAll();
      const seen = new Set(existing.map(tradeKey));

      for (const child of [...root.children]) {
        // 根目录直接放文件：不知道属于哪个账户，挪到 _error 并说明原因
        if (child instanceof TFile) {
          if (!CSV_EXTENSIONS.includes(child.extension.toLowerCase())) continue;
          result.files++;
          result.failed++;
          await this.reject(child, "", "请把文件放进账户子目录，例如 _inbox/AMP/，目录名就是账户名");
          continue;
        }
        if (!(child instanceof TFolder) || isWorkFolder(child.name)) continue;

        const account = child.name.trim();
        for (const item of [...child.children]) {
          if (!(item instanceof TFile)) continue;
          if (!CSV_EXTENSIONS.includes(item.extension.toLowerCase())) continue;

          result.files++;
          const ok = await this.importFile(item, account, seen);
          if (ok.created > 0) {
            result.created += ok.created;
            result.skipped += ok.skipped;
          } else if (ok.skipped > 0) {
            result.skipped += ok.skipped;
          } else {
            result.failed++;
          }
        }
      }

      if (result.created > 0) {
        this.host.onImported();
        new Notice(`交易日志：自动导入 ${result.created} 笔（跳过重复 ${result.skipped} 笔）`);
      } else if (result.failed > 0) {
        new Notice(`交易日志：${result.failed} 个文件没能导入，详情见 _inbox/_error/`);
      }
      return result;
    } finally {
      this.busy = false;
    }
  }

  private async importFile(
    file: TFile,
    account: string,
    seen: Set<string>
  ): Promise<{ created: number; skipped: number }> {
    let text: string;
    try {
      const bytes = await this.host.app.vault.readBinary(file);
      text = decodeCsv(bytes);
    } catch (e) {
      await this.reject(file, account, `读取失败：${String(e)}`);
      return { created: 0, skipped: 0 };
    }

    const parsed = parseInboxCsv(text, account);
    if (!parsed.drafts.length) {
      const why = parsed.errors.slice(0, 5).map((x) => `第 ${x.row} 行：${x.message}`).join("\n");
      await this.reject(file, account, `没有可导入的记录。\n${why}`);
      return { created: 0, skipped: 0 };
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
      // 数据层面完全重复：直接挪走，不再重复写入
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
