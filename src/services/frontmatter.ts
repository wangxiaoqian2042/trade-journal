/**
 * 极简 YAML frontmatter 读写。
 * 只处理交易日志会用到的一层 key/value + 字符串数组，不引入 yaml 依赖。
 */

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseScalar(raw: string): unknown {
  const v = raw.trim();
  if (v === "") return "";
  if (v.startsWith('"') && v.endsWith('"') && v.length > 1) {
    return v
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\\n/g, "\n");
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length > 1) {
    return v.slice(1, -1).replace(/''/g, "'");
  }
  if (v === "null" || v === "~") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (v.startsWith("[") && v.endsWith("]")) {
    return v
      .slice(1, -1)
      .split(",")
      .map((s) => parseScalar(s))
      .filter((s) => s !== "" && s !== null);
  }
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

export function parseFrontmatter(content: string): {
  data: Record<string, unknown>;
  body: string;
} {
  const m = FM_RE.exec(content);
  if (!m) return { data: {}, body: content };

  const data: Record<string, unknown> = {};
  const lines = m[1].split(/\r?\n/);
  let listKey: string | null = null;

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && listKey) {
      const arr = (data[listKey] as unknown[]) ?? [];
      arr.push(parseScalar(listItem[1]));
      data[listKey] = arr;
      continue;
    }

    const kv = /^([A-Za-z0-9_\u4e00-\u9fa5-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const rest = kv[2];
    if (rest === "") {
      listKey = key;
      if (!(key in data)) data[key] = [];
      continue;
    }
    listKey = null;
    data[key] = parseScalar(rest);
  }

  return { data, body: content.slice(m[0].length) };
}

function q(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

export function stringifyFrontmatter(
  data: Record<string, unknown>,
  body = ""
): string {
  const out: string[] = ["---"];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      out.push(`${k}:`);
      for (const item of v) out.push(`  - ${q(String(item))}`);
      continue;
    }
    if (typeof v === "number") {
      if (!Number.isFinite(v)) continue;
      out.push(`${k}: ${v}`);
      continue;
    }
    if (typeof v === "boolean") {
      out.push(`${k}: ${v}`);
      continue;
    }
    const text =
      typeof v === "string"
        ? v
        : typeof v === "number" || typeof v === "boolean"
          ? String(v)
          : (JSON.stringify(v) ?? "");
    out.push(`${k}: ${q(text)}`);
  }
  out.push("---");
  const trimmed = body.replace(/^\s+/, "");
  return out.join("\n") + "\n" + (trimmed ? trimmed + "\n" : "");
}
