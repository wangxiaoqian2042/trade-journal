/**
 * obsidian 模块的最小替身，仅用于在 node 下测试 store.ts 的读写链路。
 * 通过 esbuild --alias:obsidian=./scripts/obsidian-stub.ts 注入。
 */

export class TAbstractFile {
  path = "";
  name = "";
}

export class TFile extends TAbstractFile {
  extension = "md";
  basename = "";
  constructor(path: string) {
    super();
    this.path = path;
    this.name = path.split("/").pop() ?? path;
    this.basename = this.name.includes(".") ? this.name.replace(/\.[^.]+$/, "") : this.name;
    this.extension = this.name.includes(".") ? this.name.split(".").pop()! : "";
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
  constructor(path: string) {
    super();
    this.path = path;
    this.name = path.split("/").pop() ?? path;
  }
}

export function normalizePath(p: string): string {
  return p
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "");
}

export class FakeVault {
  files = new Map<string, string>();
  folders = new Set<string>();

  async createFolder(path: string) {
    this.folders.add(path);
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    if (this.files.has(path)) return new TFile(path);
    if (this.folders.has(path)) {
      const f = new TFolder(path);
      f.children = this.childrenOf(path);
      return f;
    }
    return null;
  }

  childrenOf(path: string): TAbstractFile[] {
    const out: TAbstractFile[] = [];
    const prefix = path + "/";
    for (const f of this.files.keys()) {
      if (f.startsWith(prefix) && !f.slice(prefix.length).includes("/")) {
        out.push(new TFile(f));
      }
    }
    for (const d of this.folders) {
      if (d.startsWith(prefix) && !d.slice(prefix.length).includes("/")) {
        const folder = new TFolder(d);
        folder.children = this.childrenOf(d);
        out.push(folder);
      }
    }
    return out;
  }

  async create(path: string, data: string) {
    this.files.set(path, data);
    return new TFile(path);
  }

  async read(file: TFile) {
    return this.files.get(file.path) ?? "";
  }

  async cachedRead(file: TFile) {
    return this.read(file);
  }

  async modify(file: TFile, data: string) {
    this.files.set(file.path, data);
  }

  async delete(file: TFile) {
    this.files.delete(file.path);
  }

  async readBinary(file: TFile): Promise<ArrayBuffer> {
    return new TextEncoder().encode(this.files.get(file.path) ?? "").buffer as ArrayBuffer;
  }

  async rename(file: TAbstractFile, newPath: string): Promise<TFile> {
    const data = this.files.get(file.path);
    if (data === undefined) throw new Error(`rename: ${file.path} 不存在`);
    this.files.delete(file.path);
    this.files.set(newPath, data);
    return new TFile(newPath);
  }

  on(_name: string, _cb: unknown): unknown {
    return {};
  }

  offref(_ref: unknown): void {
    // no-op
  }
}

export class Notice {
  constructor(public message?: string) {}
}

export const App = class {};
