#!/usr/bin/env node
/**
 * Make ADMIN_PASSWORD_HASH for Vercel env (scrypt). Reads the password from env NT_ADMIN_PASSWORD
 * (or stdin) so it never appears in shell history; prints only the hash.
 *   NT_ADMIN_PASSWORD=... node scripts/hash-admin-password.js
 */
const crypto = require("crypto");
function hash(pw) {
  const N = 16384, r = 8, p = 1;
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 32, { N, r, p });
  return ["scrypt", N, r, p, salt.toString("base64url"), h.toString("base64url")].join(":");
}
if (require.main === module) {
  const pw = process.env.NT_ADMIN_PASSWORD || require("fs").readFileSync(0, "utf8").replace(/\r?\n$/, "");
  if (!pw) { console.error("no password"); process.exit(1); }
  process.stdout.write(hash(pw) + "\n");
}
module.exports = { hash };
