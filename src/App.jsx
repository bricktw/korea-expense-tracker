import { useState, useEffect, useCallback } from "react";

// ── 設定 ─────────────────────────────────────────────
// 部署 apps_script/Code.gs 後，把「網頁應用程式 URL」貼在這裡。
// 留空 = 純離線模式（只存本機 localStorage，不同步）。
const WEB_APP_URL = "";

// 兩趟旅行（之後可改名 / 改預設匯率）
const TRIPS = [
  { id: "trip1", label: "韓國 第一趟", rate: 0.023 },
  { id: "trip2", label: "韓國 第二趟", rate: 0.023 },
];

// 記錄人（對應主系統 member_id：dad / mom / amber）
const RECORDERS = [
  { id: "dad", label: "爸爸" },
  { id: "mom", label: "媽媽" },
  { id: "amber", label: "安安" },
];

const PAYMENT_METHODS = [
  { id: "現金", label: "現金", emoji: "💵", color: "#4A7C59" },
  { id: "Line Pay", label: "Line Pay", emoji: "💚", color: "#00B900" },
  { id: "全支付", label: "全支付", emoji: "🔵", color: "#1A6FD4" },
];

const CATEGORIES = [
  { id: "餐飲", label: "餐飲", emoji: "🍽️" },
  { id: "交通", label: "交通", emoji: "🚌" },
  { id: "購物", label: "購物", emoji: "🛍️" },
  { id: "住宿", label: "住宿", emoji: "🏨" },
  { id: "景點", label: "景點", emoji: "🎡" },
  { id: "其他", label: "其他", emoji: "📦" },
];

const STORAGE_KEY = "korea-travel-expenses-v2";
const PREFS_KEY = "korea-travel-prefs-v2";
const QUEUE_KEY = "korea-travel-queue-v2";

function formatKRW(n) {
  return `₩${Number(n).toLocaleString("ko-KR")}`;
}
function ntd(n) {
  return `NT$${Math.round(Number(n) || 0).toLocaleString("zh-TW")}`;
}

// ── Google Sheet API（POST 用 text/plain 避免 CORS preflight）──
async function apiList() {
  const res = await fetch(WEB_APP_URL, { method: "GET" });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "list failed");
  return json.data;
}
async function apiPost(body) {
  const res = await fetch(WEB_APP_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "post failed");
  return json;
}

const loadJSON = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};
const saveJSON = (key, val) => {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
};

