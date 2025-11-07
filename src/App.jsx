import React, { useMemo, useState } from "react";
import { DateTime } from "luxon";
import { saveAs } from "file-saver";
import * as Papa from "papaparse";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { getAccountDetail, iterTransactions, getBalanceChanges } from "./solscan";

const SOL = 1_000_000_000;
const sleep = (ms)=>new Promise(r=>setTimeout(r, ms));

function groupByDate(rows) {
  const m = new Map();
  for (const r of rows) {
    const ts = (r.blockTime || r.block_time || r.blockTimeUnix || 0);
    if (!ts) continue;
    const d = DateTime.fromSeconds(ts).toISODate();
    m.set(d, (m.get(d) || 0) + 1);
  }
  return [...m.entries()].map(([date, count]) => ({ date, count })).sort((a,b)=>a.date<b.date?-1:1);
}

export default function App(){
  const [apiKey, setApiKey] = useState("");         // <-- Solscan Pro key
  const [address, setAddress] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [maxRows, setMaxRows] = useState(20000);
  const [status, setStatus] = useState("Idle");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [acct, setAcct] = useState(null);
  const [rows, setRows] = useState([]);

  const startEpoch = startDate ? DateTime.fromISO(startDate, { zone: "UTC" }).toSeconds() : null;
  const endEpoch = endDate ? DateTime.fromISO(endDate, { zone: "UTC" }).endOf("day").toSeconds() : null;

  const chartData = useMemo(()=>groupByDate(rows),[rows]);

  async function fetchAll(){
    try{
      if(!apiKey) throw new Error("Enter your Solscan Pro API key.");
      if(!address) throw new Error("Enter a Solana address.");
      setLoading(true); setStatus("Fetching account…"); setProgress(5); setRows([]);

      // Header info
      const detail = await getAccountDetail(address, apiKey);
      setAcct(detail?.data || null);

      // If you provided dates, try balance_change first (fast pages)
      if (startEpoch || endEpoch) {
        const from = startEpoch || 0;
        const to = endEpoch || Math.floor(Date.now()/1000);
        let page = 1, out = [];
        setStatus("Fetching balance changes…");
        for(;;){
          const r = await getBalanceChanges(address, apiKey, from, to, page, 100);
          const list = r?.data?.list || [];
          out.push(...list.map(x => ({
            // normalize fields for charts/table
            blockTime: x.block_time || x.blockTime || x.ts,
            signature: x.tx_hash || x.txHash,
            slot: x.slot || null,
            fee: x.fee || 0,
            err: x.err || null
          })));
          setRows([...out]); setProgress(Math.min(80, 20 + page*4));
          if(!list.length || out.length >= maxRows) break;
          page += 1; await sleep(120);
        }
        setStatus("Fetching transactions (pagination) …");
      }

      // Full transaction crawl (v1.0 pagination)
      let out2 = [];
      for await (const page of iterTransactions(address, apiKey, 50)){
        for (const t of page) {
          out2.push({
            blockTime: t.blockTime || t.blockTimeUnix || t.block_time,
            signature: t.txHash || t.txhash,
            slot: t.slot ?? null,
            fee: t.fee || t.feeLamports || 0,
            err: t.err || t.error || null
          });
        }
        // date filtering client-side
        if (startEpoch) out2 = out2.filter(r => !r.blockTime || r.blockTime >= startEpoch);
        if (endEpoch) out2 = out2.filter(r => !r.blockTime || r.blockTime <= endEpoch);

        setRows([...out2]);
        setStatus(`Fetched ${out2.length}…`);
        setProgress(Math.min(95, 60 + Math.round(out2.length / Math.max(500, maxRows) * 35)));
        if (out2.length >= maxRows) break;
        await sleep(120);
      }

      setStatus("Done"); setProgress(100);
    }catch(e){
      setStatus(e.message || String(e));
    }finally{
      setLoading(false);
    }
  }

  function exportCSV(){
    const csv = Papa.unparse(rows.map(r=>({
      time_iso: r.blockTime ? DateTime.fromSeconds(r.blockTime).toISO() : "",
      signature: r.signature,
      slot: r.slot,
      fee_sol: r.fee ? r.fee / SOL : 0,
      error: r.err ? JSON.stringify(r.err) : ""
    })));
    saveAs(new Blob([csv],{type:"text/csv;charset=utf-8;"}), `solscan_${address}_${Date.now()}.csv`);
  }

  function exportJSON(){
    saveAs(new Blob([JSON.stringify(rows)],{type:"application/json"}), `solscan_${address}_${Date.now()}.json`);
  }

  const totalFees = rows.reduce((a,r)=>a+(r.fee||0),0);
  const failed = rows.filter(r=>r.err).length;

  return (
    <div className="container">
      <div className="row" style={{justifyContent:'space-between'}}>
        <div className="h1">Solana Wallet Analytics — Solscan</div>
        <div className="badge">{status}</div>
      </div>

      <div className="card grid" style={{marginTop:12}}>
        <div className="grid grid-3">
          <div>
            <label>Solscan Pro API Key</label>
            <input value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="paste your key…" />
            <div className="subtle">Header name: <code>token</code></div>
          </div>
          <div>
            <label>Address</label>
            <input value={address} onChange={e=>setAddress(e.target.value)} placeholder="7XS…" />
          </div>
          <div>
            <label>Max Rows</label>
            <input type="number" min={1000} step={1000} value={maxRows} onChange={e=>setMaxRows(Number(e.target.value)||10000)} />
          </div>
        </div>

        <div className="grid grid-3">
          <div>
            <label>Start Date (UTC)</label>
            <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} />
          </div>
          <div>
            <label>End Date (UTC)</label>
            <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} />
          </div>
        </div>

        <div className="row">
          {!loading ? <button onClick={fetchAll}>Fetch</button> : <button className="secondary" disabled>Working…</button>}
          <button className="secondary" disabled={!rows.length} onClick={exportCSV}>CSV</button>
          <button className="secondary" disabled={!rows.length} onClick={exportJSON}>JSON</button>
        </div>

        {loading && (
          <div className="progress-wrap">
            <div className="progress" style={{width: progress + '%'}}/>
          </div>
        )}

        {acct && (
          <div className="grid grid-3" style={{marginTop:16}}>
            <div className="kpi"><div className="label">Lamports</div><div className="value">{acct.lamports?.toLocaleString?.() ?? '—'}</div></div>
            <div className="kpi"><div className="label">Type</div><div className="value">{acct.type || acct.accountType || '—'}</div></div>
            <div className="kpi"><div className="label">Tx (loaded)</div><div className="value">{rows.length.toLocaleString()}</div></div>
          </div>
        )}
      </div>

      {rows.length>0 && (
        <>
          <div className="grid grid-3" style={{marginTop:16}}>
            <div className="kpi"><div className="label">Succeeded / Failed</div><div className="value">{(rows.length - failed).toLocaleString()} / {failed.toLocaleString()}</div></div>
            <div className="kpi"><div className="label">Total Fees</div><div className="value">{(totalFees / SOL).toLocaleString(undefined,{maximumFractionDigits:9})} SOL</div></div>
            <div className="kpi"><div className="label">Range</div><div className="value">
              {DateTime.fromSeconds(rows[rows.length-1]?.blockTime || 0).toISODate()} → {DateTime.fromSeconds(rows[0]?.blockTime || 0).toISODate()}
            </div></div>
          </div>

          <div className="card" style={{marginTop:16}}>
            <div style={{height:320}}>
              <ResponsiveContainer>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3"/>
                  <XAxis dataKey="date" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card" style={{marginTop:16, overflow:'auto'}}>
            <table className="table">
              <thead>
                <tr><th>Time (UTC)</th><th>Signature</th><th>Slot</th><th>Fee (SOL)</th><th>Error</th></tr>
              </thead>
              <tbody>
                {rows.map(r=>{
                  const ts = r.blockTime ? DateTime.fromSeconds(r.blockTime).toUTC().toISO({suppressMilliseconds:true}) : "";
                  const feeSol = (r.fee || 0) / SOL;
                  return (
                    <tr key={r.signature}>
                      <td>{ts}</td>
                      <td><a className="link" href={`https://solscan.io/tx/${r.signature}`} target="_blank" rel="noreferrer">
                        {r.signature?.slice(0,8)}…{r.signature?.slice(-8)}
                      </a></td>
                      <td>{r.slot ?? ""}</td>
                      <td>{feeSol.toFixed(9)}</td>
                      <td style={{color:'#fca5a5'}}>{r.err ? JSON.stringify(r.err) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="footer" style={{marginTop:16}}>
        Uses Solscan Pro API (<code>token</code> header). Paginates with <code>beforeHash</code> and optionally pulls time-bounded balance changes.
      </div>
    </div>
  );
}
