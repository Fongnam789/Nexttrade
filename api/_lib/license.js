/**
 * EA license signing / verification (server only).
 * Secret: env LICENSE_SECRET (set on Vercel, never committed, never sent to the browser).
 * Key format:  NTL1.<base64url(JSON payload)>.<base64url(HMAC-SHA256(secret, "NTL1." + payloadPart))>
 * Payload: { v, ea, acct, srv, st, iat, exp, uid }
 *   st = "pending_payment" until a payment/approval backend exists; only that backend may issue st="active".
 */
const crypto = require("crypto");

const PREFIX = "NTL1";
const ACCOUNT_RE = /^\d{5,12}$/;
const SERVER_RE = /^[A-Za-z0-9][A-Za-z0-9 ._\-]{2,63}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9\-]{1,63}$/;

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s) {
  return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
function secret() {
  const s = process.env.LICENSE_SECRET || "";
  return s.length >= 32 ? s : "";
}
function hmac(sec, data) {
  return crypto.createHmac("sha256", sec).update(data).digest();
}
function normServer(s) {
  return String(s || "").trim().replace(/\s+/g, " ");
}

function sign(payload) {
  const sec = secret();
  if (!sec) throw Object.assign(new Error("license_secret_unset"), { status: 503 });
  const body = PREFIX + "." + b64url(JSON.stringify(payload));
  return body + "." + b64url(hmac(sec, body));
}

/** Returns { ok, payload } or { ok:false, reason } */
function verifyKey(key) {
  const sec = secret();
  if (!sec) return { ok: false, reason: "license_secret_unset", status: 503 };
  const parts = String(key || "").trim().split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return { ok: false, reason: "bad_format" };
  const expect = hmac(sec, parts[0] + "." + parts[1]);
  const got = fromB64url(parts[2]);
  if (got.length !== expect.length || !crypto.timingSafeEqual(got, expect)) return { ok: false, reason: "bad_signature" };
  let payload;
  try { payload = JSON.parse(fromB64url(parts[1]).toString("utf8")); } catch (e) { return { ok: false, reason: "bad_payload" }; }
  return { ok: true, payload };
}

function cors(res, methods) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === "object") return resolve(req.body);
    if (typeof req.body === "string") {
      try { return resolve(req.body ? JSON.parse(req.body) : {}); } catch (e) { return reject(e); }
    }
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 20000) reject(new Error("body_too_large"));
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

module.exports = { ACCOUNT_RE, SERVER_RE, SLUG_RE, sign, verifyKey, cors, readBody, send, normServer, secret };
