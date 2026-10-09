/**
 * Shared helpers: usage key per Google account + period, read / consume.
 * Base caps (soft/hard) come from ai-caps (active model's own caps when set). Beyond the base hard cap the customer
 * can keep going only with a purchased top-up for this month (ai-topup; never rolls over, never refilled by admin).
 */
const crypto = require("crypto");
const C = require("./ai-caps");
const S = require("./usage-store");

const TTL = 40 * 86400;

function hsub(sub) { return crypto.createHash("sha256").update(String(sub)).digest("hex").slice(0, 32); }
function keyFor(sub, pid) { return "ai_usage:" + hsub(sub) + ":" + pid; }
function topupUsedKey(sub, mid) { return "ai_topup_used:" + hsub(sub) + ":" + mid; }

async function topupState(sub) {
  const T = require("./ai-topup");
  const mid = C.periodInfo("month").id;
  const st = S.store();
  const granted = Number(await st.get(T.balKey(sub, mid))) || 0;
  const used = Number(await st.get(topupUsedKey(sub, mid))) || 0;
  return { mid, granted, used, left: Math.max(0, granted - used) };
}

async function snapshot(sub) {
  const c = await C.caps();
  const p = C.periodInfo(c.period);
  const st = S.store();
  const used = Number(await st.get(keyFor(sub, p.id))) || 0;
  const t = await topupState(sub);
  let state = C.stateFor(used, c);
  if (state === "hard" && t.left > 0) state = "soft"; // still allowed, running on top-up
  return {
    used,
    soft: c.soft,
    hard: c.hard,
    unit: c.unit,
    period: c.period,
    resets_at: p.resets_at,
    state,
    on_topup: used >= c.hard && t.left > 0,
    topup_granted: t.granted,
    topup_used: t.used,
    topup_left: t.left,
    topup_resets_at: C.periodInfo("month").resets_at,
    caps_are_defaults: c.is_default,
    store: st.kind,
    durable: st.durable,
  };
}

/** Atomically reserve one message. Returns { allowed, usage, from_topup }. */
async function consume(sub) {
  const c = await C.caps();
  const p = C.periodInfo(c.period);
  const st = S.store();
  const k = keyFor(sub, p.id);
  const before = Number(await st.get(k)) || 0;
  if (before < c.hard) {
    const n = await st.incr(k, 1, TTL);
    if (n <= c.hard) return { allowed: true, from_topup: false, usage: await snapshot(sub) };
    await st.incr(k, -1, TTL); // lost the race for the last base slot → try top-up
  }
  const t = await topupState(sub);
  if (t.left > 0) {
    const tk = topupUsedKey(sub, t.mid);
    const n = await st.incr(tk, 1, TTL);
    if (n <= t.granted) return { allowed: true, from_topup: true, usage: await snapshot(sub) };
    await st.incr(tk, -1, TTL);
  }
  return { allowed: false, from_topup: false, usage: await snapshot(sub) };
}

module.exports = { snapshot, consume };
