/**
 * AI models for "ใช้ระบบของเรา": pricing (USD / 1M tokens), per-model caps, active model, cost assumptions.
 * Base data: ai_models.json (repo). Admin overrides live in the pluggable store (Upstash Redis when connected):
 *   cfg:ai_models_v1     { prices: {id: [tiers]}, caps: {id: {soft, hard}} }
 *   cfg:ai_model_active  { id, at }
 *   cfg:ai_cost_assump   { input_tokens, output_tokens, apply_token_factor }
 * The model id is used as the Vercel AI Gateway model id in /api/chat.
 */
const S = require("./store");
const BASE = require("../../ai_models.json");

const DEF_CAPS = BASE.default_caps || { soft: 100, hard: 150 };

function num(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 1e6) / 1e6 : null;
}
function isDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }

async function overrides() {
  let o = null;
  try { o = await S.store().getJson("cfg:ai_models_v1"); } catch (e) { o = null; }
  return { prices: (o && o.prices) || {}, caps: (o && o.caps) || {} };
}

async function models() {
  const o = await overrides();
  return BASE.models.map((m) => {
    const c = o.caps[m.id];
    return Object.assign({}, m, {
      pricing: o.prices[m.id] || m.pricing,
      prices_edited: !!o.prices[m.id],
      caps: c ? { soft: c.soft, hard: c.hard, set_by: "admin" } : { soft: DEF_CAPS.soft, hard: DEF_CAPS.hard, set_by: "default" },
    });
  });
}
async function find(id) {
  return (await models()).find((m) => m.id === id) || null;
}

/** Price tier in effect on a YYYY-MM-DD date (Asia/Bangkok "today" by default). */
function todayBkk() { return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10); }
function priceAt(m, day) {
  const d = day || todayBkk();
  const tiers = m.pricing || [];
  return tiers.find((t) => (!t.from || t.from <= d) && (!t.until || d <= t.until)) || tiers[tiers.length - 1] || null;
}

function cleanTiers(tiers) {
  if (!Array.isArray(tiers) || !tiers.length || tiers.length > 4) return null;
  const out = [];
  for (const t of tiers) {
    const input = num(t && t.input, 0, 1000), output = num(t && t.output, 0, 1000);
    if (input == null || output == null) return null;
    const x = { input, output };
    if (t.from) { if (!isDate(t.from)) return null; x.from = t.from; }
    if (t.until) { if (!isDate(t.until)) return null; x.until = t.until; }
    out.push(x);
  }
  return out;
}

async function setModel(id, body) {
  if (!BASE.models.some((m) => m.id === id)) throw new Error("unknown_model");
  const o = await overrides();
  if (body.pricing !== undefined) {
    const t = cleanTiers(body.pricing);
    if (!t) throw new Error("bad_pricing");
    o.prices[id] = t;
  }
  if (body.soft !== undefined || body.hard !== undefined) {
    const s = parseInt(body.soft, 10), h = parseInt(body.hard, 10);
    if (!(s > 0 && h > 0 && h >= s && h <= 1000000)) throw new Error("bad_caps");
    o.caps[id] = { soft: s, hard: h };
  }
  await S.store().setJson("cfg:ai_models_v1", o);
  return find(id);
}
async function resetModel(id) {
  const o = await overrides();
  delete o.prices[id];
  delete o.caps[id];
  await S.store().setJson("cfg:ai_models_v1", o);
  return find(id);
}

async function active() {
  let a = null;
  try { a = await S.store().getJson("cfg:ai_model_active"); } catch (e) { a = null; }
  if (!a || !a.id) return null;
  const m = await find(a.id);
  return m ? Object.assign({}, m, { activated_at: a.at }) : null;
}
async function setActive(id) {
  if (id == null || id === "") { await S.store().del("cfg:ai_model_active"); return null; }
  if (!BASE.models.some((m) => m.id === id)) throw new Error("unknown_model");
  await S.store().setJson("cfg:ai_model_active", { id, at: Date.now() });
  return active();
}

async function assumptions() {
  const d = BASE.default_assumptions || { input_tokens: 1500, output_tokens: 500, apply_token_factor: true };
  let a = null;
  try { a = await S.store().getJson("cfg:ai_cost_assump"); } catch (e) { a = null; }
  return Object.assign({}, d, a || {}, { set_by: a ? "admin" : "default" });
}
async function setAssumptions(body) {
  const i = parseInt(body.input_tokens, 10), o = parseInt(body.output_tokens, 10);
  if (!(i >= 0 && i <= 2000000 && o >= 0 && o <= 2000000)) throw new Error("bad_assumptions");
  const v = { input_tokens: i, output_tokens: o, apply_token_factor: body.apply_token_factor !== false };
  await S.store().setJson("cfg:ai_cost_assump", v);
  return assumptions();
}

module.exports = { BASE, DEF_CAPS, models, find, priceAt, todayBkk, setModel, resetModel, active, setActive, assumptions, setAssumptions };
