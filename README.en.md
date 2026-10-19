# Trade Journal for Obsidian

A local-first trading journal that lives inside your Obsidian vault. Every trade is a Markdown file you own; every statistic is computed on your machine. No account, no telemetry, no server.

> 中文说明见 [README.md](README.md)

![Dashboard](docs/screenshots/dashboard.png)

## Why another trading journal

Most journaling tools want your data in their database. This one keeps it in plain Markdown with YAML frontmatter, so your trade log is:

- **Portable** — sync it, back it up, `git` it, edit it in any text editor
- **Durable** — no vendor, no export button needed, no format migration
- **Queryable** — grep it, script it, build your own reports on top

The plugin adds the analytics layer: dashboard, calendar, equity curve, grouping and filters — all read-only over those files.

## Features

**CSV import in two shapes**
- One row = one completed round trip (the usual export)
- One row = one order/fill (e.g. futures "order history"), automatically FIFO-paired into round trips, with contract multipliers for MNQ / MES / NQ / ES / CL and friends
- Column auto-detection with aliases in English and Chinese, camelCase aware, plus a manual mapping UI with a live preview before importing

**Dashboard**
- 21 selectable metrics: net P&L, win rate, profit factor, expectancy, max drawdown, streaks, average hold time, and more
- Comparison against the previous equivalent period (vs. yesterday / last week / last month / last quarter / last year)
- 8 presets: today, yesterday, this week, month, quarter, year, all, custom range

**Layout you control**
- Drag cards by their header to reorder, drag the corner handle to resize
- 12-column grid that degrades to 8 / 6 / 4 columns as the pane narrows, so the same layout works in the main area and in a 340 px sidebar
- Layout and card selection persist per vault

**Charts and drill-down**
- Equity curve, underwater/drawdown curve, monthly P&L calendar with ISO week numbers, weekday and symbol breakdowns
- Click a calendar day, a breakdown row, or a long/short card to jump to the filtered trade list; click a point on a curve to open that trade's note

**Trade log**
- Sort, filter by date range / symbol / setup / account / direction
- Multi-select with select-all-over-the-current-filter, then bulk delete (goes to trash, recoverable) or bulk-tag a setup
- Double-click a row to open the underlying Markdown file

## Install

Requires Obsidian **1.5.0+**. Works on desktop and mobile.

1. Download `trade-journal-v0.1.0.zip` from [Releases](../../releases), or clone and build (`npm i && npm run build`).
2. Unzip and copy the `trade-journal` folder into `<your vault>/.obsidian/plugins/`.
   - Fastest way to find that folder: **Settings → Community plugins → the folder icon** next to "Installed plugins".
   - Verify the path looks like `plugins/trade-journal/manifest.json`, not `plugins/trade-journal/trade-journal/manifest.json`.
3. Restart Obsidian, open **Settings → Community plugins**, turn off **Restricted mode**, then enable **Trade Journal**.
4. Click the chart icon in the left ribbon, or run "Trade Journal: Open" from the command palette.

The plugin creates a `Trading/` folder on first run (configurable in settings). Nothing is written outside your vault.

## Data model

```markdown
---
date: 2026-10-09
time: "09:41"
exitTime: "10:22"
symbol: NVDA
direction: long
entry: 176.44
exit: 181.88
quantity: 150
fees: 3.5
pnl: 812.5
setup: breakout
account: main
holdSeconds: 2460
session: ny
tags: [trade]
---

Notes you write after the fact go here, in the body.
```

Missing `pnl` is fine — it is recomputed as `(exit − entry) × qty × multiplier − fees`.

## Development

```bash
npm install
npm run build     # typecheck + bundle to main.js
npm test          # 184 logic assertions
npm run test:ui   # 45 render assertions (react-dom/server)
npm run demo      # build demo/index.html — open it in a browser to preview the UI
```

`demo/index.html` is a self-contained preview with synthetic data; it runs the same React components as the plugin, so UI work does not require launching Obsidian.

## Scope and known gaps

Deliberately **not** implemented: stop-loss / R-multiple analytics, order replay of cancelled or repriced orders, multi-currency, cloud sync. These need order-level tick data that a CSV export usually does not carry, and guessing would produce numbers that look authoritative but are wrong.

Known rough edges:
- UI strings are Chinese only; no i18n layer yet
- Column mapping is not remembered between import sessions (auto-detection usually gets it, manual overrides are not persisted)
- Mobile is untested beyond "no desktop-only API is used"

## License

MIT. Not affiliated with Obsidian. Trading is risky; this tool records what happened, it does not tell you what to do.
