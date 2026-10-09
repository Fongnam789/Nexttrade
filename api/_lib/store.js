/**
 * Pluggable server store.
 *   - Upstash Redis (Vercel Marketplace) REST credentials set → durable, shared by all instances (kind "redis").
 *     Accepts either env pair: KV_REST_API_URL + KV_REST_API_TOKEN  or  UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
 *   - Otherwise in-memory Map → per serverless instance, lost on cold start. NOT a real database:
 *     caps, lockouts, EA requests and license status are only best-effort until KV/DB is attached.
 * TODO(DB): attach Vercel KV/Upstash (Marketplace) or replace this module with Postgres; keep the interface.
 * Interface (all Promise): get, set(key, value, ttlSec?), del, incr(key, by, ttlSec?), getJson, setJson, sadd, srem, smembers
 */
const mem = new Map();

function memAlive(k) {
  const v = mem.get(k);
  if (!v) return null;
  if (v.exp && v.exp < Date.now()) { mem.delete(k); return null; }
  return v;
}

const memoryStore = {
  kind: "memory",
  durable: false,
  async get(k) { const v = memAlive(k); return v ? v.val : null; },
  async set(k, val, ttl) { mem.set(k, { val: String(val), exp: ttl ? Date.now() + ttl * 1000 : 0 }); },
  async del(k) { mem.delete(k); },
  async incr(k, by, ttl) {
    const v = memAlive(k);
    const n = (v ? parseInt(v.val, 10) || 0 : 0) + by;
    mem.set(k, { val: String(n), exp: v && v.exp ? v.exp : (ttl ? Date.now() + ttl * 1000 : 0) });
    return n;
  },
  async sadd(k, member) {
    const v = memAlive(k);
    const set = new Set(v ? JSON.parse(v.val) : []);
    const added = set.has(member) ? 0 : 1;
    set.add(member);
    mem.set(k, { val: JSON.stringify([...set]), exp: 0 });
    return added; // same as Redis SADD: 1 = newly added, 0 = already present
  },
  async srem(k, member) {
    const v = memAlive(k);
    if (!v) return;
    const set = new Set(JSON.parse(v.val));
    set.delete(member);
    mem.set(k, { val: JSON.stringify([...set]), exp: 0 });
  },
  async smembers(k) { const v = memAlive(k); return v ? JSON.parse(v.val) : []; },
};

function kvStore(url, token) {
  async function cmd(args) {
    const r = await fetch(url.replace(/\/$/, ""), {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error("kv_http_" + r.status);
    return (await r.json()).result;
  }
  return {
    kind: "redis",
    durable: true,
    async get(k) { return cmd(["GET", k]); },
    async set(k, val, ttl) { return ttl ? cmd(["SET", k, String(val), "EX", String(ttl)]) : cmd(["SET", k, String(val)]); },
    async del(k) { return cmd(["DEL", k]); },
    async incr(k, by, ttl) {
      const n = Number(await cmd(["INCRBY", k, String(by)]));
      if (ttl && n === by) await cmd(["EXPIRE", k, String(ttl)]);
      return n;
    },
    async sadd(k, m) { return cmd(["SADD", k, m]); },
    async srem(k, m) { return cmd(["SREM", k, m]); },
    async smembers(k) { return (await cmd(["SMEMBERS", k])) || []; },
  };
}

let cached = null;
function store() {
  if (cached) return cached;
  // Credentials are only read here and sent as a Bearer header to Upstash; never logged or returned.
  const env = process.env;
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  const base = url && token ? kvStore(url, token) : memoryStore;
  cached = Object.assign({}, base, {
    async getJson(k) { const v = await base.get(k); if (v == null) return null; try { return JSON.parse(v); } catch (e) { return null; } },
    async setJson(k, obj, ttl) { return base.set(k, JSON.stringify(obj), ttl); },
  });
  return cached;
}

module.exports = { store };
