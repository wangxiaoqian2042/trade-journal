import { App, TFile, TFolder, normalizePath } from "obsidian";
import { Session, Trade, TradeDraft, tradeKey } from "../types";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter";
import { sessionOf } from "./query";
import { accountFolder, noteFilePath } from "./paths";
import { classifyPnl } from "./analytics";

function num(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.\-]/g, ""));
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return fallback;
}

function str(v: unknown, fallback = ""): string {
  if (v === null || v === undefined) return fallback;
  return String(v);
}

/** HH:mm[:ss] → 当天的秒数 */
function secondsOfDay(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const s = m[3] ? Number(m[3]) : 0;
  if (h > 23 || mi > 59 || s > 59) return null;
  return h * 3600 + mi * 60 + s;
}

/**
 * 持有时长（秒）。跨夜交易（21:55 开、次日 02:10 平）靠"平仓早于开仓就加一天"处理，
 * 期货夜盘基本都是这种情况，不能直接相减。
 */
function holdSeconds(date: string, entryTime: string, exitTime: string): number | null {
  const a = secondsOfDay(entryTime);
  const b = secondsOfDay(exitTime);
  if (a === null || b === null) return null;
  const diff = b >= a ? b - a : b + 86400 - a;
  // 超过 3 天视为跨日数据缺失，不做猜测
  if (diff <= 0 || diff > 3 * 86400) return null;
  void date;
  return diff;
}

function toTrade(
  path: string,
  data: Record<string, unknown>,
  body: string,
  breakEven = 0
): Trade | null {
  const symbol = str(data.symbol).trim();
  if (!symbol) return null;
  const direction = str(data.direction).toLowerCase() === "short" ? "short" : "long";
  const time = str(data.time);
  const exitTime = str(data.exitTime).trim();
  const storedHold = data.holdSeconds === undefined || data.holdSeconds === null ? null : num(data.holdSeconds);
  const session: Session = sessionOf(time);
  const pnl = num(data.pnl);

  return {
    id: path,
    date: str(data.date).slice(0, 10),
    time,
    symbol,
    direction,
    entry: num(data.entry),
    exit: num(data.exit),
    quantity: num(data.quantity),
    fees: num(data.fees),
    pnl,
    setup: str(data.setup),
    account: str(data.account),
    stop: data.stop === undefined || data.stop === null ? null : num(data.stop),
    target: data.target === undefined || data.target === null ? null : num(data.target),
    exitTime: exitTime || undefined,
    holdSeconds: storedHold ?? (exitTime ? holdSeconds(str(data.date), time, exitTime) : null),
    session,
    outcome: classifyPnl(pnl, breakEven),
    tags: Array.isArray(data.tags) ? data.tags.map((t) => String(t)) : [],
    notes: body.trim(),
  };
}


export class TradeStore {
  constructor(private app: App, public folder: string, public breakEven = 0) {}

  get basePath(): string {
    return normalizePath(this.folder.trim() || "Trading");
  }

