import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { JournalApp } from "./components/JournalApp";
import { Trade, TradeDraft, tradeKey } from "./types";
import { DEFAULT_CARDS } from "./services/metrics";
import { DEFAULT_LAYOUT, WidgetLayout } from "./services/layout";

/* 确定性伪随机，保证每次预览图形一致 */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

const SYMBOLS = [
  { sym: "AAPL", price: 228, qty: 200 },
  { sym: "NVDA", price: 176, qty: 150 },
  { sym: "TSLA", price: 412, qty: 80 },
  { sym: "ES", price: 5840, qty: 1 },
  { sym: "MNQ", price: 20450, qty: 2 },
  { sym: "BTC", price: 68500, qty: 0.15 },
];

const SETUPS = ["突破", "回踩", "反转", "区间"];
const ACCOUNTS = ["主账户", "Prop-50K"];

function makeTrades(): Trade[] {
  const rand = rng(20261018);
  const out: Trade[] = [];
  const start = new Date("2026-03-30T00:00:00");
  const end = new Date("2026-10-16T00:00:00");
  let id = 0;

  const cursor = new Date(start);
  while (cursor <= end) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) {
      const perDay = rand() < 0.45 ? 2 : rand() < 0.85 ? 1 : 0;
      for (let k = 0; k < perDay; k++) {
        const inst = SYMBOLS[Math.floor(rand() * SYMBOLS.length)];
        const setup = SETUPS[Math.floor(rand() * SETUPS.length)];
        const account = ACCOUNTS[rand() < 0.7 ? 0 : 1];
        const direction = rand() < 0.62 ? "long" : "short";

        // 胜率略有波动：突破/回踩更好，反转最差
        const base =
          setup === "突破" ? 0.56 : setup === "回踩" ? 0.54 : setup === "反转" ? 0.41 : 0.48;
        const win = rand() < base;
        const rMultiple = win
          ? 1.1 + rand() * 1.9
          : -(0.7 + rand() * 0.6);
        const risk = 300 + rand() * 500;
        const fees = 1 + rand() * 3;
        const pnl = rMultiple * risk - fees;

        const entry = inst.price * (1 + (rand() - 0.5) * 0.06);
        const exit = entry + (pnl / inst.qty) * (direction === "long" ? 1 : -1);
        const hh = 9 + Math.floor(rand() * 6);
        const mm = Math.floor(rand() * 60);

        out.push({
          id: `demo-${id++}`,
          date: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(
            2,
            "0"
          )}-${String(cursor.getDate()).padStart(2, "0")}`,
          time: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
          symbol: inst.sym,
          direction,
          entry: Number(entry.toFixed(2)),
          exit: Number(exit.toFixed(2)),
          quantity: inst.qty,
          fees: Number(fees.toFixed(2)),
          pnl: Number(pnl.toFixed(2)),
          setup,
          account,
          stop: null,
          target: null,
          tags: ["trade"],
          notes: win ? "按计划执行，加仓点略早。" : "提前进场，止损被打。",
        });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function Demo({
  initialTab,
  csvPrefill,
}: {
  initialTab?: "dashboard" | "trades" | "import";
  csvPrefill?: string;
}) {
  const [trades, setTrades] = useState<Trade[]>(() => makeTrades());
  // 预览页里也能试拖拽和指标配置，刷新即恢复默认
  const [cards, setCards] = useState<string[]>(DEFAULT_CARDS);
  const [layout, setLayout] = useState<WidgetLayout[]>(DEFAULT_LAYOUT);
  // 浏览器里没有 vault，点开交易就用一条提示代替
  const [opened, setOpened] = useState<string | null>(null);

  return (
    <>
      <JournalApp
        trades={trades}
        currency="¥"
        initialTab={initialTab}
        cardIds={cards}
        onCardsChange={setCards}
        layout={layout}
        onLayoutChange={setLayout}
        csvPrefill={csvPrefill}
        onOpen={(t) =>
          setOpened(
            `${t.date} ${t.time ?? ""} ${t.symbol} ${t.direction === "long" ? "做多" : "做空"} ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}`
          )
        }
        // 浏览器预览里用内存代替 vault
        onImport={async (drafts: TradeDraft[]) => {
          const keys = new Set(trades.map(tradeKey));
          const added: Trade[] = [];
          let skipped = 0;
          for (const d of drafts) {
            if (keys.has(tradeKey(d))) {
              skipped++;
              continue;
            }
            added.push({ ...d, id: `imported-${Math.random().toString(36).slice(2)}` });
            keys.add(tradeKey(d));
          }
          setTrades((prev) => [...prev, ...added]);
          return { created: added.length, skipped };
        }}
        onDelete={async (t: Trade) => {
          setTrades((prev) => prev.filter((x) => x.id !== t.id));
        }}
        onDeleteMany={async (ts: Trade[]) => {
          const ids = new Set(ts.map((t) => t.id));
          setTrades((prev) => prev.filter((x) => !ids.has(x.id)));
        }}
        onSetSetup={async (ts: Trade[], setup: string) => {
          const ids = new Set(ts.map((t) => t.id));
          setTrades((prev) => prev.map((x) => (ids.has(x.id) ? { ...x, setup } : x)));
        }}
        onReload={() => undefined}
      />
      {opened && (
        <div className="preview-toast" onClick={() => setOpened(null)}>
          插件内会打开这笔交易的笔记：{opened}（预览环境不落盘，点此关闭）
        </div>
      )}
    </>
  );
}

const DEMO_CSV = `日期,标的,方向,数量,开仓价,平仓价,手续费,策略,账户
2026-10-15,AAPL,做多,200,229.10,233.40,1.80,突破,主账户
2026-10-15,MNQ,做空,2,20560.5,20488,2.40,回踩,Prop-50K
2026-10-14,NVDA,做多,150,175.20,173.60,3.10,反转,主账户
2026-10-14,ES,做空,1,5862.25,5849.5,2.50,突破,Prop-50K
2026-10-13,BTC,做多,0.2,67980,69500,4.20,区间,主账户`;

const DEMO_CSV_AMP = `商品代码,买/卖,类型,数量,限价,止损价,启用于,填充数量,平均成交价,手续费,下单时间,状态,状态时间,订单编号,期限
F.US.MNQZ26,买入,止损,6,,30657.75,,0,,,2026-09-24 21:03:30,已取消,2026-09-24 21:03:45,2111866557,DAY
F.US.MNQZ26,买入,止盈,6,30332.5,,,0,,,2026-09-24 21:03:30,已取消,2026-09-24 21:03:45,2111866556,DAY
F.US.MNQZ26,卖出,限价,6,30632,,,0,,,2026-09-24 21:03:30,已取消,2026-09-24 21:03:45,2111866555,DAY
F.US.MNQZ26,买入,止损,6,,30657.75,,0,,,2026-09-24 21:02:57,已取消,2026-09-24 21:03:30,2111866541,DAY
F.US.MNQZ26,卖出,限价,6,30632,,,0,,,2026-09-24 21:02:57,已取消,2026-09-24 21:03:30,2111866540,DAY
F.US.MNQZ26,卖出,限价,6,30632,,,0,,,2026-09-24 21:02:50,已取消,2026-09-24 21:02:57,2111836947,DAY
F.US.MNQZ26,买入,限价,3,30830.25,,,3,30830.25,,2026-09-23 21:49:47,已成交,2026-09-23 22:02:45,2111311958,DAY
F.US.MNQZ26,买入,止损,1,,30926,,0,,,2026-09-23 21:36:19,已取消,2026-09-23 22:08:34,2111310322,GTC
F.US.MNQZ26,买入,限价,3,30780.5,,,3,30780.5,,2026-09-23 21:36:19,已成交,2026-09-23 22:08:34,2111310321,GTC
F.US.MNQZ26,买入,止损,6,,30957.75,,0,,,2026-09-23 21:35:48,已取消,2026-09-23 21:36:18,2111310277,GTC
F.US.MNQZ26,卖出,市价,6,,,,6,30934.625,,2026-09-23 21:35:41,已成交,2026-09-23 21:35:41,2111320179,GTC
F.US.MNQZ26,买入,止损,6,,30971.5,,6,30970.25,,2026-09-22 22:22:22,已成交,2026-09-22 22:31:27,2109884055,GTC
F.US.MNQZ26,买入,止盈,1,30837.25,,,0,,,2026-09-22 22:22:22,已取消,2026-09-22 22:31:27,2109884054,GTC
F.US.MNQZ26,买入,止损,6,,30972.25,,0,,,2026-09-22 22:22:16,已取消,2026-09-22 22:22:22,2110484807,GTC
F.US.MNQZ26,卖出,市价,6,,,,6,30946.5,,2026-09-22 22:22:10,已成交,2026-09-22 22:22:10,2109824492,GTC
F.US.MNQZ26,买入,止损,6,,30947.5,,6,30946.416666666668,,2026-09-22 22:00:23,已成交,2026-09-22 22:11:26,2109794031,GTC
F.US.MNQZ26,买入,止盈,5,30836.25,,,0,,,2026-09-22 22:00:23,已取消,2026-09-22 22:11:26,2109794030,GTC
F.US.MNQZ26,买入,止损,6,,30947.5,,0,,,2026-09-22 21:59:34,已取消,2026-09-22 22:00:23,2109823053,GTC
F.US.MNQZ26,卖出,市价,6,,,,6,30924.5,,2026-09-22 21:59:28,已成交,2026-09-22 21:59:28,2109873595,GTC
F.US.MNQZ26,买入,限价,3,30837.5,,,0,,,2026-09-22 21:48:43,已取消,2026-09-22 21:50:47,2109892201,DAY
F.US.MNQZ26,买入,止损,6,,30934.5,,6,30933.708333333332,,2026-09-22 21:44:51,已成交,2026-09-22 21:50:44,2109872545,GTC
F.US.MNQZ26,买入,止盈,5,30748.75,,,0,,,2026-09-22 21:44:51,已取消,2026-09-22 21:50:44,2109872544,GTC
F.US.MNQZ26,买入,止损,6,,30934.5,,0,,,2026-09-22 21:44:46,已取消,2026-09-22 21:44:51,2109881769,GTC
F.US.MNQZ26,卖出,市价,6,,,,6,30909.5,,2026-09-22 21:44:39,已成交,2026-09-22 21:44:39,2109821956,GTC
F.US.MNQZ26,买入,市价,6,,,,6,30692.916666666668,,2026-09-22 16:35:05,已成交,2026-09-22 16:35:06,2109814990,GTC
F.US.MNQZ26,买入,止损,6,,30877.25,,0,,,2026-09-22 08:39:19,已取消,2026-09-22 16:35:05,2109570159,GTC
F.US.MNQZ26,买入,止盈,6,30640.25,,,0,,,2026-09-22 08:39:19,已取消,2026-09-22 16:35:05,2109570158,GTC
F.US.MNQZ26,买入,止损,6,,30909.5,,0,,,2026-09-22 08:39:07,已取消,2026-09-22 08:39:19,2109550406,GTC
F.US.MNQZ26,卖出,市价,6,,,,6,30883.083333333332,,2026-09-22 08:39:03,已成交,2026-09-22 08:39:03,2109530913,GTC
F.US.MNQZ26,买入,市价,6,,,,6,30426.416666666668,,2026-09-21 22:11:58,已成交,2026-09-21 22:11:58,2109182927,GTC
F.US.MNQZ26,买入,止损,6,,30431.5,,0,,,2026-09-21 22:06:21,已取消,2026-09-21 22:11:58,2109163071,GTC
F.US.MNQZ26,买入,止盈,6,30277.5,,,0,,,2026-09-21 22:06:21,已取消,2026-09-21 22:11:58,2109163070,GTC
F.US.MNQZ26,买入,止损,6,,30431.5,,0,,,2026-09-21 22:06:15,已取消,2026-09-21 22:06:20,2109172774,GTC
F.US.MNQZ26,卖出,市价,6,,,,6,30405.75,,2026-09-21 22:06:10,已成交,2026-09-21 22:06:10,2109182625,GTC
F.US.MNQZ26,买入,止损,6,,30271.75,,6,30271.75,,2026-09-21 20:19:15,已成交,2026-09-21 21:37:10,2109149766,GTC
F.US.MNQZ26,买入,止盈,5,30063.25,,,0,,,2026-09-21 20:19:15,已取消,2026-09-21 21:37:10,2109149765,GTC
F.US.MNQZ26,买入,止损,6,,30273.75,,0,,,2026-09-21 20:19:10,已取消,2026-09-21 20:19:15,2109189761,GTC
F.US.MNQZ26,卖出,市价,6,,,,6,30256.708333333332,,2026-09-21 20:19:05,已成交,2026-09-21 20:19:05,2109189758,GTC
F.US.MNQZ26,买入,止损,6,,29741,,6,29740.708333333332,,2026-09-17 22:49:15,已成交,2026-09-17 23:46:52,2107882985,GTC
F.US.MNQZ26,买入,止盈,5,29543.75,,,0,,,2026-09-17 22:49:15,已取消,2026-09-17 23:46:52,2107882984,GTC
F.US.MNQZ26,买入,止损,6,,29708,,0,,,2026-09-17 22:49:06,已取消,2026-09-17 22:49:15,2107913226,GTC
F.US.MNQZ26,卖出,市价,6,,,,6,29688.75,,2026-09-17 22:49:03,已成交,2026-09-17 22:49:03,2107902727,GTC
F.US.MNQZ26,买入,止损,6,,29740.25,,0,,,2026-09-17 22:46:20,已取消,2026-09-17 22:49:07,2107913025,DAY
F.US.MNQZ26,卖出,限价,6,29721.5,,,0,,,2026-09-17 22:46:20,已取消,2026-09-17 22:49:07,2107913024,DAY
F.US.MNQZ26,卖出,限价,6,29721.5,,,0,,,2026-09-17 22:46:15,已取消,2026-09-17 22:46:20,2107902487,DAY
F.US.MNQZ26,买入,限价,3,29545.25,,,0,,,2026-09-17 22:01:21,已取消,2026-09-17 22:04:14,2107850605,DAY
F.US.MNQZ26,买入,止损,6,,29704,,6,29704,,2026-09-17 21:55:34,已成交,2026-09-17 22:14:05,2107899688,GTC
F.US.MNQZ26,买入,止盈,5,29541.75,,,0,,,2026-09-17 21:55:34,已取消,2026-09-17 22:14:05,2107899687,GTC
F.US.MNQZ26,买入,止损,6,,29701.5,,0,,,2026-09-17 21:55:23,已取消,2026-09-17 21:55:34,2107919714,GTC
F.US.MNQZ26,卖出,市价,6,,,,6,29676.458333333332,,2026-09-17 21:55:20,已成交,2026-09-17 21:55:20,2107879737,GTC`;

const DEMO_CSV_BAD = `Order Ref,Instrument,When,Amount
A-1024,MNQZ6,2026-10-15,-54.44
A-1025,MNQZ6,2026-10-15,120.00
A-1026,NVDA,2026-10-14,-88.10`;

const params = new URLSearchParams(location.search);
const csvParam =
  params.get("csv") ?? (location.pathname.includes("amp-preview") ? "amp" : null);
// 带了 CSV 预览就直接停在导入页
const initialTab = params.get("tab") ?? (csvParam ? "import" : null);

const el = document.getElementById("app");
if (el)
  createRoot(el).render(
    <Demo
      initialTab={initialTab === "trades" || initialTab === "import" ? initialTab : "dashboard"}
      csvPrefill={
        csvParam === "1"
          ? DEMO_CSV
          : csvParam === "bad"
            ? DEMO_CSV_BAD
            : csvParam === "amp"
              ? DEMO_CSV_AMP
              : undefined
      }
    />
  );
