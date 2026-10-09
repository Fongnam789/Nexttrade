/**
 * GET /api/ai/usage — current AI usage for the signed-in Google account ("ใช้ระบบของเรา" mode).
 * Auth: Authorization: Bearer <Google ID token>.
 */
const G = require("../_lib/google");
const U = require("../_lib/ai-usage");
const C = require("../_lib/ai-caps");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "GET") { res.statusCode = 405; return res.end(JSON.stringify({ error: "method_not_allowed" })); }
  const user = await G.userFromReq(req);
  if (!user) {
    const c = await C.caps();
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: "google_login_required", soft: c.soft, hard: c.hard, period: c.period, caps_are_defaults: c.is_default }));
  }
  try {
    const u = await U.snapshot(user.sub);
    u.server_key_configured = String(process.env.CHAT_ALLOW_SERVER_KEYS || "") === "1";
    res.statusCode = 200;
    return res.end(JSON.stringify(u));
  } catch (e) {
    res.statusCode = 503;
    return res.end(JSON.stringify({ error: "usage_store_error" }));
  }
};
