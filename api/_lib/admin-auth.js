/**
 * Admin auth (separate from customer Google login).
 * Env (Vercel only, never committed):
 *   ADMIN_USER             admin username
 *   ADMIN_PASSWORD_HASH    "scrypt:<N>:<r>:<p>:<salt b64url>:<hash b64url>" (make with scripts/hash-admin-password.js)
 *   ADMIN_SESSION_SECRET   ≥32 random chars, signs the httpOnly session cookie
 * Lockout: 5 failures per IP / 15 min, 20 failures overall / 15 min (store-backed; durable only with KV).
 */
const crypto = require("crypto");
const S = require("./store");

const COOKIE = "__Host-nt_admin";
const SESSION_SEC = 8 * 3600;
const WINDOW = 15 * 60;
const MAX_IP = 5;
const MAX_ALL = 20;

function configured() {
  return !!(process.env.ADMIN_USER && process.env.ADMIN_PASSWORD_HASH && (process.env.ADMIN_SESSION_SECRET || "").length >= 32);
}

function verifyPassword(password, stored) {
  const parts = String(stored || "").split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = parseInt(parts[1], 10), r = parseInt(parts[2], 10), p = parseInt(parts[3], 10);
  const salt = Buffer.from(parts[4], "base64url");
  const expect = Buffer.from(parts[5], "base64url");
  let got;
  try {
    got = crypto.scryptSync(String(password || ""), salt, expect.length, { N, r, p, maxmem: 256 * 1024 * 1024 });
  } catch (e) { return false; }
  return got.length === expect.length && crypto.timingSafeEqual(got, expect);
}

function safeEqStr(a, b) {
  const x = crypto.createHash("sha256").update(String(a || "")).digest();
  const y = crypto.createHash("sha256").update(String(b || "")).digest();
  return crypto.timingSafeEqual(x, y);
}

function clientIp(req) {
  const xf = String((req.headers && req.headers["x-forwarded-for"]) || "").split(",")[0].trim();
  return xf || (req.socket && req.socket.remoteAddress) || "unknown";
}

async function lockState(ip) {
  const st = S.store();
  const ipHash = crypto.createHash("sha256").update(ip).digest("hex").slice(0, 24);
  const kIp = "admin:fail:ip:" + ipHash;
  const kAll = "admin:fail:all";
  const nIp = parseInt((await st.get(kIp)) || "0", 10) || 0;
  const nAll = parseInt((await st.get(kAll)) || "0", 10) || 0;
  return { kIp, kAll, locked: nIp >= MAX_IP || nAll >= MAX_ALL };
}
async function recordFail(ls) {
  const st = S.store();
  await st.incr(ls.kIp, 1, WINDOW);
  await st.incr(ls.kAll, 1, WINDOW);
}
async function clearFail(ls) {
  await S.store().del(ls.kIp);
}

function sign(data) {
  return crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(data).digest("base64url");
}
function makeSession(user) {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ u: user, iat: now, exp: now + SESSION_SEC, n: crypto.randomBytes(8).toString("hex") })).toString("base64url");
  return body + "." + sign(body);
}
function readCookie(req, name) {
  const raw = String((req.headers && req.headers.cookie) || "");
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}
function session(req) {
  if (!configured()) return null;
  const c = readCookie(req, COOKIE);
  const [body, sig] = c.split(".");
  if (!body || !sig) return null;
  const expect = sign(body);
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch (e) { return null; }
  if (!p || p.exp < Date.now() / 1000) return null;
  if (!safeEqStr(p.u, process.env.ADMIN_USER)) return null;
  return p;
}
function setCookie(res, value, maxAge) {
  res.setHeader("Set-Cookie", COOKIE + "=" + value + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + maxAge);
}

module.exports = { configured, verifyPassword, safeEqStr, clientIp, lockState, recordFail, clearFail, makeSession, session, setCookie, SESSION_SEC };
