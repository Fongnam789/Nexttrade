/**
 * Customer AI top-up ("ใช้ระบบของเรา"), bought by the customer only.
 *   GET  /api/ai/topup                         → { config, balance, orders, month, resets_at }
 *   POST /api/ai/topup {units, ack_large}      → new order with bill (needs price announced; large top-ups need ack)
 *   POST /api/ai/topup {action:"rebill", id}   → new bill no. / 30-min expiry for an unpaid order
 * Payment is confirmed by the admin in /admin; allocation then happens automatically server-side.
 * Auth: Authorization: Bearer <Google ID token>.
 */
const G = require("../_lib/google");
const L = require("../_lib/license");
const T = require("../_lib/ai-topup");
const S = require("../_lib/store");

const LIMIT = 30; // order writes per user per day

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const user = await G.userFromReq(req);
  if (!user) return L.send(res, 401, { error: "google_login_required" });
  try {
    if (req.method === "GET") return L.send(res, 200, await T.mine(user));
    if (req.method === "POST") {
      const day = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
      const n = await S.store().incr("rl:topup:" + require("crypto").createHash("sha256").update(String(user.sub)).digest("hex").slice(0, 24) + ":" + day, 1, 86400 * 2);
      if (n > LIMIT) return L.send(res, 429, { error: "rate_limited" });
      const body = await L.readBody(req);
      const r = body.action === "rebill" ? await T.rebill(user, body.id) : await T.create(user, body.units, body.ack_large === true);
      if (r.error) return L.send(res, r.error === "not_found" ? 404 : r.error === "price_not_announced" ? 409 : 400, r);
      return L.send(res, 200, { order: T.publicOrder(r.order), state: await T.mine(user) });
    }
    return L.send(res, 405, { error: "method_not_allowed" });
  } catch (e) {
    return L.send(res, 503, { error: "store_error" });
  }
};
