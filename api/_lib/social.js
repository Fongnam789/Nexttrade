/**
 * Social Trade records (pluggable store: Upstash Redis when connected, in-memory otherwise — see store.js).
 *   social:master:<id>          master profile JSON (status: pending | approved | rejected | suspended)
 *   social:master_uid:<uid>     → master id owned by that Google account (one per account)
 *   social:masters              set of all master ids (admin list; public list filters approved)
 *   social:follow:<uid>         set of master ids this client follows
 *   social:followers:<id>       set of follower uids (count only is ever shown)
 * Links are pasted by the master; we never invent performance stats. No Brokeree API integration (link-out only).
 */
const crypto = require("crypto");
const S = require("./store");

const RISK = { low: "ต่ำ", medium: "กลาง", high: "สูง" };
const ID_RE = /^m_[A-Za-z0-9_-]{10,20}$/;

function uidOf(user) {
  return crypto.createHash("sha256").update(String(user.sub)).digest("hex").slice(0, 16);
}
function cleanText(v, max) {
  return String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
}
function httpsUrl(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  if (s.length > 400) return null;
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) return null;
  return u.toString();
}
function myfxbookUrl(v) {
  const s = httpsUrl(v);
  if (!s) return s;
  const u = new URL(s);
  if (u.hostname !== "www.myfxbook.com" || u.pathname.length < 2) return null;
  return s;
}

/** Profit sharing % entered by the Master: "" / null → null; 0–100 with ≤ 2 decimals; anything else → undefined (invalid). */
function pct(v) {
  if (v == null || String(v).trim() === "") return null;
  const s = String(v).trim().replace(/%$/, "");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return undefined;
  const n = Number(s);
  return n >= 0 && n <= 100 ? n : undefined;
}

/** Validate master profile input. Returns { ok, value } or { ok:false, error, field }. */
function validate(body) {
  const v = {
    display_name: cleanText(body.display_name, 40),
    strategy: cleanText(body.strategy, 2000),
    myfxbook_url: myfxbookUrl(body.myfxbook_url),
    brokeree_url: httpsUrl(body.brokeree_url),
    risk: String(body.risk || ""),
    min_deposit: cleanText(body.min_deposit, 60),
    profit_share_pct: pct(body.profit_share_pct),
    fee_details: cleanText(body.fee_details, 300),
  };
  if (v.profit_share_pct === undefined) return { ok: false, error: "bad_profit_share", field: "profit_share_pct" };
  if (v.display_name.length < 2) return { ok: false, error: "bad_display_name", field: "display_name" };
  if (v.strategy.length < 20) return { ok: false, error: "bad_strategy", field: "strategy" };
  if (v.myfxbook_url === null) return { ok: false, error: "bad_myfxbook_url", field: "myfxbook_url" };
  if (!v.brokeree_url) return { ok: false, error: "bad_brokeree_url", field: "brokeree_url" };
  if (!RISK[v.risk]) return { ok: false, error: "bad_risk", field: "risk" };
  return { ok: true, value: v };
}

async function getMaster(id) {
  if (!ID_RE.test(String(id || ""))) return null;
  return S.store().getJson("social:master:" + id);
}
async function masterOfUid(uid) {
  const id = await S.store().get("social:master_uid:" + uid);
  return id ? getMaster(id) : null;
}
async function saveMaster(m) {
  m.updated_at = Date.now();
  await S.store().setJson("social:master:" + m.id, m);
  return m;
}
async function createMaster(uid, email, v) {
  const st = S.store();
  const m = Object.assign({ id: "m_" + crypto.randomBytes(9).toString("base64url"), owner_uid: uid, email: email || "", status: "pending", created_at: Date.now() }, v);
  await saveMaster(m);
  await st.set("social:master_uid:" + uid, m.id);
  await st.sadd("social:masters", m.id);
  return m;
}
async function listMasters() {
  const ids = await S.store().smembers("social:masters");
  const out = [];
  for (const id of ids.slice(-500)) { const m = await getMaster(id); if (m) out.push(m); }
  out.sort((a, b) => (b.approved_at || b.created_at || 0) - (a.approved_at || a.created_at || 0));
  return out;
}
async function followerCount(id) {
  return ((await S.store().smembers("social:followers:" + id)) || []).length;
}
async function follow(uid, id, on) {
  const st = S.store();
  if (on) { await st.sadd("social:follow:" + uid, id); await st.sadd("social:followers:" + id, uid); }
  else { await st.srem("social:follow:" + uid, id); await st.srem("social:followers:" + id, uid); }
}
async function following(uid) {
  return (await S.store().smembers("social:follow:" + uid)) || [];
}
async function removeMaster(m) {
  const st = S.store();
  await st.del("social:master:" + m.id);
  await st.del("social:master_uid:" + m.owner_uid);
  await st.srem("social:masters", m.id);
  await st.del("social:followers:" + m.id);
}

/** Public (client-facing) view: no uid / email. */
function publicView(m, followers) {
  return {
    id: m.id, display_name: m.display_name, strategy: m.strategy, myfxbook_url: m.myfxbook_url || "",
    brokeree_url: m.brokeree_url, risk: m.risk, min_deposit: m.min_deposit || "",
    profit_share_pct: typeof m.profit_share_pct === "number" ? m.profit_share_pct : null, fee_details: m.fee_details || "",
    approved_at: m.approved_at || null, followers: followers == null ? undefined : followers,
  };
}
/** Owner view: public fields + status. */
function ownerView(m) {
  return Object.assign(publicView(m), { status: m.status, created_at: m.created_at, reject_note: m.reject_note || "" });
}

module.exports = { RISK, ID_RE, uidOf, validate, getMaster, masterOfUid, saveMaster, createMaster, listMasters, followerCount, follow, following, removeMaster, publicView, ownerView };