  async ensureFolder(target?: string): Promise<void> {
    const path = normalizePath(target ?? this.basePath);
    // 账户子目录可能带上级，逐层建，避免父目录不存在时 createFolder 报错
    const parts = path.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join("/");
      const existing = this.app.vault.getAbstractFileByPath(p);
      if (existing instanceof TFolder) continue;
      try {
        await this.app.vault.createFolder(p);
      } catch {
        // 已存在或并发创建，忽略
      }
    }
  }

  /** 递归读取目录下所有交易笔记 */
  async loadAll(): Promise<Trade[]> {
    await this.ensureFolder();
    const root = this.app.vault.getAbstractFileByPath(this.basePath);
    if (!(root instanceof TFolder)) return [];

    const files: TFile[] = [];
    const walk = (folder: TFolder) => {
      for (const child of folder.children) {
        if (child instanceof TFolder) walk(child);
        else if (child instanceof TFile && child.extension === "md") files.push(child);
      }
    };
    walk(root);

    const trades: Trade[] = [];
    for (const file of files) {
      try {
        // cachedRead 对刚写入的文件可能拿到空的旧缓存，兜底走一次真实读取
        let raw = await this.app.vault.cachedRead(file);
        if (!raw || !raw.trim()) {
          raw = await this.app.vault.read(file);
        }
        const { data, body } = parseFrontmatter(raw);
        const t = toTrade(file.path, data, body, this.breakEven);
        if (t) trades.push(t);
      } catch {
        // 单个文件坏了不影响整体
      }
    }
    return trades.sort((a, b) =>
      (a.date + a.time).localeCompare(b.date + b.time)
    );
  }

  private filename(d: TradeDraft): string {
    return normalizePath(noteFilePath(this.basePath, d));
  }

  private serialize(d: TradeDraft): string {
    const gross = (d.exit - d.entry) * d.quantity * (d.direction === "long" ? 1 : -1);
    return stringifyFrontmatter(
      {
        type: "trade",
        date: d.date,
        time: d.time || undefined,
        exitTime: d.exitTime || undefined,
        symbol: d.symbol,
        direction: d.direction,
        entry: d.entry,
        exit: d.exit,
        quantity: d.quantity,
        fees: d.fees,
        pnl: Number.isFinite(d.pnl) ? d.pnl : gross - d.fees,
        setup: d.setup || undefined,
        account: d.account || undefined,
        stop: d.stop ?? undefined,
        target: d.target ?? undefined,
        tags: d.tags.length ? d.tags : ["trade"],
        created: new Date().toISOString().slice(0, 19),
      },
      d.notes
    );
  }

  /** 批量写入，返回实际新建数量（按 tradeKey 去重） */
  async importDrafts(
    drafts: TradeDraft[],
    existing: Trade[]
  ): Promise<{ created: number; skipped: number }> {
    await this.ensureFolder();
    const seen = new Set(existing.map(tradeKey));
    let created = 0;
    let skipped = 0;

    for (const draft of drafts) {
      const key = tradeKey(draft);
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      const acct = accountFolder(draft.account);
      if (acct) await this.ensureFolder(`${this.basePath}/${acct}`);
      let path = this.filename(draft);
      let n = 1;
      while (this.app.vault.getAbstractFileByPath(path)) {
        path = path.replace(/(-\d+)?\.md$/, `-${n}.md`);
        n++;
      }
      await this.app.vault.create(path, this.serialize(draft));
      seen.add(key);
      created++;
    }
    return { created, skipped };
  }

  async updateNotes(trade: Trade, notes: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(trade.id);
    if (!(file instanceof TFile)) return;
    const raw = await this.app.vault.read(file);
    const { data } = parseFrontmatter(raw);
    await this.app.vault.modify(file, stringifyFrontmatter(data, notes));
  }

  /** 只改策略字段，正文和其它字段原样保留 */
  async updateSetup(trade: Trade, setup: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(trade.id);
    if (!(file instanceof TFile)) throw new Error(`找不到 ${trade.id}`);
    const raw = await this.app.vault.read(file);
    const { data, body } = parseFrontmatter(raw);
    if (setup.trim()) data.setup = setup.trim();
    else delete data.setup;
    await this.app.vault.modify(file, stringifyFrontmatter(data, body));
  }

  /** 批量改策略，单条失败不中断整批 */
  async updateSetupMany(
    trades: Trade[],
    setup: string
  ): Promise<{ updated: number; failed: number }> {
    let updated = 0;
    let failed = 0;
    for (const t of trades) {
      try {
        await this.updateSetup(t, setup);
        updated++;
      } catch {
        failed++;
      }
    }
    return { updated, failed };
  }

  async remove(trade: Trade): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(trade.id);
    if (!(file instanceof TFile)) return;
    await this.trashFile(file);
  }

  /**
   * 批量删除。逐条走回收站而不是直接抹掉 —— 交易笔记是用户手写的复盘，
   * 一次误选几十条不可逆的代价太大。
   */
  async removeMany(trades: Trade[]): Promise<{ removed: number; failed: number }> {
    let removed = 0;
    let failed = 0;
    for (const t of trades) {
      const file = this.app.vault.getAbstractFileByPath(t.id);
      if (!(file instanceof TFile)) {
        failed++;
        continue;
      }
      try {
        await this.trashFile(file);
        removed++;
      } catch {
        failed++;
      }
    }
    return { removed, failed };
  }

  /** 先进 Obsidian 回收站，不行再试系统废纸篓，最后才硬删 */
  private async trashFile(file: TFile): Promise<void> {
    try {
      await this.app.vault.trash(file, false);
      return;
    } catch {
      /* 继续降级 */
    }
    try {
      await this.app.vault.trash(file, true);
      return;
    } catch {
      /* 继续降级 */
    }
    await this.app.vault.delete(file);
  }
}
