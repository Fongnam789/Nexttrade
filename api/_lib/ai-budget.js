/**
 * Purchased AI token/credit budgets + low-balance alerts (admin only).
 *
 * Budget = what the company bought for a model ("model:<gateway id>") or a provider ("provider:<name>"),
 * in USD credit or in tokens. Consumption is recorded from /api/chat "ใช้ระบบของเรา" responses only
 * (real usage.prompt_tokens / completion_tokens returned by the AI Gateway, priced with ai_models.json /
 * admin-edited prices for the day, Asia/Bangkok). BYOK traffic is the customer's own bill and is not counted.
 *
 * When remaining ≤ 20 %, 10 %, 5 % an alert fires ONCE per threshold per budget period (period = since the
 * last "เติม token" top-up): stored in the admin alert list and pushed to Telegram and/or LINE when the env
 * pair is configured (ADMIN_ALERT_TELEGRAM_BOT_TOKEN + ADMIN_ALERT_TELEGRAM_CHAT_ID,
 * ADMIN_ALERT_LINE_TOKEN + ADMIN_ALERT_LINE_TO). Missing channels are skipped silently.
 * Needs a durable store (Upstash) — with the in-memory fallback counters/alerts are lost on cold start.
 */
const { store } = require("./store");
const AM = require("./ai-models");

const K_BUDGETS = "cfg:ai_budgets_v1";
const K_ALERTS = "ai:alerts_v1";
const THRESHOLDS = [20, 10, 5];
const MICRO = 1e6; // USD stored as micro-dollars (integer INCRBY)

function usedKey(b) { return "ai:budget_used:" + b.key + ":" + b.started_at; }
function firedKey(b) { return "ai:budget_fired:" + b.key + ":" + b.started_at; }

async function list() {
  const v = await store().getJson(K_BUDGETS);
  return v && Array.isArray(v.list) ? v.list : [];
}
async function saveList(l) { await store().setJson(K_BUDGETS, { list: l }); }

function providers() {
  const s = new Set();
  AM.BASE.models.forEach((m) => s.add(m.provider));
  return [...s];
}

function cleanAmount(unit, amount) {
  const n = Number(amount);
  if (!isFinite(n) || n <= 0) return null;
  if (unit === "tokens") return n <= 1e13 ? Math.round(n) : null;
  return n <= 1e7 ? Math.round(n * 100) / 100 : null;
}

/** Create or replace a budget for a scope/target. Replacing keeps the running period unless amount/unit changed. */
async function set({ scope, target, unit, amount, note }) {
  scope = scope === "provider" ? "provider" : scope === "model" ? "model" : null;
  if (!scope) return { error: "bad_scope" };
  target = String(target || "");
  if (scope === "model" && !AM.BASE.models.some((m) => m.id === target)) return { error: "unknown_model" };
  if (scope === "provider" && !providers().includes(target)) return { error: "unknown_provider" };
  unit = unit === "tokens" ? "tokens" : unit === "usd" ? "usd" : null;
  if (!unit) return { error: "bad_unit" };
  const amt = cleanAmount(unit, amount);
  if (amt == null) return { error: "bad_amount" };
  const key = scope + ":" + target;
  const l = await list();
  const i = l.findIndex((b) => b.key === key);
  const b = { key, scope, target, unit, amount: amt, note: String(note || "").slice(0, 120), started_at: Date.now() };
  if (i >= 0) l[i] = b; else l.push(b);
  await saveList(l);
  return { ok: true };
}

/** "เติม token": start a new period (counter 0, thresholds re-armed). Optional new amount (else same as before). */
async function topup(key, amount) {
  const l = await list();
  const b = l.find((x) => x.key === key);
  if (!b) return { error: "unknown_budget" };
  if (amount != null && amount !== "") {
    const amt = cleanAmount(b.unit, amount);
    if (amt == null) return { error: "bad_amount" };
    b.amount = amt;
  }
  b.started_at = Date.now();
  b.topped_up_at = b.started_at;
  await saveList(l);
  return { ok: true };
}

async function remove(key) {
  const l = await list();
  const n = l.filter((b) => b.key !== key);
  if (n.length === l.length) return { error: "unknown_budget" };
  await saveList(n);
  return { ok: true };
}

async function usedOf(b) {
  const raw = Number(await store().get(usedKey(b))) || 0;
  return b.unit === "usd" ? raw / MICRO : raw;
}

async function view() {
  const l = await list();
  const out = [];
  for (const b of l) {
    const used = await usedOf(b);
    const remaining = Math.max(0, b.amount - used);
    const fired = (await store().smembers(firedKey(b))).map(Number).sort((a, c) => c - a);
    out.push(Object.assign({}, b, { used, remaining, remaining_pct: b.amount > 0 ? (remaining / b.amount) * 100 : 0, fired }));
  }
  return out;
}

function channels() {
  const e = process.env;
  return {
    telegram: !!(e.ADMIN_ALERT_TELEGRAM_BOT_TOKEN && e.ADMIN_ALERT_TELEGRAM_CHAT_ID),
    line: !!(e.ADMIN_ALERT_LINE_TOKEN && e.ADMIN_ALERT_LINE_TO),
  };
}

async function postJson(url, headers, body) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 5000);
  try {
    const r = await fetch(url, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, headers), body: JSON.stringify(body), signal: ctl.signal });
    return r.ok;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** Push to configured admin channels. Tokens are only used as request credentials; never logged or returned. */
