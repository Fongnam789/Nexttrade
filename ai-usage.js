/**
 * โปรไฟล์สมาชิก › การใช้ AI / API token
 *  (A) "byok"  — ใช้ API token ของตัวเอง: keys stay in this browser (API Keys page) and are sent only per request
 *               in X-Customer-Api-Key; the server never stores or logs them. No caps.
 *  (B) "ours"  — ใช้ระบบของเรา: server key, per-Google-account soft/hard caps enforced in /api/chat
 *               (meter from GET /api/ai/usage). Caps are admin defaults, not final pricing.
 * The mode choice itself is a UI preference kept in localStorage; enforcement is server-side.
 */
(function (global) {
  "use strict";

  var MODE_KEY = "nt_ai_mode_v1";
  var last = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function mode() {
    try { return localStorage.getItem(MODE_KEY) === "ours" ? "ours" : "byok"; } catch (e) { return "byok"; }
  }
  function setMode(m) {
    try { localStorage.setItem(MODE_KEY, m === "ours" ? "ours" : "byok"); } catch (e) {}
    render();
  }
  function user() {
    var a = global.NexxGoogleAuth;
    return a && a.getUser && a.getUser();
  }
  function keyCount() {
    var c = global.NexxAiChat;
    var k = c && c.loadKeys ? c.loadKeys() : {};
    return Object.keys(k || {}).filter(function (x) { return k[x]; }).length;
  }

  function fetchUsage() {
    var a = global.NexxGoogleAuth;
    var tok = a && a.getCredential ? a.getCredential() : "";
    if (!tok) return Promise.resolve({ error: "login_again" });
    return fetch("/api/ai/usage", { headers: { Authorization: "Bearer " + tok }, cache: "no-store" })
      .then(function (r) { return r.json().catch(function () { return { error: "HTTP " + r.status }; }); })
      .catch(function (e) { return { error: e.message }; });
  }

  function meter(u) {
    var box = el("div", "ai-meter");
    var hard = Math.max(1, u.hard);
    var pct = Math.min(100, (u.used / hard) * 100);
    var bar = el("div", "ai-bar");
    var fill = el("div", "ai-fill " + (u.state || "ok"));
    fill.style.width = pct + "%";
    bar.appendChild(fill);
    var sm = el("div", "ai-mark soft");
    sm.style.left = Math.min(100, (u.soft / hard) * 100) + "%";
    sm.title = "Soft cap";
    bar.appendChild(sm);
    box.appendChild(bar);
    var nums = el("div", "ai-nums");
    nums.appendChild(el("span", null, "ใช้ไป " + u.used + " ข้อความ"));
    nums.appendChild(el("span", null, "Soft " + u.soft + " · Hard " + u.hard + " / " + (u.period === "day" ? "วัน" : "เดือน")));
    box.appendChild(nums);
    if (u.resets_at) box.appendChild(el("p", "muted ai-small", "รีเซ็ตรอบใหม่ " + new Date(u.resets_at).toLocaleString("th-TH")));
    if (u.caps_are_defaults) box.appendChild(el("p", "muted ai-small", "ตัวเลข Cap เป็นค่าเริ่มต้นชั่วคราว รอแอดมินกำหนด — ไม่ใช่ราคา/แพ็กเกจจริง"));
    if (u.durable === false) box.appendChild(el("p", "muted ai-small", "ตัวนับยังไม่มีฐานข้อมูลถาวร (รีเซ็ตได้เมื่อเซิร์ฟเวอร์รีสตาร์ท)"));
    if (u.state === "soft") box.appendChild(el("div", "warn", "ใช้ถึง Soft Cap แล้ว — ยังใช้ได้ แต่เมื่อถึง Hard Cap จะถูกระงับ"));
    if (u.state === "hard") box.appendChild(el("p", "bad ai-block", "ใช้ครบ Hard Cap — ระงับการใช้จนกว่าจะรีเซ็ตรอบใหม่หรือเติมโควตา"));
    if (u.server_key_configured === false) box.appendChild(el("p", "muted ai-small", "หมายเหตุ: แอดมินยังไม่เปิดคีย์กลาง แชตโหมดนี้จะยังตอบไม่ได้"));
    return box;
  }

  function render() {
    var card = $("aiUsageCard");
    if (!card) return;
    card.innerHTML = "";
    card.appendChild(el("h2", null, "การใช้ AI / API token"));
    card.appendChild(el("p", "muted", "เลือกว่าจะให้แชต AI และฟีเจอร์ AI ใช้คีย์ของใคร"));
    var m = mode();
    var opts = el("div", "ea-deliv");
    [["byok", "ใช้ API token ของตัวเอง", "ใส่คีย์ OpenAI / Claude / Gemini / Grok ของคุณ · ไม่จำกัดโดยระบบ"],
     ["ours", "ใช้ระบบของเรา", "ใช้คีย์ของระบบ มี Soft Cap / Hard Cap ต่อบัญชี"]].forEach(function (o) {
      var lab = el("label", "ea-deliv-opt" + (m === o[0] ? " on" : ""));
      var r = el("input");
      r.type = "radio";
      r.name = "aiMode";
      r.value = o[0];
      r.checked = m === o[0];
      r.addEventListener("change", function () { setMode(o[0]); });
      lab.appendChild(r);
      var t = el("span");
      t.appendChild(el("b", null, o[1]));
      t.appendChild(el("small", "muted ai-opt-sub", o[2]));
      lab.appendChild(t);
      opts.appendChild(lab);
    });
    card.appendChild(opts);
    var body = el("div", "ai-body");
    card.appendChild(body);

    if (m === "byok") {
      var n = keyCount();
      body.appendChild(el("p", null, n ? "มีคีย์ในเบราว์เซอร์นี้ " + n + " รายการ" : "ยังไม่ได้ใส่คีย์"));
      body.appendChild(el("p", "muted ai-small", "คีย์เก็บในเบราว์เซอร์นี้เท่านั้น ส่งไปพร้อมคำถามแต่ละครั้ง เซิร์ฟเวอร์ไม่บันทึกและไม่ log คีย์ · อย่าใช้บนเครื่องสาธารณะ"));
      var b = el("button", "ghost", "จัดการคีย์ที่เมนู API Keys →");
      b.type = "button";
      b.addEventListener("click", function () {
        if (global.NexxSiteMenu) global.NexxSiteMenu.navigate("keys");
        window.scrollTo(0, 0);
      });
      body.appendChild(b);
      return;
    }

    if (!user()) {
      body.appendChild(el("div", "warn", "ยังไม่ครบ — โหมดนี้ต้องเข้าสู่ระบบ Google เพื่อนับโควตาต่อบัญชี"));
      return;
    }
    var holder = el("div");
    holder.appendChild(el("p", "muted", "กำลังโหลดการใช้งาน…"));
    body.appendChild(holder);
    var rb = el("button", "ghost", "รีเฟรช");
    rb.type = "button";
    rb.addEventListener("click", render);
    fetchUsage().then(function (u) {
      holder.innerHTML = "";
      if (u && !u.error) {
        last = u;
        holder.appendChild(meter(u));
      } else if (u && u.error === "login_again" || u && u.error === "google_login_required") {
        holder.appendChild(el("div", "warn", "ต้องเข้าสู่ระบบ Google อีกครั้งในแท็บนี้เพื่อดูโควตา"));
      } else {
        holder.appendChild(el("p", "bad", "โหลดการใช้งานไม่สำเร็จ (" + (u && u.error) + ")"));
      }
      holder.appendChild(rb);
    });
  }

  function init() {
    render();
    global.addEventListener("nexx-google-auth", render);
    global.addEventListener("nexx-ai-usage", function (ev) {
      last = ev.detail;
      if (mode() === "ours") render();
    });
    document.querySelectorAll('#siteMenu [data-page="profile"]').forEach(function (b) {
      b.addEventListener("click", render);
    });
  }

  global.NexxAiUsage = { mode: mode, setMode: setMode, render: render, last: function () { return last; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof window !== "undefined" ? window : globalThis);
