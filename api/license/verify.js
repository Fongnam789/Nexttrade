/**
 * POST /api/license/verify — public check used by the EA (MT5 WebRequest) or tools.
 * Body: { key, account, server?, ea? }
 * Response: { valid, status, trade_allowed, ea, account, server, expires_at, reason? }
 * trade_allowed is true only for a valid, unexpired key with status "active" bound to this account.
 * Current status comes from the server record (admin: confirm payment / approve / revoke) when the store has it;
 * otherwise falls back to the status signed into the key ("pending_payment"). Durable only with KV attached.
 */
const L = require("../_lib/license");
const R = require("../_lib/ea-requests");

module.exports = async function handler(req, res) {
  L.cors(res, "POST,OPTIONS");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return L.send(res, 405, { error: "method_not_allowed" });

  let body;
  try { body = await L.readBody(req); } catch (e) { return L.send(res, 400, { error: "bad_json" }); }

  const r = L.verifyKey(body.key);
  if (!r.ok) return L.send(res, r.status || 200, { valid: false, trade_allowed: false, reason: r.reason });
  const p = r.payload;
  let status = p.st;
  try {
    const rec = p.jti ? await R.get(p.jti) : null;
    if (rec) status = R.effective(rec);
  } catch (e) {}
  const out = {
    valid: true,
    status: status,
    ea: p.ea,
    account: p.acct,
    server: p.srv,
    expires_at: new Date(p.exp * 1000).toISOString(),
  };
  const fail = (reason) => L.send(res, 200, Object.assign(out, { valid: false, trade_allowed: false, reason }));
  if (status === "revoked") return fail("revoked");
  if (Date.now() / 1000 > p.exp) return fail("expired");
  if (body.account == null || String(body.account).trim() !== String(p.acct)) return fail("account_mismatch");
  if (body.server && L.normServer(body.server).toLowerCase() !== String(p.srv).toLowerCase()) return fail("server_mismatch");
  if (body.ea && String(body.ea).trim() !== p.ea) return fail("ea_mismatch");
  out.trade_allowed = status === "active";
  if (!out.trade_allowed) out.reason = status;
  return L.send(res, 200, out);
};