async function notify(text) {
  const e = process.env;
  const sent = [];
  if (e.ADMIN_ALERT_TELEGRAM_BOT_TOKEN && e.ADMIN_ALERT_TELEGRAM_CHAT_ID) {
    const ok = await postJson("https://api.telegram.org/bot" + e.ADMIN_ALERT_TELEGRAM_BOT_TOKEN + "/sendMessage", {}, { chat_id: e.ADMIN_ALERT_TELEGRAM_CHAT_ID, text, disable_web_page_preview: true });
    sent.push({ channel: "telegram", ok });
  }
  if (e.ADMIN_ALERT_LINE_TOKEN && e.ADMIN_ALERT_LINE_TO) {
    const ok = await postJson("https://api.line.me/v2/bot/message/push", { Authorization: "Bearer " + e.ADMIN_ALERT_LINE_TOKEN }, { to: e.ADMIN_ALERT_LINE_TO, messages: [{ type: "text", text }] });
    sent.push({ channel: "line", ok });
  }
  return sent;
}

function fmt(b, v) {
  return b.unit === "usd" ? "$" + v.toFixed(2) : Math.round(v).toLocaleString("en-US") + " tokens";
}

async function alerts() {
  const v = await store().getJson(K_ALERTS);
  return Array.isArray(v) ? v : [];
}
async function ackAll() {
  const l = await alerts();
  l.forEach((a) => { a.ack = true; });
  await store().setJson(K_ALERTS, l);
  return { ok: true };
}

/** Add consumption (usd + tokens) to every budget matching model m; fire threshold alerts. `why` labels the alert. */
async function addUsage(m, usd, tokens, why) {
  const l = await list();
  const hits = [];
  for (const b of l) {
    if (!((b.scope === "model" && b.target === m.id) || (b.scope === "provider" && b.target === m.provider))) continue;
    const by = b.unit === "usd" ? Math.round(usd * MICRO) : Math.round(tokens);
    if (by <= 0) continue;
    const raw = await store().incr(usedKey(b), by);
    hits.push(b.key);
    const used = b.unit === "usd" ? raw / MICRO : raw;
    const remPct = b.amount > 0 ? (Math.max(0, b.amount - used) / b.amount) * 100 : 0;
    // only the lowest newly crossed threshold produces a message, but all crossed ones are marked fired
    const crossed = THRESHOLDS.filter((t) => remPct <= t);
    let newest = null;
    for (const t of crossed) {
      const added = Number(await store().sadd(firedKey(b), String(t))) === 1;
      if (added && (newest == null || t < newest)) newest = t;
    }
    if (newest == null) continue;
    const label = b.scope === "model" ? (m.label + " (" + m.id + ")") : ("ผู้ให้บริการ " + b.target);
    const text = "⚠️ NEXTTRADE: token/เครดิต AI ใกล้หมด — " + label + " เหลือ " + remPct.toFixed(1) + "% (" + fmt(b, Math.max(0, b.amount - used)) + " จาก " + fmt(b, b.amount) + ") · แตะเกณฑ์ " + newest + "%" + (why ? " · " + why : "") + " · เติมแล้วกด 'เติม token' ใน /admin";
    const sent = await notify(text);
    const a = { at: Date.now(), budget: b.key, threshold: newest, remaining_pct: Math.round(remPct * 10) / 10, text, sent, ack: false };
    const al = await alerts();
    al.unshift(a);
    await store().setJson(K_ALERTS, al.slice(0, 50));
  }
  return hits;
}

/**
 * Record one /api/chat (ours mode) call served from the customer's BASE monthly caps.
 * usage = OpenAI-style {prompt_tokens, completion_tokens} from the gateway response. Never throws.
 * (Calls served from a purchased top-up are not recorded again: their cost was deducted at allocation.)
 */
async function record(modelId, usage) {
  try {
    const pin = Math.max(0, Number(usage && usage.prompt_tokens) || 0);
    const pout = Math.max(0, Number(usage && usage.completion_tokens) || 0);
    if (!pin && !pout) return;
    const m = (await AM.models()).find((x) => x.id === modelId);
    if (!m) return;
    const price = AM.priceAt(m, AM.todayBkk()) || { input: 0, output: 0 };
    await addUsage(m, (pin * price.input + pout * price.output) / 1e6, pin + pout, "");
  } catch (e) {
    /* swallow */
  }
}

/**
 * Customer top-up allocation: deduct the ESTIMATED cost of `requests` (admin assumptions: tokens/request,
 * token factor, today's price of the active model) from the company pool budgets of that model/provider.
 */
async function allocate(modelId, requests, why) {
  const m = (await AM.models()).find((x) => x.id === modelId);
  if (!m) return { model: null, usd: 0, tokens: 0, budgets: [] };
  const a = await AM.assumptions();
  const f = a.apply_token_factor !== false && m.token_factor ? m.token_factor : 1;
  const price = AM.priceAt(m, AM.todayBkk()) || { input: 0, output: 0 };
  const tin = requests * a.input_tokens * f, tout = requests * a.output_tokens * f;
  const usd = (tin * price.input + tout * price.output) / 1e6;
  const budgets = await addUsage(m, usd, tin + tout, why || "จัดสรรให้ top-up ลูกค้า");
  return { model: m.id, usd: Math.round(usd * 1e6) / 1e6, tokens: Math.round(tin + tout), budgets };
}

async function state() {
  return { budgets: await view(), alerts: await alerts(), channels: channels(), thresholds: THRESHOLDS, providers: providers() };
}

module.exports = { THRESHOLDS, list, set, topup, remove, view, alerts, ackAll, record, allocate, channels, notify, state };
