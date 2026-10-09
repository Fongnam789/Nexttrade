/**
 * Admin API (single function, op from the path):
 *   POST /api/admin/login   {username, password}  → sets httpOnly session cookie
 *   POST /api/admin/logout
 *   GET  /api/admin/session
 *   GET  /api/admin/data                          → EA requests/licenses + AI caps
 *   POST /api/admin/action  {action, id?, soft?, hard?, period?}
 *        action: confirm_payment | approve | revoke | unrevoke | set_caps
 *                | issue  {ea, account, server, test?}  → admin-issued license (signed server-side, st=pending_payment)
 *                | delete {id}                          → remove a license record (e.g. test records)
 *                | master_approve | master_reject {note?} | master_suspend | master_delete  {id: m_…}  → Social Trade Masters
 * Mutating calls need header X-NT-Admin: 1 (with SameSite=Strict cookie → CSRF protection). No CORS headers on purpose.
 */
const A = require("../_lib/admin-auth");
const R = require("../_lib/ea-requests");
const C = require("../_lib/ai-caps");
const S = require("../_lib/store");
const L = require("../_lib/license");
const crypto = require("crypto");
const catalog = require("../../ea_catalog.json");
const M = require("../_lib/social");

function send(res, status, obj) {
  res.setHeader("Cache-Control", "no-store");
  return L.send(res, status, obj);
}
function csrfOk(req) {
  return String(req.headers["x-nt-admin"] || "") === "1";
}

module.exports = async function handler(req, res) {
  const op = String((req.query && req.query.op) || "").toLowerCase();
  if (!A.configured()) return send(res, 503, { error: "admin_not_configured" });

  try {
    if (op === "login") {
      if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
      if (!csrfOk(req)) return send(res, 400, { error: "bad_request" });
      const ls = await A.lockState(A.clientIp(req));
      if (ls.locked) return send(res, 429, { error: "locked", retry_after_sec: 900 });
      let body;
      try { body = await L.readBody(req); } catch (e) { return send(res, 400, { error: "bad_json" }); }
      const userOk = A.safeEqStr(body.username, process.env.ADMIN_USER);
      const passOk = A.verifyPassword(body.password, process.env.ADMIN_PASSWORD_HASH);
      if (!(userOk && passOk)) {
        await A.recordFail(ls);
        await new Promise((r) => setTimeout(r, 400));
        return send(res, 401, { error: "invalid_credentials" });
      }
      await A.clearFail(ls);
      A.setCookie(res, A.makeSession(process.env.ADMIN_USER), A.SESSION_SEC);
      return send(res, 200, { ok: true });
    }

    if (op === "logout") {
      if (req.method !== "POST" || !csrfOk(req)) return send(res, 400, { error: "bad_request" });
      A.setCookie(res, "", 0);
      return send(res, 200, { ok: true });
    }

    const sess = A.session(req);
    if (op === "session") return send(res, sess ? 200 : 401, sess ? { ok: true, exp: sess.exp } : { error: "unauthorized" });
    if (!sess) return send(res, 401, { error: "unauthorized" });

    if (op === "data") {
      if (req.method !== "GET") return send(res, 405, { error: "method_not_allowed" });
      const list = await R.list("eareq:index");
      const st = S.store();
      return send(res, 200, {
        requests: list.map((r) => Object.assign(R.publicView(r), { email: r.email || "" })),
        caps: await C.caps(),
        masters: await Promise.all((await M.listMasters()).map(async (m) => Object.assign(M.ownerView(m), { email: m.email || "", followers: await M.followerCount(m.id) }))),
        store: st.kind,
        durable: st.durable,
      });
    }

    if (op === "action") {
      if (req.method !== "POST" || !csrfOk(req)) return send(res, 400, { error: "bad_request" });
      const body = await L.readBody(req);
      const a = String(body.action || "");
      if (a === "set_caps") {
        try { return send(res, 200, { caps: await C.setCaps(body.soft, body.hard, body.period) }); }
        catch (e) { return send(res, 400, { error: "bad_caps" }); }
      }
      if (a === "issue") {
        if (!L.secret()) return send(res, 503, { error: "license_secret_unset" });
        const ea = String(body.ea || "").trim();
        const account = String(body.account || "").trim();
        const server = L.normServer(body.server);
        if (!L.SLUG_RE.test(ea) || !(catalog.eas || []).some((x) => x.slug === ea)) return send(res, 400, { error: "unknown_ea" });
        if (!L.ACCOUNT_RE.test(account)) return send(res, 400, { error: "bad_account" });
        if (!L.SERVER_RE.test(server)) return send(res, 400, { error: "bad_server" });
        const days = Math.min(Math.max(parseInt(process.env.LICENSE_PENDING_DAYS || "30", 10) || 30, 1), 365);
        const iat = Math.floor(Date.now() / 1000);
        const payload = { v: 1, ea: ea, acct: account, srv: server, st: "pending_payment", iat: iat, exp: iat + days * 86400, uid: "admin", jti: crypto.randomBytes(12).toString("base64url") };
        const key = L.sign(payload);
        const rec0 = await R.create({
          id: payload.jti, ea: ea, account: account, server: server, owner_uid: "admin", email: "",
          paid: false, approved: false, revoked: false, delivery: null, issued_by: "admin", test: !!body.test,
          created_at: Date.now(), license_expires_at: new Date(payload.exp * 1000).toISOString(),
        });
        return send(res, 200, { request: R.publicView(rec0), key: key });
      }
      if (a.indexOf("master_") === 0) {
        const m = await M.getMaster(body.id);
        if (!m) return send(res, 404, { error: "not_found" });
        if (a === "master_delete") { await M.removeMaster(m); return send(res, 200, { ok: true }); }
        if (a === "master_approve") Object.assign(m, { status: "approved", approved_at: m.approved_at || Date.now(), reject_note: "" });
        else if (a === "master_reject") Object.assign(m, { status: "rejected", reject_note: String(body.note || "").slice(0, 200) });
        else if (a === "master_suspend") Object.assign(m, { status: "suspended" });
        else return send(res, 400, { error: "unknown_action" });
        await M.saveMaster(m);
        return send(res, 200, { master: Object.assign(M.ownerView(m), { email: m.email || "" }) });
      }
      if (a === "delete") {
        const ok = await R.remove(body.id);
        return send(res, ok ? 200 : 404, ok ? { ok: true } : { error: "not_found" });
      }
      const rec = await R.get(body.id);
      if (!rec) return send(res, 404, { error: "not_found" });
      let patch;
      if (a === "confirm_payment") patch = { paid: true, paid_confirmed_at: Date.now() };
      else if (a === "approve") {
        if (!rec.paid) return send(res, 409, { error: "not_paid" });
        patch = { approved: true, approved_at: Date.now() };
      } else if (a === "revoke") patch = { revoked: true, revoked_at: Date.now() };
      else if (a === "unrevoke") patch = { revoked: false };
      else return send(res, 400, { error: "unknown_action" });
      const upd = await R.update(rec.id, patch);
      return send(res, 200, { request: Object.assign(R.publicView(upd), { email: upd.email || "" }) });
    }

    return send(res, 404, { error: "not_found" });
  } catch (e) {
    return send(res, 503, { error: "server_error" });
  }
};
