import { App, Modal } from "obsidian";

/**
 * 收件箱根目录出现「不知道属于哪个账户」的文件时，问一次。
 *
 * 只用原生 DOM 和 Obsidian 自带的按钮样式：这个弹窗渲染在 .tj-root 之外，
 * 插件自己的 CSS 变量拿不到，写自定义样式反而容易和主题打架。
 */
export interface AccountPickerOptions {
  files: string[];
  accounts: string[];
  onPick: (account: string | null) => void;
}

export class AccountPickerModal extends Modal {
  private answered = false;

  constructor(
    app: App,
    private opts: AccountPickerOptions
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "这笔文件归到哪个账户？" });

    const list = contentEl.createEl("p", { cls: "setting-item-description" });
    list.setText(
      this.opts.files.length === 1
        ? this.opts.files[0]
        : `${this.opts.files.slice(0, 3).join("、")}${this.opts.files.length > 3 ? ` 等 ${this.opts.files.length} 个文件` : ""}`
    );

    if (this.opts.accounts.length) {
      const row = contentEl.createDiv();
      row.style.display = "flex";
      row.style.flexWrap = "wrap";
      row.style.gap = "8px";
      row.style.margin = "12px 0";
      for (const account of this.opts.accounts) {
        const btn = row.createEl("button", { text: account, cls: "mod-cta" });
        btn.onclick = () => this.finish(account);
      }
    }

    const newRow = contentEl.createDiv();
    newRow.style.display = "flex";
    newRow.style.gap = "8px";
    newRow.style.alignItems = "center";
    newRow.style.marginTop = "8px";

    const input = newRow.createEl("input", { type: "text" });
    input.placeholder = "或输入新账户名";
    input.style.flex = "1";

    const add = newRow.createEl("button", { text: "新建并导入" });
    const submit = () => {
      const name = input.value.trim();
      if (name) this.finish(name);
    };
    add.onclick = submit;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });

    const hint = contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "选一次会记住这种文件格式，下次自动归到同一个账户。想改：设置 → 第三方插件 → Trade Journal → 归户规则。",
    });
    hint.style.marginTop = "12px";

    const foot = contentEl.createDiv();
    foot.style.display = "flex";
    foot.style.justifyContent = "flex-end";
    foot.style.marginTop = "8px";
    const skip = foot.createEl("button", { text: "稍后处理" });
    skip.onclick = () => this.finish(null);
  }

  onClose(): void {
    this.contentEl.empty();
    // 点遮罩或按 Esc 关掉，等同「稍后处理」：文件留在原处，不会被挪走
    if (!this.answered) this.opts.onPick(null);
  }

  private finish(account: string | null): void {
    this.answered = true;
    this.opts.onPick(account);
    this.close();
  }
}
