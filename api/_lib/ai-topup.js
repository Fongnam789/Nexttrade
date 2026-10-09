/**
 * Customer AI top-up ("ใช้ระบบของเรา" mode) — bought by the customer in their profile only; admin never refills customers.
 *
 *  - Config (admin): price per unit in USDT (integer; null = "ราคา: รอประกาศ" → buying disabled), requests per unit,
 *    large-top-up warning threshold. Stored at cfg:ai_topup_v1.
 *  - Order = same bill pattern as the package: random bill no. NX-XXXXXX, integer USDT amount, 30-minute expiry, QR.
 *    Admin confirms payment in /admin → allocation happens automatically, exactly once:
 *      + requests added to the customer's top-up quota for the CURRENT month (Asia/Bangkok),
 *      − estimated cost deducted from the company token pool budget (ai-budget.allocate).
 *  - Top-up quota is monthly: leftover expires at the next month (key per month). Base soft/hard caps come back
 *    each month for an active package; top-up never rolls over.
 */
const crypto = require("crypto");
const { store } = require("./store");
const C = require("./ai-caps");
const AB = require("./ai-budget");
const AM = require("./ai-models");

const K_CFG = "cfg:ai_topup_v1";
const K_INDEX = "ai:topup:orders";
const TTL_MONTH = 40 * 86400;
const DEF = { unit_price_usdt: null, unit_requests: 50, max_units: 20, large_requests: null };

function uhash(sub) { return crypto.createHash("sha256").update(String(sub)).digest("hex").slice(0, 32); }
function monthId() { return C.periodInfo("month").id; }
function balKey(sub, pid) { return "ai_topup:" + uhash(sub) + ":" + (pid || monthId()); }
function orderKey(id) { return "ai:topup:order:" + id; }
function userIdx(sub) { return "ai:topup:user:" + uhash(sub); }
function billNo() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = crypto.randomBytes(6);
  let s = "NX-";
  for (let i = 0; i < 6; i++) s += abc[b[i] % abc.length];
  return s;
}

async function config() {
  const v = (await store().getJson(K_CFG)) || {};
  const c = Object.assign({}, DEF, v);
  const caps = await C.caps();
  c.large_requests_effective = c.large_requests || caps.hard; // default: more than one month's hard cap = "large"
  c.price_announced = c.unit_price_usdt != null;
  return c;
}

async function setConfig(body) {
  const cur = Object.assign({}, DEF, (await store().getJson(K_CFG)) || {});
  const p = body.unit_price_usdt;
  if (p === null || p === "" || p === undefined) cur.unit_price_usdt = null;
  else {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 1 || n > 100000) return { error: "bad_price" }; // integer USDT (bill pattern)
    cur.unit_price_usdt = n;
  }
  if (body.unit_requests != null && body.unit_requests !== "") {
    const n = Number(body.unit_requests);
    if (!Number.isInteger(n) || n < 1 || n > 100000) return { error: "bad_unit_requests" };
    cur.unit_requests = n;
  }
  if (body.max_units != null && body.max_units !== "") {
    const n = Number(body.max_units);
    if (!Number.isInteger(n) || n < 1 || n > 1000) return { error: "bad_max_units" };
    cur.max_units = n;
  }
  if (body.large_requests === null || body.large_requests === "") cur.large_requests = null;
  else if (body.large_requests != null) {
    const n = Number(body.large_requests);
    if (!Number.isInteger(n) || n < 1) return { error: "bad_large_requests" };
    cur.large_requests = n;
  }
  cur.at = Date.now();
  await store().setJson(K_CFG, cur);
  return { ok: true };
}

/** Purchased requests left for this month: granted − used beyond the base hard cap. */
async function balance(sub) {
  return Number(await store().get(balKey(sub))) || 0;
}

function publicOrder(o) {
  return { id: o.id, units: o.units, requests: o.requests, amount: o.amount, currency: "USDT", status: o.status, bill: o.bill, created_at: o.created_at, month: o.month, allocated_at: o.allocated_at || null, allocated_month: o.allocated_month || null };
}
function adminOrder(o) {
  return Object.assign(publicOrder(o), { email: o.email || "", alloc: o.alloc || null, confirmed_by: o.confirmed_by || null });
}

