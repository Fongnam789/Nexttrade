/**
 * Read a Master's offer terms from their broker's Brokeree Social Trading portal (server-side, public data only).
 *
 * Supported link shape (Brokeree "private offer" / subscription link that brokers hand to providers):
 *   https://<broker portal host>[:port]/portal/registration/subscription/<providerId>[/<OfferName>]
 * The portal is an Angular app: the HTML has no offer data, so we read the same PUBLIC, unauthenticated JSON that the
 * registration page itself loads before login:
 *   GET <origin>/api/brief/providers/<providerId>          → nickname, currency, visibility
 *   GET <origin>/api/brief/providers/<providerId>/offers   → offers[]: performance.fee (%), performance.interval,
 *                                                            managementFee(+interval), registrationFee, filters.minBalance
 * No login, no cookies, no private data. Values are passed through as published (null stays null, never invented).
 * Cached in the store with fetched_at (ok: 6 h, failure: 30 min). Other link shapes (ratings widgets, custom pages) → unsupported.
 */
const S = require("./store");
const LP = require("./link-preview");

const OK_TTL = 6 * 3600;
const FAIL_TTL = 30 * 60;
const LINK_RE = /\/portal\/registration\/subscription\/(\d{1,10})(?:\/([^/?#]{1,120}))?\/?$/;

function parseLink(url) {
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  if (u.protocol !== "https:") return null;
  const m = u.pathname.match(LINK_RE);
  if (!m) return null;
  let offer = "";
  try { offer = m[2] ? decodeURIComponent(m[2]) : ""; } catch (e) { offer = m[2] || ""; }
  return { origin: u.origin, hostname: u.hostname, providerId: m[1], offerName: offer };
}

async function getJson(url) {
  const u = new URL(url);
  if (!(await LP.publicHost(u.hostname))) throw new Error("blocked_host");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(url, { redirect: "error", signal: ctl.signal, headers: { Accept: "application/json", "User-Agent": "NexxtradeOfferReader/1.0 (public offer terms)" } });
    if (!r.ok) throw new Error("http_" + r.status);
    if (!/json/i.test(r.headers.get("content-type") || "")) throw new Error("not_json");
    const txt = await r.text();
    if (txt.length > 256 * 1024) throw new Error("too_large");
    return JSON.parse(txt);
  } finally { clearTimeout(t); }
}

function num(v) {
  return typeof v === "number" && isFinite(v) ? v : null;
}
function str(v, max) {
  return typeof v === "string" ? v.slice(0, max || 120) : "";
}

/** Fetch + normalise. Returns { ok, reason?, fetched_at, ... } */
async function read(url) {
  const fetched_at = new Date().toISOString();
  const p = parseLink(url);
  if (!p) return { ok: false, reason: "unsupported_link", fetched_at };
  let prov, offers;
  try {
    [prov, offers] = await Promise.all([
      getJson(p.origin + "/api/brief/providers/" + p.providerId),
      getJson(p.origin + "/api/brief/providers/" + p.providerId + "/offers"),
    ]);
  } catch (e) {
    return { ok: false, reason: String(e && e.message || "fetch_failed").slice(0, 40), fetched_at, host: p.hostname };
  }
  const items = (offers && Array.isArray(offers.items) ? offers.items : []).filter((o) => o && typeof o === "object");
  let offer = null;
  if (p.offerName) offer = items.find((o) => String(o.name || "").toLowerCase() === p.offerName.toLowerCase()) || null;
  if (!offer && items.length === 1) offer = items[0];
  const perf = (offer && offer.performance) || {};
  return {
    ok: true,
    fetched_at,
    host: p.hostname,
    provider_id: p.providerId,
    provider_nickname: str(prov && prov.nickname, 80),
    offer_found: !!offer,
    offers_count: items.length,
    offer_name: str(offer && offer.name, 80),
    currency: str((offer && offer.currency) || (prov && prov.currency), 8),
    performance_fee_pct: num(perf.fee),
    performance_interval: str(perf.interval, 20),
    management_fee: num(perf.managementFee),
    management_fee_interval: str(perf.managementFeeInterval, 20),
    registration_fee: num(perf.registrationFee),
    min_balance: num(offer && offer.filters && offer.filters.minBalance),
  };
}

async function cachedRead(url) {
  if (!url) return null;
  const key = "social:brokeree:" + Buffer.from(url).toString("base64url").slice(0, 200);
  const st = S.store();
  const hit = await st.getJson(key);
  if (hit) return Object.assign(hit, { cached: true });
  const r = await read(url);
  await st.setJson(key, r, r.ok ? OK_TTL : FAIL_TTL);
  return r;
}

module.exports = { parseLink, read, cachedRead };
