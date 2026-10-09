/**
 * Server-side link probe for Master links (Brokeree / Myfxbook):
 *   - embeddable: false if X-Frame-Options is present or CSP frame-ancestors doesn't allow any origin (*).
 *   - og:title / og:description / og:image from public <meta> tags only (no cookies, no login, no private data).
 * SSRF guards: https only, public IPs only (DNS checked on every hop), max 3 redirects, 6s timeout, 512 KB read cap.
 * Results are cached in the store for 6 h. Never invents stats — only what the page itself publishes in og tags.
 */
const dns = require("dns").promises;
const net = require("net");
const S = require("./store");

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224;
  }
  const s = ip.toLowerCase();
  return s === "::1" || s === "::" || s.startsWith("fc") || s.startsWith("fd") || s.startsWith("fe80") || s.startsWith("::ffff:");
}
async function publicHost(host) {
  if (net.isIP(host)) return !privateIp(host);
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) return false;
  try {
    const addrs = await dns.lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !privateIp(a.address));
  } catch (e) { return false; }
}
function decode(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}
function meta(html, prop) {
  const re = new RegExp("<meta[^>]+(?:property|name)=[\"']" + prop.replace(/[:.]/g, "\\$&") + "[\"'][^>]*>", "i");
  const tag = (html.match(re) || [])[0];
  if (!tag) return "";
  return decode((tag.match(/content=["']([^"']*)["']/i) || [])[1]);
}
function frameAllowed(headers) {
  if (headers.get("x-frame-options")) return false;
  const csp = headers.get("content-security-policy") || "";
  const fa = (csp.match(/frame-ancestors([^;]*)/i) || [])[1];
  if (fa == null) return true;
  return /(^|\s)\*(\s|$)/.test(fa) || /(^|\s)https:(\s|$)/.test(fa);
}

async function probe(url) {
  let cur = url;
  for (let hop = 0; hop < 4; hop++) {
    let u;
    try { u = new URL(cur); } catch (e) { return { ok: false, reason: "bad_url" }; }
    if (u.protocol !== "https:") return { ok: false, reason: "not_https" };
    if (!(await publicHost(u.hostname))) return { ok: false, reason: "blocked_host" };
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    let r;
    try {
      r = await fetch(u.toString(), { redirect: "manual", signal: ctl.signal, headers: { "User-Agent": "NexxtradeLinkPreview/1.0 (+og tags only)", Accept: "text/html" } });
    } catch (e) { clearTimeout(t); return { ok: false, reason: "fetch_failed" }; }
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      clearTimeout(t);
      cur = new URL(r.headers.get("location"), u).toString();
      continue;
    }
    const out = { ok: r.ok, status: r.status, final_url: u.toString(), embeddable: r.ok && frameAllowed(r.headers), title: "", description: "", image: "", site_name: "" };
    if (r.ok && /text\/html/i.test(r.headers.get("content-type") || "") && r.body) {
      let html = "";
      try {
        const reader = r.body.getReader();
        while (html.length < 512 * 1024) {
          const { done, value } = await reader.read();
          if (done) break;
          html += Buffer.from(value).toString("utf8");
          if (/<\/head>/i.test(html)) break;
        }
        try { reader.cancel(); } catch (e) {}
      } catch (e) {}
      out.title = (meta(html, "og:title") || decode((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1])).slice(0, 160);
      out.description = meta(html, "og:description").slice(0, 300);
      out.site_name = meta(html, "og:site_name").slice(0, 80);
      const img = meta(html, "og:image");
      if (img) { try { const iu = new URL(img, u); out.image = iu.protocol === "https:" ? iu.toString().slice(0, 500) : ""; } catch (e) {} }
    }
    clearTimeout(t);
    return out;
  }
  return { ok: false, reason: "too_many_redirects" };
}

async function cachedProbe(url) {
  const key = "social:preview:" + Buffer.from(url).toString("base64url").slice(0, 200);
  const st = S.store();
  const hit = await st.getJson(key);
  if (hit) return Object.assign(hit, { cached: true });
  const p = await probe(url);
  p.checked_at = new Date().toISOString();
  await st.setJson(key, p, 6 * 3600);
  return p;
}

module.exports = { probe, cachedProbe, frameAllowed, privateIp };
