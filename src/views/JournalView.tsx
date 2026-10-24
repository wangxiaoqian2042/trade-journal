import { ItemView, Notice, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import React from "react";
import { createRoot, Root } from "react-dom/client";
import type TradeJournalPlugin from "../main";
import { JournalApp, Tab } from "../components/JournalApp";
import { Trade, TradeDraft } from "../types";

export const VIEW_TYPE = "trade-journal-view";

export class JournalView extends ItemView {
  private root: Root | null = null;
  private trades: Trade[] = [];
  private loading = false;
  private tab: Tab = "dashboard";
  private mountEl: HTMLElement | null = null;
  private debounceId = 0;
  private pendingReload = false;

  constructor(leaf: WorkspaceLeaf, private plugin: TradeJournalPlugin) {
    super(leaf);
    // 放在主区域时显示前进/后退导航头
    this.navigation = true;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "交易日志";
  }

  getIcon(): string {
    return "chart-line";
  }

  async onOpen(): Promise<void> {
    this.mount();
    this.renderApp();
    await this.reload();

    // Obsidian 在主区域⇄侧边栏之间搬动视图、重载插件、恢复工作区时，可能换掉
    // contentEl 或清空里面的节点。React 根还挂在旧节点上，屏幕上看就是整块空白
    // （像是"仪表盘缺失"），开个新标签页或重启才好。这里在布局变化后自检一次。
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        if (!this.mountEl || this.mountEl !== this.contentEl || !this.contentEl.childElementCount) {
          this.renderApp();
        }
      })
    );

    const onChange = (file: TAbstractFile) => {
      if (!file.path.startsWith(this.plugin.store.basePath)) return;
      window.clearTimeout(this.debounceId);
      this.debounceId = window.setTimeout(() => void this.reload(), 400);
    };
    this.debounceId = 0;
    this.registerEvent(this.app.vault.on("modify", onChange));
    this.registerEvent(this.app.vault.on("create", onChange));
    this.registerEvent(this.app.vault.on("delete", onChange));

    // 侧边栏 ⇄ 主区域一键切换
    const inSidebar = !!this.containerEl.closest(".mod-sidedock, .mod-right-split, .mod-left-split");
    if (inSidebar) {
      this.addAction("maximize", "在主区域打开", () =>
        void this.plugin.activate(this.tab, "main")
      );
    } else {
      this.addAction("panel-right", "在右侧边栏打开", () =>
        void this.plugin.activate(this.tab, "side")
      );
    }
  }

  async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
    this.mountEl = null;
  }

  setTab(tab: Tab): void {
    this.tab = tab;
    this.renderApp();
  }

  async reload(): Promise<void> {
    // 正在读的时候再来一次请求，标记下来，读完补跑，避免导入后界面不刷新
    if (this.loading) {
      this.pendingReload = true;
      return;
    }
    this.loading = true;
    this.renderApp();
    try {
      this.trades = await this.plugin.store.loadAll();
    } catch (e) {
      console.error("[trade-journal] 读取交易记录失败", e);
    } finally {
      this.loading = false;
      this.renderApp();
      if (this.pendingReload) {
        this.pendingReload = false;
        void this.reload();
      }
    }
  }

  /**
   * 确保 React 根挂在当前的 contentEl 上。
   * 容器被 Obsidian 换掉、或里面的 DOM 被清空时，卸掉旧根重新挂载。
   * 注意不能用 isConnected 判断：非激活标签页的节点本来就可能脱离文档，
   * 那种情况下 React 根是好的，重挂反而会丢状态、造成无谓重整。
   */
  private mount(): boolean {
    const el = this.contentEl;
    if (!el) return false;
    if (this.root && this.mountEl === el && el.childElementCount > 0) return true;

    this.root?.unmount();
    this.root = null;
    el.empty();
    el.addClass("tj-mount");
    this.mountEl = el;
    this.root = createRoot(el);
    return true;
  }

  private renderApp(): void {
    if (!this.mount()) return;
    this.root!.render(
      <JournalApp
        trades={this.trades}
        currency={this.plugin.settings.currency}
        initialTab={this.tab}
        loading={this.loading}
        onReload={() => void this.reload()}
        onImport={async (drafts: TradeDraft[]) => {
          const r = await this.plugin.store.importDrafts(drafts, this.trades);
          if (r.created > 0) await this.reload();
          return r;
        }}
        onDelete={async (t: Trade) => {
          await this.plugin.store.remove(t);
          await this.reload();
        }}
        onDeleteMany={async (ts: Trade[]) => {
          const r = await this.plugin.store.removeMany(ts);
          if (r.failed > 0) {
            // 有失败的要让用户知道，不要静默吞掉
            new Notice(`已删除 ${r.removed} 笔，${r.failed} 笔未找到或删除失败`);
          }
          await this.reload();
        }}
        onSetSetup={async (ts: Trade[], setup: string) => {
          const r = await this.plugin.store.updateSetupMany(ts, setup);
          if (r.failed > 0) {
            new Notice(`已更新 ${r.updated} 笔，${r.failed} 笔写入失败`);
          }
          await this.reload();
        }}
        onOpen={(t: Trade) => {
          const file = this.app.vault.getAbstractFileByPath(t.id);
          if (file instanceof TFile) {
            void this.app.workspace.getLeaf(false).openFile(file);
          }
        }}
        cardIds={this.plugin.settings.metricCards}
        layout={this.plugin.settings.layout}
        onLayoutChange={(next) => {
          this.plugin.settings.layout = next;
          void this.plugin.saveSettings().then(() => this.renderApp());
        }}
        onCardsChange={(ids: string[]) => {
          this.plugin.settings.metricCards = ids;
          void this.plugin.saveSettings().then(() => this.renderApp());
        }}
      />
    );
  }
}
