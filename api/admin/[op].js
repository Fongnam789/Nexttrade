/**
 * Admin API (single function, op from the path):
 *   POST /api/admin/login   {username, password}  → sets httpOnly session cookie
 *   POST /api/admin/logout
 *   GET  /api/admin/session
 *   GET  /api/admin/data                          → EA requests/licenses + AI caps
 *   POST /api/admin/action  {action, id?, soft?, hard?, period?}
 *        action: confirm_payment | approve | revoke | unrevoke | set_caps
 * Mutating calls need header X-NT-Admin: 1 (with SameSite=Strict cookie → CSRF protection). No CORS headers on purpose.
 */
const A = require("../_lib/admin-auth");
const R = require("../_lib/ea-requests");
const C = require("../_lib/ai-caps");
const S = require("../_lib/store");
const L = require("../_lib/license");

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
