/**
 * Server-side EA request / license records (pluggable store — durable only with KV attached; see store.js).
 * Record key: eareq:<id>   (id = license jti)
 * Index:      eareq:index (all), eareq:owner:<uid> (per Google account)
 * Effective license status: revoked > active (paid && approved) > pending_approval (paid) > pending_payment.
 */
const S = require("./store");

function effective(rec) {
  if (!rec) return null;
  if (rec.revoked) return "revoked";
  if (rec.paid && rec.approved) return "active";
  if (rec.paid) return "pending_approval";
  return "pending_payment";
}

async function create(rec) {
  const st = S.store();
  await st.setJson("eareq:" + rec.id, rec);
  await st.sadd("eareq:index", rec.id);
  await st.sadd("eareq:owner:" + rec.owner_uid, rec.id);
  return rec;
}
async function get(id) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(id || ""))) return null;
  return S.store().getJson("eareq:" + id);
}
async function update(id, patch) {
  const rec = await get(id);
  if (!rec) return null;
  Object.assign(rec, patch, { updated_at: Date.now() });
  await S.store().setJson("eareq:" + id, rec);
  return rec;
}
async function list(indexKey) {
  const ids = await S.store().smembers(indexKey);
  const out = [];
  for (const id of ids.slice(-500)) {
    const r = await get(id);
    if (r) out.push(r);
  }
  out.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  return out;
}
function publicView(rec) {
  return {
    id: rec.id, ea: rec.ea, account: rec.account, server: rec.server,
    status: effective(rec), paid: !!rec.paid, approved: !!rec.approved, revoked: !!rec.revoked,
    delivery: rec.delivery || null, created_at: rec.created_at, license_expires_at: rec.license_expires_at,
  };
}

module.exports = { effective, create, get, update, list, publicView };