async function getOrder(id) { return id ? store().getJson(orderKey(String(id))) : null; }
async function saveOrder(o) { await store().setJson(orderKey(o.id), o); }

async function create(user, units, ackLarge) {
  const c = await config();
  if (!c.price_announced) return { error: "price_not_announced" };
  units = Number(units);
  if (!Number.isInteger(units) || units < 1 || units > c.max_units) return { error: "bad_units" };
  const requests = units * c.unit_requests;
  if (requests >= c.large_requests_effective && !ackLarge) return { error: "large_topup_ack_required", warning: "เครดิตไม่ทบไปเดือนถัดไป แนะนำเติมเท่าที่ใช้" };
  const open = (await list(userIdx(user.sub))).filter((o) => o.status === "awaiting_payment");
  if (open.length >= 3) return { error: "too_many_open_orders" };
  const now = Date.now();
  const o = {
    id: crypto.randomBytes(9).toString("base64url"),
    sub: String(user.sub),
    email: user.email || "",
    units,
    requests,
    unit_price_usdt: c.unit_price_usdt,
    amount: units * c.unit_price_usdt,
    status: "awaiting_payment",
    bill: { no: billNo(), amount: units * c.unit_price_usdt, expires_at: now + 30 * 60000 },
    month: monthId(),
    created_at: now,
  };
  await saveOrder(o);
  await store().sadd(K_INDEX, o.id);
  await store().sadd(userIdx(user.sub), o.id);
  return { order: o };
}

async function rebill(user, id) {
  const o = await getOrder(id);
  if (!o || o.sub !== String(user.sub)) return { error: "not_found" };
  if (o.status !== "awaiting_payment") return { error: "not_awaiting_payment" };
  o.bill = { no: billNo(), amount: o.amount, expires_at: Date.now() + 30 * 60000 };
  await saveOrder(o);
  return { order: o };
}

async function list(idxKey) {
  const ids = await store().smembers(idxKey || K_INDEX);
  const out = [];
  for (const id of ids) { const o = await getOrder(id); if (o) out.push(o); }
  return out.sort((a, b) => b.created_at - a.created_at);
}

/** Admin confirms payment → allocate automatically (idempotent: exactly once per order). */
async function confirm(id, by) {
  const o = await getOrder(id);
  if (!o) return { error: "not_found" };
  if (o.status !== "awaiting_payment") return { error: "not_awaiting_payment" };
  const first = Number(await store().sadd("ai:topup:allocated", o.id)) === 1;
  if (!first) return { error: "already_allocated" };
  const pid = monthId();
  await store().incr(balKey(o.sub, pid), o.requests, TTL_MONTH); // expires with the month; never rolls over
  const act = await AM.active().catch(() => null);
  let alloc = { model: null, usd: 0, tokens: 0, budgets: [] };
  if (act) alloc = await AB.allocate(act.id, o.requests, "จัดสรร top-up " + o.requests + " คำขอให้ลูกค้า");
  Object.assign(o, { status: "allocated", paid_confirmed_at: Date.now(), allocated_at: Date.now(), allocated_month: pid, alloc, confirmed_by: by || "admin" });
  await saveOrder(o);
  return { order: o };
}

async function cancel(id) {
  const o = await getOrder(id);
  if (!o) return { error: "not_found" };
  if (o.status !== "awaiting_payment") return { error: "not_awaiting_payment" };
  o.status = "cancelled";
  o.cancelled_at = Date.now();
  await saveOrder(o);
  return { order: o };
}

/** Customer view for the profile. */
async function mine(user) {
  const c = await config();
  const orders = (await list(userIdx(user.sub))).filter((o) => o.month === monthId() || o.status === "awaiting_payment").slice(0, 10);
  return {
    config: { unit_price_usdt: c.unit_price_usdt, unit_requests: c.unit_requests, max_units: c.max_units, large_requests: c.large_requests_effective, price_announced: c.price_announced },
    balance: await balance(user.sub),
    month: monthId(),
    resets_at: C.periodInfo("month").resets_at,
    orders: orders.map(publicOrder),
    durable: store().durable,
  };
}

module.exports = { config, setConfig, balance, balKey, create, rebill, list, confirm, cancel, mine, publicOrder, adminOrder, getOrder };
