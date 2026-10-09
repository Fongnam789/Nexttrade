/**
 * Verify a Google ID token server-side (Google tokeninfo endpoint).
 * aud must equal GOOGLE_CLIENT_ID (env) or the public web client id from config.js.
 */
const DEFAULT_CLIENT_ID = "680268728616-uasvqesui9dgqhth085791h27rtdh6ts.apps.googleusercontent.com";

function bearer(req) {
  const auth = String((req.headers && req.headers.authorization) || "");
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
}

async function verifyGoogle(idToken) {
  if (!idToken) return null;
  try {
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken));
    if (!r.ok) return null;
    const t = await r.json();
    const aud = process.env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID;
    if (t.aud !== aud) return null;
    if (!(t.iss === "accounts.google.com" || t.iss === "https://accounts.google.com")) return null;
    if (Number(t.exp) * 1000 < Date.now()) return null;
    if (String(t.email_verified) !== "true") return null;
    return { sub: String(t.sub), email: t.email };
  } catch (e) {
    return null;
  }
}

async function userFromReq(req) {
  return verifyGoogle(bearer(req));
}

module.exports = { verifyGoogle, userFromReq, bearer };
