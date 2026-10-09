/**
 * Customer view of own EA requests (server records created by POST /api/license).
 *   GET  /api/ea/requests            → { requests: [...], durable }
 *   POST /api/ea/requests {id, delivery: "download"|"vps"} → update delivery choice
 * Auth: Authorization: Bearer <Google ID token>.
 */
const crypto = require("crypto");
const G = require("../_lib/google");
const R = require("../_lib/ea-requests");
const S = require("../_lib/store");
const L = require("../_lib/license");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const user = await G.userFromReq(req);
  if (!user) return L.send(res, 401, { error: "google_login_required" });
  const uid = crypto.createHash("sha256").update(String(user.sub)).digest("hex").slice(0, 16);
  try {
    if (req.method === "GET") {
      const list = await R.list("eareq:owner:" + uid);
      return L.send(res, 200, { requests: list.map(R.publicView), durable: S.store().durable });
    }
    if (req.method === "POST") {
      const body = await L.readBody(req);
      const rec = await R.get(body.id);
      if (!rec || rec.owner_uid !== uid) return L.send(res, 404, { error: "not_found" });
      if (body.delivery !== "download" && body.delivery !== "vps") return L.send(res, 400, { error: "bad_delivery" });
      const upd = await R.update(rec.id, { delivery: body.delivery });
      return L.send(res, 200, { request: R.publicView(upd) });
    }
    return L.send(res, 405, { error: "method_not_allowed" });
  } catch (e) {
    return L.send(res, 503, { error: "store_error" });
  }
};
