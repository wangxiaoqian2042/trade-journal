import { App, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf } from "obsidian";
import { JournalView, VIEW_TYPE } from "./views/JournalView";
import { TradeStore } from "./services/store";
import { InboxWatcher } from "./services/InboxWatcher";
import { InboxRule } from "./services/inbox";
import { AccountPickerModal } from "./components/AccountPickerModal";
import { DEFAULT_LAYOUT, WidgetLayout, normalizeLayout } from "./services/layout";
import type { Tab } from "./components/JournalApp";

/** main = 主区域新标签页；side = 右侧边栏 */
type Placement = "main" | "side";

interface TradeJournalSettings {
  folder: string;
  currency: string;
  /** 点击丝带/默认命令时在哪里打开 */
  openInMainArea: boolean;
  /** 仪表盘上显示哪些指标卡，按数组顺序排列 */
  metricCards: string[];
  /** 仪表盘组件顺序与尺寸 */
  layout: WidgetLayout[];
  /** 打平区间：|pnl| ≤ 这个值算打平，不计入胜负 */
  breakEven: number;
  /** 自动扫描收件箱（vault 内的 _inbox 目录） */
  inboxEnabled: boolean;
  /** 收件箱目录名，相对交易笔记目录 */
  inboxName: string;
  /** 学会的归户规则：某种表头格式默认归到哪个账户 */
  inboxRules: InboxRule[];
}

const DEFAULT_SETTINGS: TradeJournalSettings = {
  folder: "Trading",
  currency: "¥",
  openInMainArea: true,
  metricCards: [
    "netPnL",
    "numTrades",
    "winRate",
    "profitFactor",
    "expectancy",
    "maxDrawdown",
  ],
  layout: DEFAULT_LAYOUT,
  breakEven: 0,
  inboxEnabled: true,
  inboxName: "_inbox",
  inboxRules: [],
};

export default class TradeJournalPlugin extends Plugin {
  settings: TradeJournalSettings = DEFAULT_SETTINGS;
  store!: TradeStore;

  private mainLeaf: WorkspaceLeaf | null = null;
  private sideLeaf: WorkspaceLeaf | null = null;
  private inbox: InboxWatcher | null = null;
  private inboxPathCached = "";

  async onload(): Promise<void> {
    await this.loadSettings();
    this.store = new TradeStore(this.app, this.settings.folder, this.settings.breakEven);

    this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => new JournalView(leaf, this));

    this.addRibbonIcon("chart-line", "交易日志", () => void this.activate());
    this.addCommand({
      id: "open-journal",
      name: "打开交易日志",
      callback: () => void this.activate(),
    });
    this.addCommand({
      id: "open-journal-main",
      name: "在主区域（新标签页）打开交易日志",
      callback: () => void this.activate(undefined, "main"),
    });
    this.addCommand({
      id: "open-journal-side",
      name: "在右侧边栏打开交易日志",
      callback: () => void this.activate(undefined, "side"),
    });
    this.addCommand({
      id: "import-csv",
      name: "导入 CSV 交易记录",
      callback: () => void this.activate("import"),
    });

    this.addCommand({
      id: "scan-inbox",
      name: "立即扫描导入收件箱",
      callback: () => void this.scanInbox(true),
    });

