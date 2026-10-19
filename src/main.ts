import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf } from "obsidian";
import { JournalView, VIEW_TYPE } from "./views/JournalView";
import { TradeStore } from "./services/store";
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
};

export default class TradeJournalPlugin extends Plugin {
  settings: TradeJournalSettings = DEFAULT_SETTINGS;
  store!: TradeStore;

  private mainLeaf: WorkspaceLeaf | null = null;
  private sideLeaf: WorkspaceLeaf | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.store = new TradeStore(this.app, this.settings.folder);

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

    this.addSettingTab(new TradeJournalSettingTab(this.app, this));
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
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
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.store = new TradeStore(this.app, this.settings.folder);
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
            for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
              if (leaf.view instanceof JournalView) void leaf.view.reload();
            }
          })
      );

    new Setting(containerEl)
      .setName("数据说明")
      .setDesc(
        "每笔交易是目录里的一个 .md 文件，字段存在 frontmatter，正文是你的复盘笔记。可以直接在 Obsidian 里编辑，也可以同步/备份。"
      );
  }
}
