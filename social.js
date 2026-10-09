/**
 * Social Trade (#social, #social/<masterId>, #social/me).
 * Shows ONLY our own Masters: NEXTTRADE members (Google login) who applied and were approved by admin in /admin.
 * No external/global Brokeree directories, no fake Masters, no invented stats — Masters paste their own
 * broker Brokeree Social Trading link + Myfxbook link. Brokeree is link-out (embed only if the page allows framing).
 * Data: Vercel functions /api/social/* (store.js → Upstash Redis when connected, memory otherwise). Roles checked server-side.
 */
(function (global) {
  "use strict";

  var RISK = { low: "ต่ำ", medium: "กลาง", high: "สูง" };
  var MST = { pending: "รออนุมัติ", approved: "อนุมัติแล้ว", rejected: "ไม่อนุมัติ", suspended: "ถูกระงับ" };
  var MST_CLASS = { pending: "st st-pend", approved: "st st-ok", rejected: "st st-bad", suspended: "st st-bad" };
  var ERR = {
    bad_display_name: "ชื่อที่แสดง 2–40 ตัวอักษร",
    bad_strategy: "คำอธิบายกลยุทธ์อย่างน้อย 20 ตัวอักษร",
    bad_myfxbook_url: "ลิงก์ Myfxbook ต้องขึ้นต้นด้วย https://www.myfxbook.com/…",
    bad_brokeree_url: "ลิงก์ Brokeree Social Trading ต้องเป็น https:// (ลิงก์จากโบรกเกอร์ของคุณ)",
    bad_risk: "เลือกระดับความเสี่ยง",
    bad_profit_share: "Profit sharing ต้องเป็นตัวเลข 0–100 (ทศนิยมไม่เกิน 2 ตำแหน่ง)",
    google_login_required: "ต้องเข้าสู่ระบบ Google อีกครั้งในแท็บนี้",
    login_again: "ต้องเข้าสู่ระบบ Google อีกครั้งในแท็บนี้",
    already_pending: "ส่งใบสมัครแล้ว — รอแอดมินอนุมัติ",
    already_approved: "คุณเป็น Master แล้ว",
    suspended: "บัญชี Master ถูกระงับ — ติดต่อแอดมิน",
    not_approved_master: "แก้ไขได้หลังแอดมินอนุมัติ",
    cannot_follow_self: "ติดตามตัวเองไม่ได้",
    too_many_requests: "ส่งบ่อยเกินไป ลองใหม่พรุ่งนี้",
  };
  var state = { me: null, meAt: 0 };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function link(href, cls, text) {
    var a = el("a", cls, text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }
  function user() { var a = global.NexxGoogleAuth; return a && a.getUser ? a.getUser() : null; }
  function token() { var a = global.NexxGoogleAuth; return a && a.getCredential ? a.getCredential() : ""; }
  function errText(e) { return ERR[e] || "ไม่สำเร็จ (" + e + ")"; }
  function initials(name) {
    var w = String(name || "?").trim().split(/\s+/);
    var a = (w[0] || "?").charAt(0);
    if (!/[A-Za-z0-9]/.test(a)) return a; /* Thai etc.: one leading character only */
    var b = w[1] && /[A-Za-z0-9]/.test(w[1].charAt(0)) ? w[1].charAt(0) : (w[0].charAt(1) || "");
    return (a + b).toUpperCase();
  }
  function api(op, opts) {
    opts = opts || {};
    var h = { "Content-Type": "application/json" };
    if (opts.auth) {
      var t = token();
      if (!t) return Promise.resolve({ _status: 401, error: "login_again" });
      h.Authorization = "Bearer " + t;
    }
    return fetch("/api/social/" + op + (opts.qs || ""), { method: opts.body ? "POST" : "GET", headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined, cache: "no-store" })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; }); })
      .catch(function () { return { _status: 0, error: "network" }; });
  }
  function loadMe(force) {
    if (!user()) { state.me = null; return Promise.resolve(null); }
    if (!force && state.me && Date.now() - state.meAt < 20000) return Promise.resolve(state.me);
    return api("me", { auth: true }).then(function (j) {
      state.me = j._status === 200 ? j : { error: j.error || "error", master: null, following: [] };
      state.meAt = j._status === 200 ? Date.now() : 0; /* never cache failures (e.g. expired token) */
      return state.me;
    });
  }
  function openLogin() {
    window.scrollTo(0, 0);
    var b = $("btnGoogleLogin");
    var p = $("authPanel");
    if (p && !p.classList.contains("open") && b) b.click();
  }
  function show(view) {
    ["socList", "socDetail", "socMe"].forEach(function (id) { var n = $(id); if (n) n.hidden = id !== view; });
  }

  /* ---------- offer terms: Brokeree (server-read) first, else Master-entered, never invented ---------- */
  var INTERVAL = { PerTrade: "ต่อออเดอร์", Daily: "รายวัน", Weekly: "รายสัปดาห์", Monthly: "รายเดือน", Quarterly: "รายไตรมาส", Yearly: "รายปี", Annually: "รายปี" };
  function fmtNum(n) { return Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }); }
  function fmtTime(iso) {
    try { return new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }) + " (เวลาไทย)"; } catch (e) { return iso; }
  }
  /** Returns { profit, profitSrc, min, minSrc, bk } ; src = "brokeree" | "master" | "" */
  function terms(m) {
    var bk = m.brokeree_terms && m.brokeree_terms.ok && m.brokeree_terms.offer_found ? m.brokeree_terms : null;
    var t = { bk: bk, profit: "", profitSrc: "", min: "", minSrc: "" };
    if (bk && bk.performance_fee_pct != null) {
      t.profit = fmtNum(bk.performance_fee_pct) + "%" + (INTERVAL[bk.performance_interval] ? " · " + INTERVAL[bk.performance_interval] : "");
      t.profitSrc = "brokeree";
    } else if (m.profit_share_pct != null) { t.profit = fmtNum(m.profit_share_pct) + "%"; t.profitSrc = "master"; }
    if (bk && bk.min_balance != null) { t.min = fmtNum(bk.min_balance) + (bk.currency ? " " + bk.currency : ""); t.minSrc = "brokeree"; }
    else if (m.min_deposit) { t.min = m.min_deposit; t.minSrc = "master"; }
    return t;
  }
  function srcTag(src) {
    if (src === "brokeree") return el("span", "soc-src bk", "จาก Brokeree");
    if (src === "master") return el("span", "soc-src ms", "ข้อมูลจาก Master");
    return el("span", "soc-src", "ไม่ได้ระบุ");
  }
  function termChip(label, val, src) {
    var c = el("span", "soc-term");
    c.appendChild(el("span", "soc-term-l", label));
    c.appendChild(el("b", null, val || "—"));
    c.appendChild(srcTag(val ? src : ""));
    return c;
  }
  function termsCard(m) {
    var t = terms(m);
    var bkRaw = m.brokeree_terms;
    var card = el("div", "card soc-terms");
    card.appendChild(el("h2", null, "เงื่อนไข / ค่าธรรมเนียม"));
    var rows = el("div", "soc-trows");
    function row(label, val, src, note) {
      var r = el("div", "soc-trow");
      r.appendChild(el("span", "soc-tl", label));
      var v = el("span", "soc-tv");
      v.appendChild(el("b", null, val || "—"));
      if (val) v.appendChild(srcTag(src));
      if (note) v.appendChild(el("span", "muted soc-tnote", note));
      r.appendChild(v);
      rows.appendChild(r);
    }
    row("Profit sharing (Performance fee)", t.profit, t.profitSrc);
    row("เงินลงทุนขั้นต่ำ", t.min, t.minSrc, t.minSrc === "brokeree" && t.bk.currency === "USC" ? "USC = เซ็นต์ดอลลาร์ (1 USD = 100 USC)" : "");
    if (t.bk && t.bk.management_fee != null) row("Management fee", fmtNum(t.bk.management_fee) + (INTERVAL[t.bk.management_fee_interval] ? " · " + INTERVAL[t.bk.management_fee_interval] : ""), "brokeree", "ตามที่โบรกเกอร์เผยแพร่ (หน่วยตามระบบ Brokeree)");
    if (t.bk && t.bk.registration_fee != null) row("Registration fee", fmtNum(t.bk.registration_fee) + (t.bk.currency ? " " + t.bk.currency : ""), "brokeree");
    if (t.bk && t.bk.offer_name) row("ข้อเสนอ (Offer)", t.bk.offer_name + (t.bk.provider_nickname ? " · " + t.bk.provider_nickname : ""), "brokeree");
    if (m.fee_details) row("รายละเอียดเพิ่มเติม", m.fee_details, "master");
    card.appendChild(rows);
    var foot = el("p", "muted soc-tfoot");
    if (bkRaw && bkRaw.ok && bkRaw.offer_found) foot.textContent = "อ่านจากลิงก์ Brokeree ของ Master (" + (bkRaw.host || "") + ") เมื่อ " + fmtTime(bkRaw.fetched_at) + " · แคช 6 ชม. · ตรวจเงื่อนไขล่าสุดที่หน้าโบรกเกอร์ก่อน Copy";
    else if (bkRaw && bkRaw.ok && !bkRaw.offer_found) foot.textContent = "พบผู้ให้บริการบน Brokeree แต่ระบุข้อเสนอไม่ได้ (" + (bkRaw.offers_count || 0) + " ข้อเสนอ) · ใช้ข้อมูลจาก Master · ตรวจล่าสุด " + fmtTime(bkRaw.fetched_at);
    else foot.textContent = "อ่านเงื่อนไขจากลิงก์ Brokeree อัตโนมัติไม่ได้" + (bkRaw && bkRaw.reason === "unsupported_link" ? " (ลิงก์ไม่ใช่รูปแบบ …/portal/registration/subscription/<id>/<offer>)" : "") + " · ใช้ข้อมูลจาก Master" + (bkRaw && bkRaw.fetched_at ? " · ตรวจล่าสุด " + fmtTime(bkRaw.fetched_at) : "");
    card.appendChild(foot);
    return card;
  }

  /* ---------- list ---------- */
  function masterCard(m) {
    var c = el("button", "card ea-card soc-card");
    c.type = "button";
    var top = el("div", "ea-card-top");
    top.appendChild(el("div", "ea-badge", initials(m.display_name)));
    var hd = el("div", "ea-card-head");
    hd.appendChild(el("div", "ea-name", m.display_name));
    hd.appendChild(el("span", "ea-chip soc-risk-" + m.risk, "ความเสี่ยง: " + (RISK[m.risk] || m.risk)));
    top.appendChild(hd);
    c.appendChild(top);
    c.appendChild(el("p", "ea-tagline soc-clamp", m.strategy));
    var meta = el("div", "ea-meta");
    var t = terms(m);
    var tg = el("div", "soc-terms-mini");
    tg.appendChild(termChip("Profit sharing", t.profit, t.profitSrc));
    tg.appendChild(termChip("ลงทุนขั้นต่ำ", t.min, t.minSrc));
    c.appendChild(tg);
    meta.appendChild(el("span", "ea-chip dim", "ผู้ติดตามในระบบ: " + (m.followers || 0)));
    if (m.myfxbook_url) meta.appendChild(el("span", "ea-chip ok", "มี Myfxbook"));
    c.appendChild(meta);
    c.appendChild(el("span", "ea-more", "ดูรายละเอียด →"));
    c.addEventListener("click", function () { location.hash = "social/" + m.id; });
    return c;
  }
  function renderList() {
    show("socList");
    var g = $("socGrid");
    g.innerHTML = "";
    g.appendChild(el("p", "muted", "กำลังโหลด…"));
    renderMasterCta();
    api("masters").then(function (j) {
      g.innerHTML = "";
      var list = (j && j.masters) || [];
      if (j._status !== 200) {
        g.appendChild(el("p", "bad", "โหลดรายชื่อ Master ไม่สำเร็จ"));
        return;
      }
      if (!list.length) {
        var e = el("div", "card ea-empty soc-empty");
        e.appendChild(el("div", "ea-empty-ico", "👥"));
        e.appendChild(el("h2", null, "ยังไม่มี Master"));
        e.appendChild(el("p", "muted", "Master คือสมาชิก NEXTTRADE ที่สมัครและผ่านการอนุมัติจากทีมงาน · เมื่อมี Master ที่อนุมัติแล้วจะแสดงที่นี่"));
        g.appendChild(e);
        return;
      }
      list.forEach(function (m) { g.appendChild(masterCard(m)); });
    });
  }
  function renderMasterCta() {
    var box = $("socCta");
    box.innerHTML = "";
    var b = el("button", "ghost", "สำหรับ Master: สมัคร / จัดการโปรไฟล์ →");
    b.type = "button";
    b.addEventListener("click", function () { location.hash = "social/me"; });
    if (!user()) { box.appendChild(b); return; }
    loadMe().then(function (me) {
      box.innerHTML = "";
      var m = me && me.master;
      if (m) {
        box.appendChild(el("span", MST_CLASS[m.status] || "st", "Master: " + (MST[m.status] || m.status)));
        b.textContent = m.status === "approved" ? "จัดการโปรไฟล์ Master →" : "ดูใบสมัคร Master →";
      } else b.textContent = "สมัครเป็น Master →";
      box.appendChild(b);
    });
  }

  /* ---------- detail ---------- */
  function renderDetail(id) {
    show("socDetail");
    var body = $("socDetailBody");
    body.innerHTML = "";
    body.appendChild(el("p", "muted", "กำลังโหลด…"));
    api("master", { qs: "?id=" + encodeURIComponent(id) }).then(function (j) {
      body.innerHTML = "";
      if (j._status !== 200 || !j.master) {
        var e = el("div", "card ea-empty");
        e.appendChild(el("h2", null, "ไม่พบ Master"));
        e.appendChild(el("p", "muted", "Master นี้อาจยังไม่ได้รับอนุมัติหรือถูกระงับแล้ว"));
        body.appendChild(e);
        return;
      }
      var m = j.master;
      var hero = el("div", "card ea-hero");
      var top = el("div", "ea-card-top");
      top.appendChild(el("div", "ea-badge lg", initials(m.display_name)));
      var hd = el("div", "ea-card-head");
      hd.appendChild(el("h1", "ea-title", m.display_name));
      var sub = el("div", "ea-sub");
      sub.appendChild(el("span", "ea-chip soc-risk-" + m.risk, "ความเสี่ยง: " + (RISK[m.risk] || m.risk)));
      var tt = terms(m);
      sub.appendChild(el("span", "ea-chip", "Profit sharing: " + (tt.profit || "—")));
      sub.appendChild(el("span", "ea-chip dim", "ลงทุนขั้นต่ำ: " + (tt.min || "—")));
      var fc = el("span", "ea-chip dim", "ผู้ติดตามในระบบ: " + (m.followers || 0));
      sub.appendChild(fc);
      hd.appendChild(sub);
      top.appendChild(hd);
      hero.appendChild(top);
      hero.appendChild(el("p", "muted soc-own", "Master ของ NEXTTRADE · สมัครและผ่านการอนุมัติจากทีมงาน · ลิงก์และผลงานเป็นข้อมูลจาก Master/โบรกเกอร์ ไม่ใช่การรับประกันผลตอบแทน"));
      var act = el("div", "soc-actions");
      hero.appendChild(act);
      var msg = el("p", "muted soc-msg");
      hero.appendChild(msg);
      body.appendChild(hero);
      renderFollow(act, msg, m, fc);
      body.appendChild(termsCard(m));

      var grid = el("div", "grid cols-2 soc-grid2");
      var desc = el("div", "card");
      desc.appendChild(el("h2", null, "กลยุทธ์"));
      desc.appendChild(el("p", "soc-pre", m.strategy));
      grid.appendChild(desc);
      var fx = el("div", "card");
      fx.appendChild(el("h2", null, "ผลงานบน Myfxbook"));
      if (m.myfxbook_url) {
        fx.appendChild(el("p", "muted", "Myfxbook ไม่อนุญาตให้ฝังหน้าในเว็บอื่น · เปิดดูสถิติจริงบน Myfxbook ในแท็บใหม่"));
        fx.appendChild(link(m.myfxbook_url, "btn soc-btn", "เปิด Myfxbook ↗"));
        fx.appendChild(el("p", "muted soc-url", m.myfxbook_url));
      } else fx.appendChild(el("p", "muted", "Master ยังไม่ได้ใส่ลิงก์ Myfxbook"));
      grid.appendChild(fx);
      body.appendChild(grid);

      var bk = el("div", "card soc-bk");
      bk.appendChild(el("h2", null, "Brokeree Social Trading"));
      var bkBody = el("div");
      bkBody.appendChild(el("p", "muted", "กำลังตรวจลิงก์…"));
      bk.appendChild(bkBody);
      body.appendChild(bk);
      api("preview", { qs: "?id=" + encodeURIComponent(m.id) }).then(function (p) {
        renderBrokeree(bkBody, m, (p && p.brokeree) || null);
      });
    });
  }
  function renderFollow(act, msg, m, fc) {
    act.innerHTML = "";
    var copy = link(m.brokeree_url, "btn soc-copy", "Copy ผ่าน Brokeree ↗");
    act.appendChild(copy);
    var u = user();
    var following = false;
    function paint() {
      fb.textContent = following ? "✓ กำลังติดตาม · เลิกติดตาม" : "ติดตาม";
      fb.className = following ? "ghost soc-following" : "ghost";
    }
    var fb = el("button", "ghost", "ติดตาม");
    fb.type = "button";
    act.appendChild(fb);
    function setFollow(on, quiet) {
      if (!user()) { msg.className = "warn soc-msg"; msg.textContent = "เข้าสู่ระบบ Google เพื่อบันทึกการติดตามในโปรไฟล์"; if (!quiet) openLogin(); return Promise.resolve(); }
      return api("follow", { auth: true, body: { id: m.id, follow: on } }).then(function (j) {
        if (j._status === 200) {
          following = on;
          fc.textContent = "ผู้ติดตามในระบบ: " + (j.followers || 0);
          msg.className = "ok soc-msg";
          msg.textContent = on ? "บันทึกการติดตามในโปรไฟล์แล้ว" : "เลิกติดตามแล้ว";
          state.meAt = 0;
          window.dispatchEvent(new CustomEvent("nexx-social-follow"));
        } else { msg.className = "bad soc-msg"; msg.textContent = errText(j.error); }
        paint();
      });
    }
    fb.addEventListener("click", function () { setFollow(!following); });
    /* Copy button: the link opens in a new tab (native <a>, so no popup blocker); we record following at the same time. */
    copy.addEventListener("click", function () { if (!following) setFollow(true, true); });
    if (u) loadMe().then(function (me) {
      following = !!(me && (me.following || []).some(function (x) { return x.id === m.id; }));
      if (me && me.master && me.master.id === m.id) { fb.hidden = true; msg.textContent = "นี่คือโปรไฟล์ Master ของคุณ"; }
      paint();
    });
    act.appendChild(el("span", "muted soc-note", "เข้าร่วม Copy ผ่านพอร์ทัล Brokeree ของโบรกเกอร์ — สมัคร/ฝากเงิน/ตั้งค่า Copy ทำที่โบรกเกอร์"));
  }
  function renderBrokeree(box, m, p) {
    box.innerHTML = "";
    var bt = m.brokeree_terms;
    if (bt && bt.ok) {
      /* Recognised Brokeree portal offer link: link-out only. The portal is a login/registration app that errors inside
         an iframe (tested: "Forbidden"), and clients should enter broker credentials on the broker's own page, not ours. */
      var pv0 = el("div", "soc-preview");
      var tx0 = el("div");
      tx0.appendChild(el("span", "muted soc-site", "พอร์ทัล Brokeree ของโบรกเกอร์ · " + (bt.host || "")));
      tx0.appendChild(el("strong", null, (bt.offer_name || "ข้อเสนอของ Master") + (bt.provider_nickname ? " · " + bt.provider_nickname : "")));
      tx0.appendChild(el("p", "muted", "เปิดหน้าโบรกเกอร์เพื่อสมัคร/เข้าสู่ระบบและเริ่ม Copy · กรอกรหัสผ่านบนหน้าโบรกเกอร์เท่านั้น"));
      pv0.appendChild(tx0);
      box.appendChild(pv0);
      box.appendChild(link(m.brokeree_url, "btn soc-btn", "เปิดหน้า Brokeree ของ Master ↗"));
      box.appendChild(el("p", "muted soc-url", m.brokeree_url));
      return;
    }
    if (p && p.ok && (p.title || p.image || p.description)) {
      var pv = el("div", "soc-preview");
      if (p.image) {
        var img = el("img");
        img.src = p.image;
        img.alt = "";
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        img.onerror = function () { img.remove(); };
        pv.appendChild(img);
      }
      var tx = el("div");
      if (p.site_name) tx.appendChild(el("span", "muted soc-site", p.site_name));
      if (p.title) tx.appendChild(el("strong", null, p.title));
      if (p.description) tx.appendChild(el("p", "muted", p.description));
      pv.appendChild(tx);
      box.appendChild(pv);
    }
    if (p && p.embeddable) {
      var fr = el("iframe", "soc-frame");
      fr.src = m.brokeree_url;
      fr.title = "Brokeree Social Trading — " + m.display_name;
      fr.loading = "lazy";
      fr.referrerPolicy = "no-referrer";
      fr.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms");
      box.appendChild(fr);
      box.appendChild(el("p", "muted", "ถ้าหน้าด้านบนไม่แสดง ให้เปิดในแท็บใหม่"));
    } else {
      box.appendChild(el("p", "muted", p && p.ok === false && p.reason === "blocked_host" ? "ลิงก์นี้เปิดตรวจจากเซิร์ฟเวอร์ไม่ได้ · เปิดในแท็บใหม่" : "หน้า Brokeree ของโบรกเกอร์ไม่อนุญาตให้ฝังในเว็บอื่น · เปิดในแท็บใหม่เพื่อดูและ Copy"));
    }
    box.appendChild(link(m.brokeree_url, "btn soc-btn", "เปิดหน้า Brokeree ของ Master ↗"));
    box.appendChild(el("p", "muted soc-url", m.brokeree_url));
  }

  /* ---------- master: apply / manage ---------- */
  function field(label, input, hint) {
    var l = el("label", "field", label);
    l.appendChild(input);
    if (hint) l.appendChild(el("span", "muted soc-hint", hint));
    return l;
  }
  function renderMe() {
    show("socMe");
    var box = $("socMeBody");
    box.innerHTML = "";
    var card = el("div", "card");
    box.appendChild(card);
    card.appendChild(el("h2", null, "Master Trader"));
    if (!user()) {
      card.appendChild(el("div", "warn", "ยังไม่ครบ — กรุณาเข้าสู่ระบบ Google ก่อนสมัครเป็น Master"));
      var lb = el("button", "ghost", "เข้าสู่ระบบ Google");
      lb.type = "button";
      lb.addEventListener("click", openLogin);
      card.appendChild(lb);
      return;
    }
    card.appendChild(el("p", "muted", "กำลังโหลด…"));
    loadMe(true).then(function (me) {
      card.lastChild.remove();
      if (me && me.error) {
        card.appendChild(el("div", "warn", errText(me.error)));
        var lb2 = el("button", "ghost", "เข้าสู่ระบบ Google อีกครั้ง");
        lb2.type = "button";
        lb2.addEventListener("click", openLogin);
        card.appendChild(lb2);
        return;
      }
      var m = me && me.master;
      if (m) {
        var st = el("div", "ea-req-hd");
        st.appendChild(el("span", MST_CLASS[m.status] || "st", MST[m.status] || m.status));
        if (m.status === "approved") st.appendChild(link("#social/" + m.id, null, "ดูหน้า Master ของฉัน"));
        card.appendChild(st);
        if (m.status === "pending") card.appendChild(el("p", "muted", "ส่งใบสมัครแล้ว — รอแอดมินตรวจและอนุมัติ · แก้ไขข้อมูลได้หลังอนุมัติ"));
        if (m.status === "rejected") card.appendChild(el("p", "warn", "ใบสมัครไม่ผ่าน" + (m.reject_note ? " — " + m.reject_note : "") + " · แก้ไขแล้วส่งใหม่ได้"));
        if (m.status === "suspended") { card.appendChild(el("p", "warn", "บัญชี Master ถูกระงับ — ติดต่อแอดมิน")); return; }
      } else {
        card.appendChild(el("p", "muted", "สมัครเป็น Master ของ NEXTTRADE · ทีมงานตรวจและอนุมัติก่อนแสดงให้ลูกค้าเห็น · ใส่ลิงก์ของคุณเอง ระบบไม่สร้างสถิติให้"));
      }
      renderForm(card, m);
    });
  }
  function renderForm(card, m) {
    var mode = m && m.status === "approved" ? "profile" : "apply";
    var readonly = m && m.status === "pending";
    var name = el("input"); name.maxLength = 40; name.placeholder = "เช่น Gold Swing by Ton"; name.value = (m && m.display_name) || "";
    var strat = el("textarea"); strat.maxLength = 2000; strat.rows = 5; strat.placeholder = "อธิบายแนวเทรด สินทรัพย์ ไทม์เฟรม การบริหารความเสี่ยง (อย่างน้อย 20 ตัวอักษร)"; strat.value = (m && m.strategy) || "";
    var fx = el("input"); fx.type = "url"; fx.placeholder = "https://www.myfxbook.com/members/…"; fx.value = (m && m.myfxbook_url) || "";
    var bk = el("input"); bk.type = "url"; bk.placeholder = "https://… (ลิงก์ Strategy/Provider จากพอร์ทัล Brokeree ของโบรกเกอร์)"; bk.value = (m && m.brokeree_url) || "";
    var risk = el("select");
    [["", "— เลือก —"], ["low", "ต่ำ"], ["medium", "กลาง"], ["high", "สูง"]].forEach(function (o) { var op = el("option", null, o[1]); op.value = o[0]; risk.appendChild(op); });
    risk.value = (m && m.risk) || "";
    var dep = el("input"); dep.maxLength = 60; dep.placeholder = "เช่น 100 USD"; dep.value = (m && m.min_deposit) || "";
    var ps = el("input"); ps.inputMode = "decimal"; ps.maxLength = 6; ps.placeholder = "เช่น 30"; ps.value = m && m.profit_share_pct != null ? String(m.profit_share_pct) : "";
    var fd = el("textarea"); fd.maxLength = 300; fd.rows = 2; fd.placeholder = "เช่น คิด Profit sharing รายสัปดาห์ · ไม่มีค่าแรกเข้า"; fd.value = (m && m.fee_details) || "";
    card.appendChild(field("ชื่อที่แสดง (Master)", name));
    card.appendChild(field("กลยุทธ์ / คำอธิบาย", strat));
    var g = el("div", "ea-req-grid soc-form-grid");
    g.appendChild(field("ลิงก์ Brokeree Social Trading", bk, "ลิงก์จากโบรกเกอร์ของคุณ (https) · ลูกค้ากดแล้วเข้าร่วม Copy ผ่านลิงก์นี้"));
    g.appendChild(field("ลิงก์ Myfxbook", fx, "ไม่บังคับ · ต้องเป็น https://www.myfxbook.com/…"));
    g.appendChild(field("ระดับความเสี่ยง", risk));
    g.appendChild(field("เงินลงทุนขั้นต่ำ", dep, "ข้อความอิสระ · ใช้เมื่ออ่านจาก Brokeree ไม่ได้"));
    g.appendChild(field("Profit sharing (%)", ps, "0–100 · ใช้เมื่ออ่านจาก Brokeree ไม่ได้"));
    card.appendChild(g);
    card.appendChild(field("รายละเอียดค่าธรรมเนียม / เงื่อนไข", fd, "ไม่บังคับ · แสดงเป็น 'ข้อมูลจาก Master'"));
    card.appendChild(el("p", "muted soc-hint", "ระบบจะอ่าน Profit sharing / เงินลงทุนขั้นต่ำจากลิงก์ Brokeree รูปแบบ …/portal/registration/subscription/<id>/<offer> ให้อัตโนมัติ · ถ้าอ่านไม่ได้จะใช้ค่าที่คุณกรอก"));
    [name, strat, fx, bk, risk, dep, ps, fd].forEach(function (i) { i.disabled = !!readonly; });
    if (readonly) return;
    var send = el("button", "btn", mode === "profile" ? "บันทึกโปรไฟล์ Master" : "ส่งใบสมัคร Master");
    send.type = "button";
    var msg = el("p", "muted");
    card.appendChild(send);
    card.appendChild(msg);
    send.addEventListener("click", function () {
      var v = { display_name: name.value.trim(), strategy: strat.value.trim(), myfxbook_url: fx.value.trim(), brokeree_url: bk.value.trim(), risk: risk.value, min_deposit: dep.value.trim(), profit_share_pct: ps.value.trim(), fee_details: fd.value.trim() };
      var bad = null;
      if (v.display_name.length < 2) bad = ["bad_display_name", name];
      else if (v.strategy.length < 20) bad = ["bad_strategy", strat];
      else if (!/^https:\/\/[^\s/@]+\.[^\s/@]+(\/\S*)?$/i.test(v.brokeree_url)) bad = ["bad_brokeree_url", bk];
      else if (v.myfxbook_url && !/^https:\/\/www\.myfxbook\.com\/\S+$/i.test(v.myfxbook_url)) bad = ["bad_myfxbook_url", fx];
      else if (!RISK[v.risk]) bad = ["bad_risk", risk];
      else if (v.profit_share_pct && !(/^\d{1,3}(\.\d{1,2})?%?$/.test(v.profit_share_pct) && parseFloat(v.profit_share_pct) <= 100)) bad = ["bad_profit_share", ps];
      if (bad) { msg.className = "bad"; msg.textContent = errText(bad[0]); bad[1].focus(); return; }
      send.disabled = true;
      msg.className = "muted"; msg.textContent = "กำลังส่ง…";
      api(mode, { auth: true, body: v }).then(function (j) {
        send.disabled = false;
        if (j._status === 200) {
          state.meAt = 0;
          msg.className = "ok";
          msg.textContent = mode === "profile" ? "บันทึกแล้ว" : "ส่งใบสมัครแล้ว — รอแอดมินอนุมัติ";
          setTimeout(renderMe, 900);
        } else { msg.className = "bad"; msg.textContent = errText(j.error); }
      });
    });
  }

  /* ---------- profile card: following ---------- */
  function renderProfileCard() {
    var card = $("socialCard");
    if (!card) return;
    card.innerHTML = "";
    card.appendChild(el("h2", null, "Social Trade"));
    if (!user()) { card.appendChild(el("p", "muted", "เข้าสู่ระบบ Google เพื่อดู Master ที่ติดตาม")); return; }
    loadMe().then(function (me) {
      if (me && me.error) { card.appendChild(el("p", "muted", "เข้าสู่ระบบ Google อีกครั้งในแท็บนี้เพื่อโหลดรายการติดตาม")); return; }
      var m = me && me.master;
      if (m) {
        var r = el("div", "ea-req-hd");
        r.appendChild(el("span", null, "สถานะ Master ของคุณ:"));
        r.appendChild(el("span", MST_CLASS[m.status] || "st", MST[m.status] || m.status));
        card.appendChild(r);
      }
      var fl = (me && me.following) || [];
      card.appendChild(el("h3", null, "Master ที่ติดตาม"));
      if (!fl.length) card.appendChild(el("p", "muted", "ยังไม่ได้ติดตาม Master"));
      fl.forEach(function (x) {
        var it = el("div", "ea-my");
        var hd = el("div", "ea-req-hd");
        var a = el("a", null, x.display_name);
        a.href = "#social/" + x.id;
        hd.appendChild(a);
        if (x.status !== "approved") hd.appendChild(el("span", "st st-bad", "ไม่แสดงแล้ว"));
        it.appendChild(hd);
        var meta = el("div", "ea-my-meta");
        meta.appendChild(el("span", null, "ความเสี่ยง: " + (RISK[x.risk] || x.risk)));
        meta.appendChild(el("span", null, "ลงทุนขั้นต่ำ: " + (x.min_deposit || "—") + " (ข้อมูลจาก Master)"));
        it.appendChild(meta);
        if (x.status === "approved") it.appendChild(link(x.brokeree_url, "ghost soc-small", "Copy ผ่าน Brokeree ↗"));
        card.appendChild(it);
      });
      var go = el("button", "ghost", "ไปที่ Social Trade →");
      go.type = "button";
      go.addEventListener("click", function () { location.hash = "social"; });
      card.appendChild(go);
    });
  }

  /* ---------- routing ---------- */
  function route() {
    var h = (location.hash || "").replace(/^#/, "");
    if (h !== "social" && h.indexOf("social/") !== 0) return;
    var menu = global.NexxSiteMenu;
    if (menu && menu.goSpa) menu.goSpa("social");
    try { history.replaceState(null, "", "#" + h); } catch (e) {}
    var rest = h.slice(7);
    if (!rest) renderList();
    else if (rest === "me") renderMe();
    else renderDetail(decodeURIComponent(rest));
    window.scrollTo(0, 0);
  }
  function init() {
    var back = $("socBack");
    if (back) back.addEventListener("click", function () { location.hash = "social"; });
    var back2 = $("socMeBack");
    if (back2) back2.addEventListener("click", function () { location.hash = "social"; });
    document.querySelectorAll('#siteMenu [data-page="social"]').forEach(function (b) {
      b.addEventListener("click", function () { renderList(); });
    });
    document.querySelectorAll('#siteMenu [data-page="profile"]').forEach(function (b) {
      b.addEventListener("click", renderProfileCard);
    });
    window.addEventListener("hashchange", route);
    window.addEventListener("nexx-google-auth", function () { state.me = null; state.meAt = 0; route(); renderProfileCard(); });
    window.addEventListener("nexx-social-follow", renderProfileCard);
    renderProfileCard();
    route();
  }

  global.NexxSocial = { route: route, renderProfileCard: renderProfileCard };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof window !== "undefined" ? window : globalThis);
