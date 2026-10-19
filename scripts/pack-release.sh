#!/usr/bin/env bash
# 打发布包：release/trade-journal/{main.js,manifest.json,styles.css} + 说明 + 示例数据
# 用 python 的 zipfile 而非 zip 命令 —— macOS 自带的 zip 不会给中文文件名打
# UTF-8 标志（bit 11），Windows 上解压会变乱码。
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
OUT="trade-journal-v${VERSION}.zip"

echo "→ 打包 v${VERSION}"

python3 - "$VERSION" "$OUT" <<'PY'
import json, os, shutil, sys, zipfile

version, out = sys.argv[1], sys.argv[2]
root = "release"
plugin = os.path.join(root, "trade-journal")

shutil.rmtree(root, ignore_errors=True)
os.makedirs(plugin, exist_ok=True)

for f in ("main.js", "manifest.json", "styles.css"):
    shutil.copy2(f, os.path.join(plugin, f))

shutil.copy2("安装说明.txt", root)
shutil.copy2(os.path.join("examples", "示例交易.csv"), root)

if os.path.exists(out):
    os.remove(out)

items = []
for dirpath, dirnames, filenames in os.walk(root):
    dirnames[:] = [d for d in dirnames if d != "__MACOSX"]
    for name in sorted(filenames):
        if name == ".DS_Store":
            continue
        full = os.path.join(dirpath, name)
        items.append((full, os.path.relpath(full, root)))

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for full, arc in sorted(items, key=lambda x: x[1]):
        z.write(full, arc)

print(f"  {len(items)} 个文件 → {out}（{os.path.getsize(out) / 1024:.0f} KB）")
PY
