/**
 * AI usage caps for "ใช้ระบบของเรา" (our server key).
 * DEFAULTS ONLY — placeholders until an admin sets real values. Not final pricing.
 * Override per deployment with env vars (Vercel project settings):
 *   AI_CAP_SOFT_MESSAGES  soft cap: warn + notify, usage still allowed
 *   AI_CAP_HARD_MESSAGES  hard cap: block until the period resets or a top-up
 *   AI_CAP_PERIOD         "month" (default) or "day"; periods are counted in Asia/Bangkok time
 * Admin can override soft/hard/period from the admin page (stored under key "cfg:ai_caps" in the pluggable store;
 * durable only when KV is attached). Precedence: admin setting > env > DEFAULTS.
 * When an active AI model is selected, that model's own caps take precedence (see ai-models.js).
 * TODO(DB): per-account overrides + top-ups.
 */
const S = require("./store");
const DEFAULTS = { soft: 100, hard: 150, period: "month" };

function intEnv(name, dflt) {
  const n = parseInt(process.env[name] || "", 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

async function caps() {
  // Per-model caps: when an admin has selected an active model (/admin → AI Model), its own soft/hard
  // (requests per user per month) apply. Otherwise the global caps below.
  let am = null;
  try { am = await require("./ai-models").active(); } catch (e) { am = null; }
  if (am && am.caps) {
    return { soft: am.caps.soft, hard: am.caps.hard, period: "month", unit: "messages", is_default: am.caps.set_by !== "admin", set_by: "model", model: am.id };
  }
  let admin = null;
  try { admin = await S.store().getJson("cfg:ai_caps"); } catch (e) { admin = null; }
  let soft = admin && admin.soft > 0 ? admin.soft : intEnv("AI_CAP_SOFT_MESSAGES", DEFAULTS.soft);
  let hard = admin && admin.hard > 0 ? admin.hard : intEnv("AI_CAP_HARD_MESSAGES", DEFAULTS.hard);
  if (hard < soft) hard = soft;
  const p = (admin && admin.period) || process.env.AI_CAP_PERIOD || DEFAULTS.period;
  const period = p === "day" ? "day" : "month";
  const isDefault = !admin && !process.env.AI_CAP_SOFT_MESSAGES && !process.env.AI_CAP_HARD_MESSAGES;
  return { soft, hard, period, unit: "messages", is_default: isDefault, set_by: admin ? "admin" : (isDefault ? "default" : "env") };
}

async function setCaps(soft, hard, period) {
  const s = parseInt(soft, 10), h = parseInt(hard, 10);
  if (!(s > 0 && h > 0 && h >= s && h <= 1000000)) throw new Error("bad_caps");
  const v = { soft: s, hard: h, period: period === "day" ? "day" : "month", at: Date.now() };
  await S.store().setJson("cfg:ai_caps", v);
  return v;
}

/** Period id + reset time, Asia/Bangkok (UTC+7). */
function periodInfo(period, now) {
  const t = new Date((now || Date.now()) + 7 * 3600000);
  const y = t.getUTCFullYear(), m = t.getUTCMonth(), d = t.getUTCDate();
  if (period === "day") {
    return { id: y + "-" + (m + 1) + "-" + d, resets_at: new Date(Date.UTC(y, m, d + 1) - 7 * 3600000).toISOString() };
  }
  return { id: y + "-" + (m + 1), resets_at: new Date(Date.UTC(y, m + 1, 1) - 7 * 3600000).toISOString() };
}

function stateFor(used, c) {
  if (used >= c.hard) return "hard";
  if (used >= c.soft) return "soft";
  return "ok";
}

module.exports = { DEFAULTS, caps, setCaps, periodInfo, stateFor };
