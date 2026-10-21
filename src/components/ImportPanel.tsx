import React, { useMemo, useRef, useState } from "react";
import { Trade, TradeDraft, tradeKey } from "../types";
import {
  ColumnMap,
  FIELD_LABELS,
  FieldKey,
  buildDrafts,
  detectColumns,
  parseCsv,
} from "../services/csv";
import { money, toneClass } from "./ui";
import { PairMeta, detectOrderExport, pairOrders } from "../services/pairing";

type Mode = "row" | "pair";

/** 价格显示：最多 4 位小数，去掉没意义的 0 */
const px = (n: number) => (Number.isFinite(n) ? String(Number(n.toFixed(4))) : "—");

const FIELD_ORDER: FieldKey[] = [
  "date",
  "time",
  "symbol",
  "direction",
  "quantity",
  "entry",
  "exit",
  "pnl",
  "fees",
  "setup",
  "account",
  "notes",
];

export function ImportPanel(props: {
  existing: Trade[];
  cur: string;
  initialCsv?: string;
  onImport: (drafts: TradeDraft[]) => Promise<{ created: number; skipped: number }>;
}) {
  const { existing, cur, onImport } = props;
  const [raw, setRaw] = useState(props.initialCsv ?? "");
  const [fileName, setFileName] = useState("");
  const [override, setOverride] = useState<ColumnMap | null>(null);
  const [feesInPnl, setFeesInPnl] = useState(false);
  const [modeOverride, setModeOverride] = useState<Mode | null>(null);
  const [feePerSide, setFeePerSide] = useState(0.72);
  // 刻意不预填：预填成唯一的历史账户，最容易把新账户的数据默默并进旧账户
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => (raw.trim() ? parseCsv(raw) : []), [raw]);
  const header = parsed.length ? parsed[0] : [];
  const dataRows = parsed.length > 1 ? parsed.slice(1) : [];
  const detected = useMemo(() => (header.length ? detectColumns(header) : {}), [header]);
  const map: ColumnMap = override ?? detected;

  // 委托级导出（订单历史/成交明细）：每行一个委托，需要先配对成回合
  const orderDet = useMemo(() => (header.length ? detectOrderExport(header) : null), [header]);
  const mode: Mode = modeOverride ?? (orderDet ? "pair" : "row");

  const paired = useMemo(
    () =>
      mode === "pair" && orderDet && dataRows.length
        ? pairOrders(dataRows, orderDet, { feePerContract: feePerSide })
        : null,
    [mode, orderDet, dataRows, feePerSide]
  );

  const built = useMemo(() => {
    if (mode === "pair") return paired ?? { drafts: [], errors: [] };
    return dataRows.length
      ? buildDrafts(dataRows, header, map, { pnlIncludesFees: feesInPnl })
      : { drafts: [], errors: [] };
  }, [mode, paired, dataRows, header, map, feesInPnl]);

  const accountOptions = useMemo(
    () => [...new Set(existing.map((t) => t.account.trim()).filter(Boolean))],
    [existing]
  );

  const accountName = account.trim();
  /** 大小写不同视为同一个账户，避免手滑建出 "amp" 和 "AMP" 两个 */
  const canonicalAccount = useMemo(() => {
    if (!accountName) return "";
    return (
      accountOptions.find((a) => a.toLowerCase() === accountName.toLowerCase()) ?? accountName
    );
  }, [accountName, accountOptions]);

  /** 账户选择优先于 CSV 里的账户列：没有列的文件（AMP 订单历史）只能靠这里指定 */
  const drafts = useMemo(
    () =>
      canonicalAccount
        ? built.drafts.map((d) => ({ ...d, account: canonicalAccount }))
        : built.drafts,
    [built.drafts, canonicalAccount]
  );

  const dupCount = useMemo(() => {
    if (!drafts.length || !existing.length) return 0;
    const keys = new Set(existing.map(tradeKey));
    return drafts.filter((d) => keys.has(tradeKey(d))).length;
  }, [drafts, existing]);

  // 必填项缺失时给出明确的诊断，而不是静默失败
  const missing = useMemo(() => {
    const list: string[] = [];
    if (map.date === undefined) list.push("日期");
    if (map.symbol === undefined) list.push("标的");
    if (map.pnl === undefined && (map.entry === undefined || map.exit === undefined)) {
      list.push("开仓价 + 平仓价（或者直接映射「盈亏」列）");
    }
    return list;
  }, [map]);

  const requiredMissing = useMemo(() => {
    const s = new Set<FieldKey>();
    if (map.date === undefined) s.add("date");
    if (map.symbol === undefined) s.add("symbol");
    return s;
  }, [map]);

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setRaw(String(reader.result ?? ""));
      setFileName(file.name);
      setOverride(null);
      setResult(null);
    };
    reader.readAsText(file, "utf-8");
  };

  const doImport = async () => {
    if (!drafts.length || !canonicalAccount) return;
    setBusy(true);
    try {
      const r = await onImport(drafts);
      setResult(`已导入 ${r.created} 笔，跳过重复 ${r.skipped} 笔`);
      setRaw("");
      setFileName("");
      setOverride(null);
    } catch (e) {
      setResult(`导入失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tj-import">
      <div className="tj-import-head">
        <div>
          <h3>导入交易记录</h3>
          <p className="tj-muted">
            支持两种文件：已经是一笔一回合的成交记录，和只按委托/成交明细导出的订单历史。
            后者会自动把开平仓配对成回合，不用手动填平仓价。
          </p>
        </div>
        <div className="tj-import-actions">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,.tsv"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) readFile(f);
            }}
          />
          <button type="button" className="tj-btn" onClick={() => fileRef.current?.click()}>
            选择文件
          </button>
        </div>
      </div>

      <div className="tj-account-bar">
        <label className="tj-field">
          <span>导入到账户</span>
          <input
            list="tj-account-options"
            value={account}
            placeholder="例如 AMP"
            onChange={(e) => setAccount(e.target.value)}
          />
        </label>
        <datalist id="tj-account-options">
          {accountOptions.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
        {accountOptions.length > 0 && (
          <div className="tj-account-quick">
            <span className="tj-muted tj-small">已有：</span>
            {accountOptions.map((a) => (
              <button
                key={a}
                type="button"
                className={`tj-account ${canonicalAccount === a ? "is-on" : ""}`}
                onClick={() => setAccount(a)}
              >
                {a}
              </button>
            ))}
          </div>
        )}
        <span className={`tj-small ${canonicalAccount ? "tj-muted" : "tj-warn-text"}`}>
          {canonicalAccount
            ? `将写入账户「${canonicalAccount}」`
            : "必填：不同券商 / 账户要分开统计，全靠这个字段"}
        </span>
      </div>

      <textarea
        className="tj-textarea"
        placeholder={`把 CSV 内容粘到这里，例如：\n\n日期,标的,方向,数量,开仓价,平仓价,手续费,策略\n2026-10-09,AAPL,做多,100,228.40,231.10,1.2,突破`}
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          setFileName("");
          setOverride(null);
          setResult(null);
        }}
        spellCheck={false}
      />

      {fileName && <div className="tj-muted tj-small">已读取：{fileName}</div>}

      {parsed.length > 1 && (
        <>
          <div className="tj-mode">
            <button
              type="button"
              className={`tj-mode-btn ${mode === "row" ? "on" : ""}`}
              onClick={() => setModeOverride("row")}
            >
              每行一回合
            </button>
            <button
              type="button"
              className={`tj-mode-btn ${mode === "pair" ? "on" : ""}`}
              onClick={() => setModeOverride("pair")}
            >
              订单历史自动配对
            </button>
            <span className="tj-muted tj-small">
              {orderDet
                ? "检测到这是委托级导出（每行一个委托），建议用自动配对"
                : "每行已经是一笔完整的开平，用「每行一回合」"}
            </span>
          </div>

          {mode === "pair" && paired && (
            <div className="tj-pair-box">
              <div className="tj-pair-head">
                <strong>
                  {paired.meta.fills} 笔成交 → {paired.meta.trips} 个回合
                </strong>
                <span className="tj-muted tj-small">
                  跳过 {paired.meta.dead} 行未成交/已取消
                </span>
              </div>
              <p className="tj-small tj-muted">
                按时间 FIFO 配对：卖出先开空、买入平空；反之开多。价差 × 合约每点价值 ×
                数量算出盈亏，再用手续费列（为空则用下面的每手手续费）扣一次。
              </p>
              {paired.meta.unknownSymbols.length > 0 && (
                <p className="tj-small tj-warn-text">
                  这些合约认不出每点价值，按 1 计算：{paired.meta.unknownSymbols.join("、")}
                </p>
              )}
              {paired.meta.open.length > 0 && (
                <p className="tj-small tj-warn-text">
                  有未平仓持仓（不会导入）：
                  {paired.meta.open
                    .map((o) => `${o.symbol} ${o.side === "long" ? "多" : "空"} ${o.qty} 手`)
                    .join("、")}
                </p>
              )}
            </div>
          )}

          <div className="tj-import-summary">
            <div>
              <strong>{dataRows.length}</strong> 行数据 ·{" "}
              {mode === "pair" ? (
                <>
                  可配对 <strong>{built.drafts.length}</strong> 个回合 · 毛盈亏{" "}
                  <strong className={toneClass(paired?.meta.gross ?? 0)}>
                    {money(paired?.meta.gross ?? 0, cur)}
                  </strong>
                  ，手续费 {cur}
                  {(paired?.meta.fees ?? 0).toFixed(2)}
                </>
              ) : (
                <>
                  识别到 <strong>{Object.keys(map).length}</strong> 列
                </>
              )}
            </div>
            <div className="tj-import-badges">
              <span className="tj-badge ok">可导入 {built.drafts.length}</span>
              {dupCount > 0 && <span className="tj-badge warn">重复 {dupCount}</span>}
              {built.errors.length > 0 && (
                <span className="tj-badge bad">异常 {built.errors.length}</span>
              )}
            </div>
          </div>

          {built.drafts.length === 0 && (
            <div className="tj-block-error">
              <strong>没能生成可导入的记录</strong>
              {mode === "pair" ? (
                <>
                  <p>
                    没有找到可配对的成交。这份文件里可能没有「已成交」行，或者时间列没识别对。
                  </p>
                  <p>
                    已识别列：
                    {orderDet
                      ? Object.entries(orderDet.map)
                          .map(([k, v]) => `${k}=${header[v as number]}`)
                          .join("，")
                      : "无"}
                  </p>
                </>
              ) : missing.length > 0 ? (
                <>
                  <p>这几项没有映射上：</p>
                  <ul>
                    {missing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                  <p>在下面的「列映射」里手动选一次对应的列就好。</p>
                </>
              ) : (
                <p>
                  字段都映射上了，但有 {built.errors.length} 行解析失败。展开下面的
                  「无法解析」看具体哪一行、什么原因。
                </p>
              )}
            </div>
          )}

          {mode === "row" && (
            <div className="tj-mapping">
              {FIELD_ORDER.map((key) => (
                <label key={key} className="tj-map-row">
                  <span className={requiredMissing.has(key) ? "tj-map-missing" : ""}>
                    {FIELD_LABELS[key]}
                    {(key === "date" || key === "symbol") && <em>*</em>}
                  </span>
                  <select
                    value={map[key] ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      const next: ColumnMap = { ...map };
                      if (v === "") delete next[key];
                      else next[key] = Number(v);
                      setOverride(next);
                    }}
                  >
                    <option value="">— 不导入 —</option>
                    {header.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `第 ${i + 1} 列`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}

          {mode === "row" ? (
            <label className="tj-check">
              <input
                type="checkbox"
                checked={feesInPnl}
                onChange={(e) => setFeesInPnl(e.target.checked)}
              />
              <span>盈亏列已经扣过手续费（导入时不再重复扣）</span>
            </label>
          ) : (
            <label className="tj-check tj-check-inline">
              <span>每手手续费（单边）</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={feePerSide}
                onChange={(e) => setFeePerSide(Math.max(0, Number(e.target.value) || 0))}
              />
              <span className="tj-muted tj-small">
                成交行里没有手续费时用这个估算；AMP 的 MNQ 约 0.7/手/边
              </span>
            </label>
          )}

          {built.drafts.length > 0 && (
            <div className="tj-preview">
              <table className="tj-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>标的</th>
                    <th>方向</th>
                    <th className="tj-num">数量</th>
                    <th className="tj-num">开仓</th>
                    <th className="tj-num">平仓</th>
                    <th className="tj-num">盈亏</th>
                    <th>策略</th>
                  </tr>
                </thead>
                <tbody>
                  {built.drafts.slice(0, 8).map((d, i) => (
                    <tr key={i}>
                      <td className="tj-nowrap">
                        {d.date} <span className="tj-muted">{d.time}</span>
                      </td>
                      <td className="tj-symbol">{d.symbol}</td>
                      <td>
                        <span className={`tj-dir ${d.direction}`}>
                          {d.direction === "long" ? "多" : "空"}
                        </span>
                      </td>
                      <td className="tj-num">{px(d.quantity)}</td>
                      <td className="tj-num">{px(d.entry)}</td>
                      <td className="tj-num">{px(d.exit)}</td>
                      <td className={`tj-num ${toneClass(d.pnl)}`}>{money(d.pnl, cur)}</td>
                      <td>{d.setup || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {built.drafts.length > 8 && (
                <div className="tj-muted tj-small">…还有 {built.drafts.length - 8} 笔</div>
              )}
            </div>
          )}

          {built.errors.length > 0 && (
            <details className="tj-errors" open={built.drafts.length === 0}>
              <summary>有 {built.errors.length} 行无法解析</summary>
              <ul>
                {built.errors.slice(0, 10).map((e) => (
                  <li key={e.row}>
                    第 {e.row} 行：{e.message}
                  </li>
                ))}
              </ul>
              {built.errors.length > 10 && (
                <p className="tj-small">…还有 {built.errors.length - 10} 行</p>
              )}
            </details>
          )}

          <div className="tj-import-foot">
            <button
              type="button"
              className="tj-btn primary"
              disabled={!built.drafts.length || busy || !canonicalAccount}
              onClick={doImport}
              title={!canonicalAccount ? "先在上面填一个账户名" : undefined}
            >
              {busy
                ? "写入中…"
                : !canonicalAccount
                  ? "先填账户名"
                  : `导入 ${built.drafts.length} 笔`}
            </button>
            {result && <span className="tj-import-result">{result}</span>}
          </div>
        </>
      )}

      {!parsed.length && (
        <div className="tj-hint">
          支持的列名（中英文都认）：日期 / date、标的 / symbol、方向 / side、数量 / qty、
          开仓价 / entry、平仓价 / exit、盈亏 / pnl、手续费 / fees、策略 / setup。
          CSV 里如果有账户列，会被顶部填的账户覆盖。
          没有盈亏列时，会用开平仓价 × 数量自动算，并扣掉手续费。
          <br />
          订单历史（含「买/卖、类型、填充数量、平均成交价、状态」这类列）也能直接导入：
          会自动过滤掉已取消/未成交的委托，按 FIFO 把成交配对成回合。
        </div>
      )}
    </div>
  );
}
