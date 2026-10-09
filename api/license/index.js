/**
 * POST /api/license — issue an EA license bound to an MT5 account.
 * Auth: Authorization: Bearer <Google ID token> (verified server-side with Google tokeninfo; aud must match GOOGLE_CLIENT_ID).
 * Body: { ea: "<slug from ea_catalog.json>", account: "<MT5 login digits>", server: "<broker server>" }
 * Payment/approval backend does not exist yet → every key is issued with st="pending_payment"
 * (bound to the account, but EA must not trade until /api/license/verify returns trade_allowed=true).
 * No license is ever signed in browser JS.
 */
const crypto = require("crypto");
const L = require("../_lib/license");
const catalog = require("../../ea_catalog.json");
const G = require("../_lib/google");
const R = require("../_lib/ea-requests");
const S = require("../_lib/store");

module.exports = async function handler(req, res) {
  L.cors(res, "POST,OPTIONS");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return L.send(res, 405, { error: "method_not_allowed" });
  if (!L.secret()) return L.send(res, 503, { error: "license_secret_unset" });

  let body;
  try { body = await L.readBody(req); } catch (e) { return L.send(res, 400, { error: "bad_json" }); }

  const user = await G.userFromReq(req);
  if (!user) return L.send(res, 401, { error: "google_login_required" });

  const ea = String(body.ea || "").trim();
  const account = String(body.account || "").trim();
  const server = L.normServer(body.server);
  if (!L.SLUG_RE.test(ea) || !(catalog.eas || []).some((x) => x.slug === ea)) return L.send(res, 400, { error: "unknown_ea" });
  if (!L.ACCOUNT_RE.test(account)) return L.send(res, 400, { error: "bad_account" });
  if (!L.SERVER_RE.test(server)) return L.send(res, 400, { error: "bad_server" });

  const uid = crypto.createHash("sha256").update(String(user.sub)).digest("hex").slice(0, 16);
  // Basic abuse limit: 20 licenses per Google account per day (best-effort without KV).
  try {
    const n = await S.store().incr("rl:license:" + uid + ":" + new Date().toISOString().slice(0, 10), 1, 86400);
    if (n > 20) return L.send(res, 429, { error: "too_many_requests" });
  } catch (e) {}
  const delivery = body.delivery === "download" || body.delivery === "vps" ? body.delivery : null;

  const days = Math.min(Math.max(parseInt(process.env.LICENSE_PENDING_DAYS || "30", 10) || 30, 1), 365);
  const iat = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    ea: ea,
    acct: account,
    srv: server,
    st: "pending_payment",
    iat: iat,
    exp: iat + days * 86400,
    uid: uid,
    jti: crypto.randomBytes(12).toString("base64url"),
  };
  let key;
  try { key = L.sign(payload); } catch (e) { return L.send(res, e.status || 500, { error: e.message }); }
  try {
    await R.create({
      id: payload.jti, ea: ea, account: account, server: server, owner_uid: uid, email: user.email || "",
      paid: false, approved: false, revoked: false, delivery: delivery,
      created_at: Date.now(), license_expires_at: new Date(payload.exp * 1000).toISOString(),
    });
  } catch (e) {}
  return L.send(res, 200, {
    id: payload.jti,
    key: key,
    ea: ea,
    account: account,
    server: server,
    status: payload.st,
    issued_at: new Date(iat * 1000).toISOString(),
    expires_at: new Date(payload.exp * 1000).toISOString(),
  });
};