    this.addSettingTab(new TradeJournalSettingTab(this.app, this));
    this.syncInbox();
  }

  onunload(): void {
    this.inbox?.stop();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  /** 收件箱路径：vault 内的 <交易目录>/<收件箱名> */
  get inboxPath(): string {
    return `${this.store.basePath}/${(this.settings.inboxName || "_inbox").trim()}`;
  }

  /**
   * 按设置同步监听器。设置改动很频繁（改货币也会触发保存），
   * 所以只有开关或路径变了才真的重启，避免每次按键都全量扫一遍。
   */
  private syncInbox(): void {
    const want = this.settings.inboxEnabled;
    const path = this.inboxPath;

    if (this.inbox && (!want || path !== this.inboxPathCached)) {
      this.inbox.stop();
      this.inbox = null;
    }
    if (!this.inbox && want) {
      this.inbox = new InboxWatcher({
        app: this.app,
        store: this.store,
        inboxPath: path,
        onImported: () => this.reloadViews(),
        getRules: () => this.settings.inboxRules ?? [],
        learnRule: (rule) => {
          // 同一格式只留最后一条；上限 30 条，防止无限增长
          const rest = (this.settings.inboxRules ?? []).filter((r) => r.signature !== rule.signature);
          this.settings.inboxRules = [...rest, rule].slice(-30);
          // 只存配置，不重启监听
          void this.saveData(this.settings);
        },
        askAccount: (files, accounts) =>
          new Promise<string | null>((resolve) => {
            new AccountPickerModal(this.app, {
              files,
              accounts,
              onPick: (picked) => resolve(picked),
            }).open();
          }),
      });
      this.inbox.start();
    }
    this.inboxPathCached = path;
  }

  async scanInbox(notify = false): Promise<void> {
    if (!this.inbox) {
      if (notify) new Notice("交易日志：自动导入未启用，先在设置里打开");
      return;
    }
    const r = await this.inbox.scan();
    if (notify) {
      new Notice(
        r.files === 0
          ? "交易日志：收件箱是空的"
          : `交易日志：${r.files} 个文件，新增 ${r.created} 笔，跳过重复 ${r.skipped} 笔，失败 ${r.failed} 个`
      );
    }
  }

  private alive(l: WorkspaceLeaf | null): l is WorkspaceLeaf {
    return !!l && l.view?.getViewType?.() === VIEW_TYPE;
  }

  private async create(placement: Placement): Promise<WorkspaceLeaf> {
    const leaf =
      placement === "main"
        ? this.app.workspace.getLeaf("tab")
        : this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    if (placement === "main") this.mainLeaf = leaf;
    else this.sideLeaf = leaf;
    return leaf;
  }

  /**
   * 打开交易日志。
   * @param tab 初始页签
   * @param placement 指定位置；不传则按设置，且已有视图时直接复用
   */
  async activate(tab?: Tab, placement?: Placement): Promise<void> {
    const want: Placement = placement ?? (this.settings.openInMainArea ? "main" : "side");
    let leaf: WorkspaceLeaf | null = null;

    if (placement) {
      // 明确指定位置：只复用那个位置的视图，没有就新建
      const cached = want === "main" ? this.mainLeaf : this.sideLeaf;
      if (this.alive(cached)) leaf = cached;
    } else {
      // 默认行为：已经开着就切过去，不再开第二个
      for (const l of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
        if (this.alive(l)) {
          leaf = l;
          break;
        }
      }
    }

    if (!leaf) leaf = await this.create(want);

    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof JournalView && tab) {
      leaf.view.setTab(tab);
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // 配置可能来自旧版本或被手改过，统一清洗一次
    this.settings.layout = normalizeLayout(this.settings.layout);
    const be = Number(this.settings.breakEven);
    this.settings.breakEven = Number.isFinite(be) && be > 0 ? be : 0;
    if (!Array.isArray(this.settings.inboxRules)) this.settings.inboxRules = [];
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.store = new TradeStore(this.app, this.settings.folder, this.settings.breakEven);
    this.syncInbox();
  }

  /** 设置改了影响已渲染的数据时，让所有打开的视图重新读一遍 */
  reloadViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof JournalView) void leaf.view.reload();
    }
  }
}

class TradeJournalSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: TradeJournalPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("默认打开位置")
      .setDesc(
        "主区域：占满中间的编辑区，适合看图表；右侧边栏：一直挂在右边，边看 K 线边记。两个位置都能随时切换（视图右上角有按钮）。"
      )
      .addDropdown((d) =>
        d
          .addOption("main", "主区域（新标签页）")
          .addOption("side", "右侧边栏")
          .setValue(this.plugin.settings.openInMainArea ? "main" : "side")
          .onChange(async (v) => {
            this.plugin.settings.openInMainArea = v === "main";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("交易笔记目录")
      .setDesc("交易记录会以 Markdown 形式保存在 vault 的这个目录下")
      .addText((t) =>
        t
          .setPlaceholder("Trading")
          .setValue(this.plugin.settings.folder)
          .onChange(async (v) => {
            this.plugin.settings.folder = v.trim() || "Trading";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("货币符号")
      .setDesc("显示盈亏时使用的前缀，例如 ¥ 或 $")
      .addText((t) =>
        t
          .setPlaceholder("¥")
          .setValue(this.plugin.settings.currency)
          .onChange(async (v) => {
            this.plugin.settings.currency = v.trim() || "¥";
            await this.plugin.saveSettings();
            this.plugin.reloadViews();
          })
      );

    new Setting(containerEl)
      .setName("打平区间")
      .setDesc(
        "单笔盈亏落在这个范围内算打平，不计入胜率、也不打断连胜连亏。填 0 表示只有刚好 0 才算平。" +
          "期货建议填 1–2 个最小跳动乘合约乘数（MNQ 约 10，MES 约 6），把手续费级别的噪音挡掉。"
      )
      .addText((t) =>
        t
          .setPlaceholder("0")
          .setValue(String(this.plugin.settings.breakEven || 0))
          .onChange(async (v) => {
            const n = Number(v.replace(/[^0-9.]/g, ""));
            this.plugin.settings.breakEven = Number.isFinite(n) && n > 0 ? n : 0;
            await this.plugin.saveSettings();
            this.plugin.reloadViews();
          })
      );

    new Setting(containerEl)
      .setName("自动导入收件箱")
      .setDesc(
        "把券商导出的 CSV 放进「交易笔记目录/_inbox/账户名/」，插件会自动导入，成功后把文件挪到 _imported。" +
          "目录名就是账户名，不用给文件改名；同一笔数据重复出现会被去重挡掉。"
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.inboxEnabled).onChange(async (v) => {
          this.plugin.settings.inboxEnabled = v;
          await this.plugin.saveSettings();
        })
      )
      .addButton((b) =>
        b.setButtonText("立即扫描").onClick(async () => {
          await this.plugin.scanInbox(true);
        })
      );

    new Setting(containerEl)
      .setName("收件箱目录名")
      .setDesc("相对「交易笔记目录」，默认 _inbox")
      .addText((t) =>
        t
          .setPlaceholder("_inbox")
          .setValue(this.plugin.settings.inboxName)
          .onChange(async (v) => {
            this.plugin.settings.inboxName = v.trim() || "_inbox";
            await this.plugin.saveSettings();
          })
      );

    const rules = this.plugin.settings.inboxRules ?? [];
    new Setting(containerEl)
      .setName("归户规则")
      .setDesc(
        rules.length
          ? "根目录文件按表头格式自动归户。删掉某条后，同类文件会重新弹窗询问。"
          : "还没有规则。把文件放进 _inbox 根目录并选一次账户，就会自动记住这种格式。"
      );

    for (const rule of rules) {
      new Setting(containerEl)
        .setName(rule.account)
        .setDesc(`表头：${rule.sample || "（无）"}`)
        .addButton((b) =>
          b
            .setButtonText("删除")
            .setWarning()
            .onClick(async () => {
              this.plugin.settings.inboxRules = (this.plugin.settings.inboxRules ?? []).filter(
                (r) => r.signature !== rule.signature
              );
              await this.plugin.saveSettings();
              this.display();
            })
        );
    }

    new Setting(containerEl)
      .setName("数据说明")
      .setDesc(
        "每笔交易是目录里的一个 .md 文件，字段存在 frontmatter，正文是你的复盘笔记。可以直接在 Obsidian 里编辑，也可以同步/备份。"
      );
  }
}
