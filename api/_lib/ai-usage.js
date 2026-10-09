/** Shared helpers: usage key per Google account + period, read / consume. */
const crypto = require("crypto");
const C = require("./ai-caps");
const S = require("./usage-store");

const TTL = 40 * 86400;

function keyFor(sub, pid) {
  return "ai_usage:" + crypto.createHash("sha256").update(String(sub)).digest("hex").slice(0, 32) + ":" + pid;
}

async function snapshot(sub) {
  const c = await C.caps();
  const p = C.periodInfo(c.period);
  const st = S.store();
  const used = await st.get(keyFor(sub, p.id));
  return {
    used,
    soft: c.soft,
    hard: c.hard,
    unit: c.unit,
    period: c.period,
    resets_at: p.resets_at,
    state: C.stateFor(used, c),
    caps_are_defaults: c.is_default,
    store: st.kind,
    durable: st.durable,
  };
}

/** Atomically reserve one message. Returns { allowed, usage }. */
async function consume(sub) {
  const c = await C.caps();
  const p = C.periodInfo(c.period);
  const st = S.store();
  const k = keyFor(sub, p.id);
  const before = await st.get(k);
  if (before >= c.hard) return { allowed: false, usage: await snapshot(sub) };
  const n = await st.incr(k, 1, TTL);
  if (n > c.hard) return { allowed: false, usage: await snapshot(sub) };
  return { allowed: true, usage: await snapshot(sub) };
}

module.exports = { snapshot, consume };
