/**
 * Social Trade API (single function, op from path). Roles are checked server-side.
 *   GET  /api/social/masters            public: approved Masters only
 *   GET  /api/social/master?id=m_…      public: one approved Master
 *   GET  /api/social/preview?id=m_…     public: server-side probe of the Master's Brokeree + Myfxbook links
 *                                       (embeddable? via X-Frame-Options / CSP frame-ancestors, plus public og:title/og:image)
 *   GET  /api/social/me                 Google: own Master record (any status) + Masters I follow
 *   POST /api/social/apply   {profile}  Google: apply to become Master (→ pending; admin approves in /admin)
 *   POST /api/social/profile {profile}  Google + approved Master only: update own profile
 *   POST /api/social/follow  {id, follow}  Google: record / remove following of an approved Master
 * Profile fields: display_name, strategy, myfxbook_url (https://www.myfxbook.com/…), brokeree_url (https, any broker domain),
 *                 risk (low|medium|high), min_deposit (free text). Brokeree is link-out only (no API integration).
 */
const G = require("../_lib/google");
const L = require("../_lib/license");
const S = require("../_lib/store");
const M = require("../_lib/social");
const P = require("../_lib/link-preview");

function send(res, status, obj) {
  res.setHeader("Cache-Control", "no-store");
  return L.send(res, status, obj);
}

module.exports = async function handler(req, res) {
  L.cors(res, "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  const op = String((req.query && req.query.op) || "").toLowerCase();
  try {
    if (op === "masters") {
      if (req.method !== "GET") return send(res, 405, { error: "method_not_allowed" });
      const all = await M.listMasters();
      const out = [];
      for (const m of all) if (m.status === "approved") out.push(M.publicView(m, await M.followerCount(m.id)));
      return send(res, 200, { masters: out, durable: S.store().durable });
    }
    if (op === "master") {
      if (req.method !== "GET") return send(res, 405, { error: "method_not_allowed" });
      const m = await M.getMaster(req.query && req.query.id);
      if (!m || m.status !== "approved") return send(res, 404, { error: "not_found" });
      return send(res, 200, { master: M.publicView(m, await M.followerCount(m.id)) });
    }

    if (op === "preview") {
      if (req.method !== "GET") return send(res, 405, { error: "method_not_allowed" });
      const m = await M.getMaster(req.query && req.query.id);
      if (!m || m.status !== "approved") return send(res, 404, { error: "not_found" });
      // Only links of approved Masters are probed (no arbitrary URLs from the client → no open SSRF proxy).
      const [bk, fx] = await Promise.all([
        m.brokeree_url ? P.cachedProbe(m.brokeree_url) : null,
        m.myfxbook_url ? P.cachedProbe(m.myfxbook_url) : null,
      ]);
      return send(res, 200, { brokeree: bk, myfxbook: fx });
    }

    const user = await G.userFromReq(req);
    if (!user) return send(res, 401, { error: "google_login_required" });
    const uid = M.uidOf(user);

    if (op === "me") {
      if (req.method !== "GET") return send(res, 405, { error: "method_not_allowed" });
      const mine = await M.masterOfUid(uid);
      const ids = await M.following(uid);
      const fl = [];
      for (const id of ids) {
        const m = await M.getMaster(id);
        if (m) fl.push(Object.assign(M.publicView(m), { status: m.status === "approved" ? "approved" : "unavailable" }));
      }
      return send(res, 200, { master: mine ? M.ownerView(mine) : null, following: fl, durable: S.store().durable });
    }

    if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
    let body;
    try { body = await L.readBody(req); } catch (e) { return send(res, 400, { error: "bad_json" }); }
    // Basic write limit per Google account (best-effort without Redis).
    const n = await S.store().incr("rl:social:" + uid + ":" + new Date().toISOString().slice(0, 10), 1, 86400);
    if (n > 60) return send(res, 429, { error: "too_many_requests" });

    if (op === "apply") {
      const v = M.validate(body);
      if (!v.ok) return send(res, 400, { error: v.error, field: v.field });
      const mine = await M.masterOfUid(uid);
      if (mine && (mine.status === "approved" || mine.status === "pending")) return send(res, 409, { error: "already_" + mine.status, master: M.ownerView(mine) });
      if (mine && mine.status === "suspended") return send(res, 403, { error: "suspended" });
      let m;
      if (mine) { Object.assign(mine, v.value, { status: "pending", reject_note: "" }); m = await M.saveMaster(mine); }
      else m = await M.createMaster(uid, user.email, v.value);
      return send(res, 200, { master: M.ownerView(m) });
    }
    if (op === "profile") {
      const mine = await M.masterOfUid(uid);
      if (!mine || mine.status !== "approved") return send(res, 403, { error: "not_approved_master" });
      const v = M.validate(body);
      if (!v.ok) return send(res, 400, { error: v.error, field: v.field });
      Object.assign(mine, v.value);
      return send(res, 200, { master: M.ownerView(await M.saveMaster(mine)) });
    }
    if (op === "follow") {
      const m = await M.getMaster(body.id);
      if (!m || m.status !== "approved") return send(res, 404, { error: "not_found" });
      if (m.owner_uid === uid) return send(res, 400, { error: "cannot_follow_self" });
      await M.follow(uid, m.id, body.follow !== false);
      return send(res, 200, { ok: true, following: body.follow !== false, followers: await M.followerCount(m.id) });
    }
    return send(res, 404, { error: "not_found" });
  } catch (e) {
    return send(res, 503, { error: "server_error" });
  }
};