export default function App() {
  const [expenses, setExpenses] = useState(() => loadJSON(STORAGE_KEY, []));
  const [queue, setQueue] = useState(() => loadJSON(QUEUE_KEY, []));
  const prefs = loadJSON(PREFS_KEY, {});

  const [trip, setTrip] = useState(prefs.trip || TRIPS[0].id);
  const [recorder, setRecorder] = useState(prefs.recorder || RECORDERS[0].id);
  const [rates, setRates] = useState(
    () => prefs.rates || Object.fromEntries(TRIPS.map((t) => [t.id, t.rate]))
  );

  const [view, setView] = useState("add"); // add | list | summary
  const [form, setForm] = useState({ amount: "", method: "現金", category: "餐飲", note: "" });
  const [filterMethod, setFilterMethod] = useState("all");
  const [toast, setToast] = useState(null);
  const [sync, setSync] = useState(WEB_APP_URL ? "syncing" : "offline");

  // 持久化
  useEffect(() => saveJSON(STORAGE_KEY, expenses), [expenses]);
  useEffect(() => saveJSON(QUEUE_KEY, queue), [queue]);
  useEffect(() => saveJSON(PREFS_KEY, { trip, recorder, rates }), [trip, recorder, rates]);

  const currentRate = Number(rates[trip]) || TRIPS.find((t) => t.id === trip)?.rate || 0.023;

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }

  // ── 同步：把 queue 內未送出的操作沖出去 ──
  const flushQueue = useCallback(async (pending) => {
    if (!WEB_APP_URL || pending.length === 0) return pending;
    const remaining = [...pending];
    try {
      while (remaining.length) {
        await apiPost(remaining[0]);
        remaining.shift();
      }
    } catch {
      setSync("error");
    }
    setQueue(remaining);
    return remaining;
  }, []);

  // ── 載入：先沖 queue，再從 Sheet 拉全量，再套用仍未同步的本機操作 ──
  const refresh = useCallback(async () => {
    if (!WEB_APP_URL) { setSync("offline"); return; }
    setSync("syncing");
    try {
      const stillPending = await flushQueue(loadJSON(QUEUE_KEY, []));
      const server = await apiList();
      let merged = server;
      // 套用尚未送出的操作，避免覆蓋掉本機樂觀更新
      for (const op of stillPending) {
        if (op.action === "add") merged = [op.entry, ...merged.filter((e) => e.id !== op.entry.id)];
        if (op.action === "delete") merged = merged.filter((e) => e.id !== op.id);
      }
      merged.sort((a, b) => String(b.id).localeCompare(String(a.id)));
      setExpenses(merged);
      setSync(stillPending.length ? "error" : "synced");
    } catch {
      setSync("error");
    }
  }, [flushQueue]);

  useEffect(() => { refresh(); }, [refresh]);

  function enqueue(op) {
    setQueue((q) => {
      const next = [...q, op];
      flushQueue(next).then((rest) => {
        if (rest.length === 0) setSync("synced");
      });
      return next;
    });
  }

  function addExpense() {
    const amt = Number(form.amount);
    if (!form.amount || isNaN(amt) || amt <= 0) return;
    const now = new Date();
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      trip,
      recorder,
      amount: amt,
      rate: currentRate,
      twd: Math.round(amt * currentRate),
      method: form.method,
      category: form.category,
      note: form.note.trim(),
      date: now.toLocaleDateString("en-CA"), // YYYY-MM-DD
      time: now.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false }),
    };
    setExpenses((prev) => [entry, ...prev]);
    setForm((f) => ({ ...f, amount: "", note: "" }));
    if (WEB_APP_URL) enqueue({ action: "add", entry });
    showToast(WEB_APP_URL ? "✅ 已記帳並同步" : "✅ 已記帳（離線）");
  }

  function deleteExpense(id) {
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    if (WEB_APP_URL) enqueue({ action: "delete", id });
  }

  // ── 只看目前這趟 ──
  const tripExpenses = expenses.filter((e) => e.trip === trip);
  const totalKRW = tripExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalTWD = tripExpenses.reduce((s, e) => s + Number(e.twd || 0), 0);

  const byMethod = PAYMENT_METHODS.map((m) => {
    const rows = tripExpenses.filter((e) => e.method === m.id);
    return { ...m, krw: rows.reduce((s, e) => s + e.amount, 0), twd: rows.reduce((s, e) => s + e.twd, 0) };
  });
  const byCategory = CATEGORIES.map((c) => {
    const rows = tripExpenses.filter((e) => e.category === c.id);
    return { ...c, krw: rows.reduce((s, e) => s + e.amount, 0), twd: rows.reduce((s, e) => s + e.twd, 0) };
  }).filter((c) => c.krw > 0).sort((a, b) => b.krw - a.krw);
  const byRecorder = RECORDERS.map((r) => {
    const rows = tripExpenses.filter((e) => e.recorder === r.id);
    return { ...r, krw: rows.reduce((s, e) => s + e.amount, 0), twd: rows.reduce((s, e) => s + e.twd, 0) };
  }).filter((r) => r.krw > 0);

  const filtered = (filterMethod === "all" ? tripExpenses : tripExpenses.filter((e) => e.method === filterMethod));

  const syncBadge = {
    offline: { t: "離線模式", c: "#999" },
    syncing: { t: "同步中…", c: "#E0A82E" },
    synced: { t: "已同步", c: "#4A7C59" },
    error: { t: "未同步⚠", c: "#C0492E" },
  }[sync];

  return (
    <div style={{
      minHeight: "100vh",
      background: "#F5F3EF",
      fontFamily: "'Segoe UI', 'PingFang TC', sans-serif",
      maxWidth: 420,
      margin: "0 auto",
      paddingBottom: 80,
    }}>
      {/* Header */}
      <div style={{ background: "#1C2340", color: "#fff", padding: "16px 20px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 13, opacity: 0.6 }}>🇰🇷 韓國旅遊記帳</div>
          <div
            onClick={refresh}
            style={{ fontSize: 11, color: syncBadge.c, cursor: "pointer", background: "rgba(255,255,255,0.1)", padding: "3px 9px", borderRadius: 12 }}
          >
            ● {syncBadge.t}
          </div>
        </div>

        {/* Trip switcher */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {TRIPS.map((t) => (
            <button key={t.id} onClick={() => setTrip(t.id)} style={{
              flex: 1,
              padding: "7px 0",
              border: "none",
              borderRadius: 8,
              background: trip === t.id ? "#fff" : "rgba(255,255,255,0.12)",
              color: trip === t.id ? "#1C2340" : "#fff",
              fontWeight: trip === t.id ? 700 : 400,
              fontSize: 13,
              cursor: "pointer",
            }}>{t.label}</button>
          ))}
        </div>

        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 1 }}>{formatKRW(totalKRW)}</div>
        <div style={{ fontSize: 13, opacity: 0.65, marginTop: 2 }}>
          ≈ {ntd(totalTWD)} · 共 {tripExpenses.length} 筆
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          {byMethod.map((m) => (
            <div key={m.id} style={{ flex: 1, background: "rgba(255,255,255,0.08)", borderRadius: 10, padding: "8px 6px", textAlign: "center" }}>
              <div style={{ fontSize: 16 }}>{m.emoji}</div>
              <div style={{ fontSize: 10, opacity: 0.7, marginTop: 1 }}>{m.label}</div>
              <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>
                {m.krw > 0 ? `₩${(m.krw / 1000).toFixed(0)}K` : "—"}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tab Nav */}
      <div style={{ display: "flex", background: "#fff", borderBottom: "1px solid #E8E5DF" }}>
        {[["add", "➕ 記帳"], ["list", "📋 明細"], ["summary", "📊 統計"]].map(([v, label]) => (
          <button key={v} onClick={() => setView(v)} style={{
            flex: 1, padding: "12px 0", border: "none", background: "none", cursor: "pointer",
            fontSize: 13, fontWeight: view === v ? 700 : 400,
            color: view === v ? "#1C2340" : "#888",
            borderBottom: view === v ? "2px solid #1C2340" : "2px solid transparent",
          }}>{label}</button>
        ))}
      </div>

      <div style={{ padding: 16 }}>

        {/* ── ADD ── */}
        {view === "add" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Recorder */}
            <div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>記錄人</div>
              <div style={{ display: "flex", gap: 8 }}>
                {RECORDERS.map((r) => (
                  <button key={r.id} onClick={() => setRecorder(r.id)} style={{
                    flex: 1, padding: "8px 4px",
                    border: `2px solid ${recorder === r.id ? "#1C2340" : "#E0DDD7"}`,
                    borderRadius: 10,
                    background: recorder === r.id ? "#1C2340" : "#fff",
                    color: recorder === r.id ? "#fff" : "#555",
                    fontWeight: recorder === r.id ? 700 : 400, fontSize: 13, cursor: "pointer",
                  }}>{r.label}</button>
                ))}
              </div>
            </div>

            {/* Amount */}
            <div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>金額（韓圜 ₩）</div>
              <input
                type="number" inputMode="numeric" placeholder="例：15000"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && addExpense()}
                style={{
                  width: "100%", fontSize: 28, fontWeight: 700, padding: "12px 14px",
                  border: "2px solid #E0DDD7", borderRadius: 12, outline: "none",
                  boxSizing: "border-box", background: "#fff", color: "#1C2340",
                }}
              />
              {form.amount && !isNaN(Number(form.amount)) && Number(form.amount) > 0 && (
                <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
                  ≈ {ntd(Number(form.amount) * currentRate)}
                </div>
              )}
            </div>

            {/* Rate (editable per trip) */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "2px solid #E0DDD7", borderRadius: 10, padding: "8px 12px" }}>
              <span style={{ fontSize: 12, color: "#888" }}>本趟匯率 ₩1 ≈ NT$</span>
              <input
                type="number" step="0.0001" inputMode="decimal"
                value={rates[trip] ?? ""}
                onChange={(e) => setRates((r) => ({ ...r, [trip]: e.target.value === "" ? "" : Number(e.target.value) }))}
                style={{ width: 90, fontSize: 14, fontWeight: 700, border: "none", outline: "none", color: "#1C2340", background: "transparent" }}
              />
            </div>

            {/* Payment Method */}
            <div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>付款方式</div>
              <div style={{ display: "flex", gap: 8 }}>
                {PAYMENT_METHODS.map((m) => (
                  <button key={m.id} onClick={() => setForm((f) => ({ ...f, method: m.id }))} style={{
                    flex: 1, padding: "10px 4px",
                    border: `2px solid ${form.method === m.id ? m.color : "#E0DDD7"}`,
                    borderRadius: 10, background: form.method === m.id ? m.color + "15" : "#fff",
                    cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                  }}>
                    <span style={{ fontSize: 20 }}>{m.emoji}</span>
                    <span style={{ fontSize: 11, fontWeight: form.method === m.id ? 700 : 400, color: form.method === m.id ? m.color : "#555" }}>{m.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Category */}
            <div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>類別</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {CATEGORIES.map((c) => (
                  <button key={c.id} onClick={() => setForm((f) => ({ ...f, category: c.id }))} style={{
                    padding: "10px 4px",
                    border: `2px solid ${form.category === c.id ? "#1C2340" : "#E0DDD7"}`,
                    borderRadius: 10, background: form.category === c.id ? "#1C2340" : "#fff",
                    cursor: "pointer", color: form.category === c.id ? "#fff" : "#333",
                  }}>
                    <div style={{ fontSize: 18 }}>{c.emoji}</div>
                    <div style={{ fontSize: 11, marginTop: 3 }}>{c.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Note */}
            <div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>備註（選填）</div>
              <input
                type="text" placeholder="例：弘大炸雞、地鐵T-money..."
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && addExpense()}
                style={{
                  width: "100%", fontSize: 14, padding: "10px 14px",
                  border: "2px solid #E0DDD7", borderRadius: 10, outline: "none",
                  boxSizing: "border-box", background: "#fff",
                }}
              />
            </div>

            <button onClick={addExpense} style={{
              width: "100%", padding: "16px", background: "#1C2340", color: "#fff",
              border: "none", borderRadius: 12, fontSize: 16, fontWeight: 700, cursor: "pointer", marginTop: 4,
            }}>記帳</button>
          </div>
        )}

        {/* ── LIST ── */}
        {view === "list" && (
          <div>
            <div style={{ display: "flex", gap: 6, marginBottom: 14, overflowX: "auto", paddingBottom: 4 }}>
              {[{ id: "all", label: "全部", emoji: "📋" }, ...PAYMENT_METHODS].map((m) => (
                <button key={m.id} onClick={() => setFilterMethod(m.id)} style={{
                  flexShrink: 0, padding: "6px 14px",
                  border: `1.5px solid ${filterMethod === m.id ? "#1C2340" : "#DDD"}`,
                  borderRadius: 20, background: filterMethod === m.id ? "#1C2340" : "#fff",
                  color: filterMethod === m.id ? "#fff" : "#555", fontSize: 12, cursor: "pointer",
                  fontWeight: filterMethod === m.id ? 600 : 400,
                }}>{m.emoji} {m.label}</button>
              ))}
            </div>

            {filtered.length === 0 ? (
              <div style={{ textAlign: "center", color: "#aaa", padding: "40px 0", fontSize: 14 }}>還沒有記帳紀錄</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {filtered.map((e) => {
                  const cat = CATEGORIES.find((c) => c.id === e.category);
                  const method = PAYMENT_METHODS.find((m) => m.id === e.method);
                  const rec = RECORDERS.find((r) => r.id === e.recorder);
                  return (
                    <div key={e.id} style={{
                      background: "#fff", borderRadius: 12, padding: "12px 14px",
                      display: "flex", alignItems: "center", gap: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                    }}>
                      <div style={{ fontSize: 24, width: 36, textAlign: "center" }}>{cat?.emoji}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 14, fontWeight: 600 }}>{formatKRW(e.amount)}</span>
                          <span style={{ fontSize: 10, background: (method?.color || "#888") + "20", color: method?.color, borderRadius: 6, padding: "1px 6px", fontWeight: 600 }}>{method?.emoji} {method?.label}</span>
                        </div>
                        <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>
                          {rec?.label} · {String(e.date).slice(5)} {e.time} · {cat?.label}{e.note ? ` · ${e.note}` : ""}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 11, color: "#aaa" }}>{ntd(e.twd)}</div>
                        <button onClick={() => deleteExpense(e.id)} style={{
                          background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 16, padding: "2px 0", marginTop: 4,
                        }}>🗑</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── SUMMARY ── */}
        {view === "summary" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ background: "#fff", borderRadius: 14, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
              <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 14 }}>付款方式</div>
              {byMethod.map((m) => {
                const pct = totalKRW > 0 ? (m.krw / totalKRW) * 100 : 0;
                return (
                  <div key={m.id} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 13 }}>
                      <span>{m.emoji} {m.label}</span>
                      <span style={{ fontWeight: 600 }}>{formatKRW(m.krw)} <span style={{ color: "#aaa", fontWeight: 400, fontSize: 11 }}>≈{ntd(m.twd)}</span></span>
                    </div>
                    <div style={{ background: "#F0EDE8", borderRadius: 6, height: 8 }}>
                      <div style={{ width: `${pct}%`, background: m.color, height: 8, borderRadius: 6, transition: "width 0.4s ease", minWidth: pct > 0 ? 6 : 0 }} />
                    </div>
                    <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{pct.toFixed(1)}%</div>
                  </div>
                );
              })}
            </div>

            <div style={{ background: "#fff", borderRadius: 14, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
              <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 14 }}>消費類別</div>
              {byCategory.length === 0 ? (
                <div style={{ color: "#aaa", fontSize: 13 }}>尚無資料</div>
              ) : byCategory.map((c) => (
                <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #F0EDE8" }}>
                  <span style={{ fontSize: 13 }}>{c.emoji} {c.label}</span>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{formatKRW(c.krw)}</div>
                    <div style={{ fontSize: 11, color: "#aaa" }}>{ntd(c.twd)}</div>
                  </div>
                </div>
              ))}
            </div>

            {byRecorder.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 14, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 14 }}>每人小計</div>
                {byRecorder.map((r) => (
                  <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #F0EDE8" }}>
                    <span style={{ fontSize: 13 }}>{r.label}</span>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{formatKRW(r.krw)}</div>
                      <div style={{ fontSize: 11, color: "#aaa" }}>{ntd(r.twd)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ background: "#1C2340", borderRadius: 14, padding: 16, color: "#fff", textAlign: "center" }}>
              <div style={{ fontSize: 12, opacity: 0.6 }}>{TRIPS.find((t) => t.id === trip)?.label} 總花費</div>
              <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{formatKRW(totalKRW)}</div>
              <div style={{ fontSize: 14, opacity: 0.7, marginTop: 4 }}>≈ {ntd(totalTWD)} 新台幣</div>
              <div style={{ fontSize: 12, opacity: 0.5, marginTop: 8 }}>匯率 ₩1 ≈ NT${currentRate}</div>
            </div>
          </div>
        )}
      </div>

      {toast && (
        <div style={{
          position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)",
          background: "#1C2340", color: "#fff", padding: "10px 24px", borderRadius: 24,
          fontSize: 14, fontWeight: 600, boxShadow: "0 4px 16px rgba(0,0,0,0.2)", zIndex: 999,
        }}>{toast}</div>
      )}
    </div>
  );
}
