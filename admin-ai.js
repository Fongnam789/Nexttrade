/**
 * /admin → AI Model section: model pricing (editable), per-model soft/hard caps, active model for "ใช้ระบบของเรา",
 * and a live monthly cost ESTIMATE table (users 100…2000 × each model's soft/hard cap).
 * Data comes from GET /api/admin/data (admin session cookie); saves go to POST /api/admin/action (server-side auth + CSRF header).
 */
(function () {
  "use strict";
  var H = { "Content-Type": "application/json", "X-NT-Admin": "1" };
  var S = { ai: null, caps: null, hidden: {}, hl: {}, show: "both", day: "", assump: null };
  function $(id) { return document.getElementById(id); }
  function el(t, c, x) { var n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; }
  function act(body) {
    return fetch("/api/admin/action", { method: "POST", headers: H, credentials: "same-origin", body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; }); });
  }
  function msg(text, ok) { var m = $("aiMsg"); m.className = ok ? "ok" : "bad"; m.textContent = text; }
  function money(v) {
    if (!isFinite(v)) return "—";
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function priceAt(m, day) {
    var t = m.pricing || [];
    for (var i = 0; i < t.length; i++) if ((!t[i].from || t[i].from <= day) && (!t[i].until || day <= t[i].until)) return t[i];
    return t[t.length - 1] || null;
  }
  function tierLabel(t) {
    if (t.until && t.from) return t.from + " – " + t.until;
    if (t.until) return "ถึง " + t.until;
    if (t.from) return "ตั้งแต่ " + t.from;
    return "ราคาปัจจุบัน";
  }
  function after(res) {
    if (res._status === 401) { location.reload(); return false; }
    if (res._status !== 200) { msg("ไม่สำเร็จ (" + (res.error || res._status) + ")", false); return false; }
    S.ai = res.ai; S.caps = res.caps;
    render();
    return true;
  }

  /* ---------- status + models ---------- */
  function renderStatus() {
    var b = $("aiStatus");
    b.innerHTML = "";
    var a = S.ai, am = null;
    a.models.forEach(function (m) { if (m.id === a.active) am = m; });
    b.appendChild(el("div", null, "โมเดลที่ใช้งาน (ใช้ระบบของเรา): " + (am ? am.label + " · " + am.id + " · Soft " + am.caps.soft + " / Hard " + am.caps.hard + " ต่อผู้ใช้/เดือน" : "ยังไม่ได้เลือก")));
    var st = el("div", "muted");
    st.textContent = "AI Gateway key (AI_GATEWAY_API_KEY): " + (a.gateway_key_set ? "ตั้งแล้ว" : "ยังไม่ได้ตั้ง") +
      " · CHAT_ALLOW_SERVER_KEYS=1: " + (a.server_mode_enabled ? "เปิด" : "ปิด") +
      (a.gateway_key_set && a.server_mode_enabled && am ? " → ลูกค้าโหมดใช้ระบบของเราใช้งานได้" : " → ลูกค้าโหมดใช้ระบบของเราจะได้ 503 (ยังไม่พร้อม) จนกว่าจะครบ");
    b.appendChild(st);
  }
  function renderModels() {
    var t = $("aiModels");
    t.innerHTML = "";
    var hr = el("tr");
    ["ใช้งาน", "โมเดล / AI Gateway id", "ราคา USD / 1M tokens (Input · Output)", "Soft cap", "Hard cap", ""].forEach(function (h) { hr.appendChild(el("th", null, h)); });
    t.appendChild(hr);
    var noneTr = el("tr");
    var noneTd = el("td");
    var r0 = el("input"); r0.type = "radio"; r0.name = "aiActive"; r0.checked = !S.ai.active; r0.className = "ai-radio";
    r0.onchange = function () { act({ action: "ai_set_active", id: null }).then(function (j) { if (after(j)) msg("ปิดโมเดลของระบบแล้ว", true); }); };
    noneTd.appendChild(r0); noneTr.appendChild(noneTd);
    var nl = el("td", "muted", "ไม่ใช้ (ปิดโหมดใช้ระบบของเรา)"); nl.colSpan = 5; noneTr.appendChild(nl);
    t.appendChild(noneTr);
    S.ai.models.forEach(function (m) {
      var tr = el("tr", m.id === S.ai.active ? "ai-on" : "");
      var tdR = el("td");
      var r = el("input"); r.type = "radio"; r.name = "aiActive"; r.checked = m.id === S.ai.active; r.className = "ai-radio";
      r.onchange = function () { act({ action: "ai_set_active", id: m.id }).then(function (j) { if (after(j)) msg("ตั้ง " + m.label + " เป็นโมเดลที่ใช้งานแล้ว", true); }); };
      tdR.appendChild(r); tr.appendChild(tdR);
      var tdM = el("td");
      tdM.appendChild(el("strong", null, m.label));
      tdM.appendChild(el("div", "ai-id", m.id));
      tdM.appendChild(el("div", "muted", m.provider));
      if (m.notes) tdM.appendChild(el("div", "ai-note", m.notes));
      var src = el("a", "ai-src", "แหล่งราคา ↗"); src.href = m.source_url; src.target = "_blank"; src.rel = "noopener noreferrer";
      tdM.appendChild(src);
      tdM.appendChild(el("span", "muted", " · ตรวจเมื่อ " + m.verified_at + (m.prices_edited ? " · แก้ไขโดยแอดมิน" : "")));
      tr.appendChild(tdM);
      var tdP = el("td");
      var tierInputs = [];
      (m.pricing || []).forEach(function (tier) {
        var row = el("div", "ai-tier");
        row.appendChild(el("span", "muted ai-tl", tierLabel(tier)));
        var i1 = el("input"); i1.type = "number"; i1.min = "0"; i1.step = "0.01"; i1.value = tier.input; i1.title = "Input";
        var i2 = el("input"); i2.type = "number"; i2.min = "0"; i2.step = "0.01"; i2.value = tier.output; i2.title = "Output";
        row.appendChild(i1); row.appendChild(el("span", "muted", "·")); row.appendChild(i2);
        tdP.appendChild(row);
        tierInputs.push({ tier: tier, i: i1, o: i2 });
      });
      tr.appendChild(tdP);
      var s = el("input"); s.type = "number"; s.min = "1"; s.step = "1"; s.value = m.caps.soft; s.className = "ai-cap";
      var h = el("input"); h.type = "number"; h.min = "1"; h.step = "1"; h.value = m.caps.hard; h.className = "ai-cap";
      var tdS = el("td"); tdS.appendChild(s); tdS.appendChild(el("div", "muted ai-small", m.caps.set_by === "admin" ? "แอดมินตั้ง" : "ค่าเริ่มต้น")); tr.appendChild(tdS);
      var tdH = el("td"); tdH.appendChild(h); tr.appendChild(tdH);
      var tdA = el("td");
      var sv = el("button", "gold", "บันทึก"); sv.type = "button";
      sv.onclick = function () {
        var pricing = tierInputs.map(function (x) {
          var o = { input: parseFloat(x.i.value), output: parseFloat(x.o.value) };
          if (x.tier.from) o.from = x.tier.from;
          if (x.tier.until) o.until = x.tier.until;
          return o;
        });
        if (pricing.some(function (p) { return !(p.input >= 0 && p.output >= 0); })) return msg("ราคาต้องเป็นตัวเลข ≥ 0", false);
        if (!(parseInt(s.value, 10) > 0 && parseInt(h.value, 10) >= parseInt(s.value, 10))) return msg("Hard cap ต้อง ≥ Soft cap และ > 0", false);
        sv.disabled = true;
        act({ action: "ai_set_model", id: m.id, pricing: pricing, soft: s.value, hard: h.value }).then(function (j) { if (after(j)) msg("บันทึก " + m.label + " แล้ว", true); });
      };
      var rs = el("button", null, "รีเซ็ต"); rs.type = "button"; rs.title = "คืนราคา/Cap ตามไฟล์ ai_models.json";
      rs.onclick = function () { if (confirm("คืนค่าราคาและ Cap ของ " + m.label + " เป็นค่าเริ่มต้น?")) act({ action: "ai_reset_model", id: m.id }).then(function (j) { if (after(j)) msg("รีเซ็ต " + m.label + " แล้ว", true); }); };
      tdA.appendChild(sv); tdA.appendChild(rs);
      tr.appendChild(tdA);
      /* live preview while typing: recalc the cost table with unsaved values */
      [s, h].concat(tierInputs.map(function (x) { return x.i; }), tierInputs.map(function (x) { return x.o; })).forEach(function (inp) {
        inp.addEventListener("input", function () {
          m._draft = {
            caps: { soft: parseInt(s.value, 10) || 0, hard: parseInt(h.value, 10) || 0 },
            pricing: tierInputs.map(function (x) { var o = { input: parseFloat(x.i.value) || 0, output: parseFloat(x.o.value) || 0 }; if (x.tier.from) o.from = x.tier.from; if (x.tier.until) o.until = x.tier.until; return o; }),
          };
          renderCost();
        });
      });
      t.appendChild(tr);
    });
  }

  /* ---------- cost table ---------- */
  function renderToggles() {
    var b = $("aiCols");
    b.innerHTML = "";
    S.ai.models.forEach(function (m) {
      var l = el("label", "ai-chip" + (S.hidden[m.id] ? "" : " on"));
      var c = el("input"); c.type = "checkbox"; c.checked = !S.hidden[m.id];
      c.onchange = function () { S.hidden[m.id] = !c.checked; l.className = "ai-chip" + (c.checked ? " on" : ""); renderCost(); };
      l.appendChild(c); l.appendChild(document.createTextNode(m.label));
      b.appendChild(l);
    });
  }
  function readAssump() {
    return {
      input_tokens: Math.max(0, parseInt($("aiIn").value, 10) || 0),
      output_tokens: Math.max(0, parseInt($("aiOut").value, 10) || 0),
      apply_token_factor: $("aiFactor").checked,
    };
  }
  function renderCost() {
    var a = readAssump();
    var day = $("aiDay").value || S.ai.today;
    var show = $("aiShow").value;
    var cols = S.ai.models.filter(function (m) { return !S.hidden[m.id]; });
    var t = $("aiCost");
    t.innerHTML = "";
    var h1 = el("tr"), h2 = el("tr"), h3 = el("tr");
    var u = el("th", "ai-sticky", "ผู้ใช้"); u.rowSpan = 3; h1.appendChild(u);
    var sub = show === "both" ? ["soft", "hard"] : [show];
    cols.forEach(function (m) {
      var d = m._draft || m;
      var p = priceAt(d, day) || { input: 0, output: 0 };
      var f = a.apply_token_factor && m.token_factor ? m.token_factor : 1;
      m._perReq = ((a.input_tokens * p.input + a.output_tokens * p.output) / 1e6) * f;
      m._caps = d.caps || m.caps;
      var cls = (m.id === S.ai.active ? " ai-act" : "") + (S.hl[m.id] ? " ai-hl" : "");
      var th = el("th", "ai-mh" + cls); th.colSpan = sub.length; th.title = "คลิกเพื่อไฮไลต์คอลัมน์";
      th.appendChild(el("div", null, m.label + (m.id === S.ai.active ? " ★" : "")));
      th.onclick = function () { S.hl[m.id] = !S.hl[m.id]; renderCost(); };
      h1.appendChild(th);
      var th2 = el("th", "ai-sub" + cls, "$" + p.input + " / $" + p.output + (f !== 1 ? " · ×" + f : "") + " · ต่อคำขอ $" + m._perReq.toFixed(6));
      th2.colSpan = sub.length; h2.appendChild(th2);
      sub.forEach(function (k) { h3.appendChild(el("th", "ai-sub" + cls, (k === "soft" ? "Soft " : "Hard ") + m._caps[k])); });
    });
    t.appendChild(h1); t.appendChild(h2); t.appendChild(h3);
    for (var users = 100; users <= 2000; users += 100) {
      var tr = el("tr");
      tr.appendChild(el("td", "ai-sticky", users.toLocaleString("en-US")));
      cols.forEach(function (m) {
        var cls = (m.id === S.ai.active ? " ai-act" : "") + (S.hl[m.id] ? " ai-hl" : "");
        sub.forEach(function (k) { tr.appendChild(el("td", "ai-num" + cls, money(users * m._caps[k] * m._perReq))); });
      });
      t.appendChild(tr);
    }
    if (!cols.length) { var e = el("tr"); var td = el("td", "muted", "เลือกอย่างน้อย 1 โมเดล"); td.colSpan = 2; e.appendChild(td); t.appendChild(e); }
    $("aiCostNote").textContent = "ประมาณการเท่านั้น (ไม่ใช่ใบแจ้งหนี้) · ค่าใช้จ่ายต่อเดือน = ผู้ใช้ × Cap ของโมเดล (คำขอ/ผู้ใช้/เดือน) × ((Input tokens × ราคา Input + Output tokens × ราคา Output) ÷ 1,000,000)" +
      (a.apply_token_factor ? " × token factor (ถ้ามี)" : "") + " · สมมติว่าทุกคนใช้ถึง Cap · ราคา ณ วันที่ " + day + " · ไม่รวมภาษี/ค่าธรรมเนียม Gateway/ส่วนลด cache";
  }
  function render() {
    renderStatus();
    renderModels();
    renderToggles();
    if (!S.assump) {
      S.assump = S.ai.assumptions;
      $("aiIn").value = S.assump.input_tokens;
      $("aiOut").value = S.assump.output_tokens;
      $("aiFactor").checked = S.assump.apply_token_factor !== false;
      $("aiDay").value = S.ai.today;
    }
    $("aiAssumpInfo").textContent = S.ai.assumptions.set_by === "admin" ? "บันทึกโดยแอดมิน" : "ค่าเริ่มต้น (1500 / 500)";
    renderCost();
  }

  function init() {
    ["aiIn", "aiOut", "aiFactor", "aiDay", "aiShow"].forEach(function (id) {
      $(id).addEventListener("input", renderCost);
      $(id).addEventListener("change", renderCost);
    });
    $("aiAssumpSave").addEventListener("click", function () {
      act(Object.assign({ action: "ai_set_assumptions" }, readAssump())).then(function (j) { if (after(j)) msg("บันทึกสมมติฐานแล้ว", true); });
    });
  }

  window.NtAdminAI = {
    render: function (ai, caps) {
      if (!ai) return;
      S.ai = ai; S.caps = caps;
      S.ai.models.forEach(function (m) { delete m._draft; });
      render();
      if (window.NtAdminBudget) window.NtAdminBudget.render(ai);
    },
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

/* ---------- purchased token/credit budgets + low-balance alerts ---------- */
(function () {
  "use strict";
  var H = { "Content-Type": "application/json", "X-NT-Admin": "1" };
  var B = { ai: null };
  function $(id) { return document.getElementById(id); }
  function el(t, c, x) { var n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; }
  function msg(t, ok) { var m = $("bMsg"); m.className = ok ? "ok" : "bad"; m.textContent = t; }
  function act(body) {
    return fetch("/api/admin/action", { method: "POST", headers: H, credentials: "same-origin", body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; }); })
      .then(function (j) {
        if (j._status === 401) { location.reload(); return null; }
        if (j._status !== 200) { msg("ไม่สำเร็จ (" + (j.error || j._status) + ")", false); return null; }
        if (window.NtAdminAI) window.NtAdminAI.render(j.ai, j.caps);
        return j;
      });
  }
  function bkk(ms) {
    try { return new Date(ms).toLocaleString("en-GB", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) + " (เวลาไทย)"; }
    catch (e) { return new Date(ms).toISOString(); }
  }
  function fmt(unit, v) { return unit === "usd" ? "$" + Number(v).toFixed(2) : Math.round(v).toLocaleString("en-US") + " tokens"; }
  function nameOf(b) {
    if (b.scope === "provider") return "ผู้ให้บริการ: " + b.target;
    var m = (B.ai.models || []).filter(function (x) { return x.id === b.target; })[0];
    return (m ? m.label : b.target) + " · " + b.target;
  }
  function fillTargets() {
    var sel = $("bTarget"), scope = $("bScope").value, cur = sel.value;
    sel.innerHTML = "";
    var opts = scope === "provider" ? B.ai.budget.providers.map(function (p) { return [p, p]; }) : B.ai.models.map(function (m) { return [m.id, m.label + " (" + m.id + ")"]; });
    opts.forEach(function (o) { var op = el("option", null, o[1]); op.value = o[0]; sel.appendChild(op); });
    if (cur) sel.value = cur;
    if (!sel.value && sel.options.length) sel.selectedIndex = 0;
  }
  function render() {
    var bd = B.ai.budget;
    var ch = bd.channels;
    var names = [];
    if (ch.telegram) names.push("Telegram");
    if (ch.line) names.push("LINE");
    $("aiChannels").textContent = names.length ? "ช่องทางแจ้งเตือน: " + names.join(" + ") : "ยังไม่ได้ตั้งช่องทางแจ้งเตือน (ตั้ง env ADMIN_ALERT_TELEGRAM_BOT_TOKEN + ADMIN_ALERT_TELEGRAM_CHAT_ID และ/หรือ ADMIN_ALERT_LINE_TOKEN + ADMIN_ALERT_LINE_TO) — แจ้งเตือนจะแสดงเฉพาะในหน้านี้";
    fillTargets();
    var t = $("aiBudgets");
    t.innerHTML = "";
    var hr = el("tr");
    ["งบของ", "ยอดซื้อ", "ใช้ไป", "คงเหลือ", "แจ้งแล้ว", "รอบเริ่ม", ""].forEach(function (h) { hr.appendChild(el("th", null, h)); });
    t.appendChild(hr);
    if (!bd.budgets.length) { var e = el("tr"); var td = el("td", "muted", "ยังไม่ได้ใส่งบ — ยังไม่มีการแจ้งเตือน"); td.colSpan = 7; e.appendChild(td); t.appendChild(e); }
    bd.budgets.forEach(function (b) {
      var tr = el("tr");
      tr.appendChild(el("td", null, nameOf(b)));
      tr.appendChild(el("td", null, fmt(b.unit, b.amount)));
      tr.appendChild(el("td", null, fmt(b.unit, b.used)));
      var tdR = el("td");
      tdR.appendChild(el("div", b.remaining_pct <= 20 ? "bad" : "", fmt(b.unit, b.remaining) + " · " + b.remaining_pct.toFixed(1) + "%"));
      var bar = el("div", "ai-bar"); var fill = el("i", b.remaining_pct <= 20 ? "low" : ""); fill.style.width = Math.max(0, Math.min(100, b.remaining_pct)) + "%"; bar.appendChild(fill); tdR.appendChild(bar);
      tr.appendChild(tdR);
      tr.appendChild(el("td", null, b.fired.length ? b.fired.map(function (x) { return x + "%"; }).join(", ") : "—"));
      tr.appendChild(el("td", "muted", bkk(b.started_at)));
      var tdA = el("td");
      var up = el("button", "gold", "เติม token"); up.type = "button";
      up.onclick = function () {
        var v = prompt("เติม token — ยอดใหม่ของรอบนี้ (" + (b.unit === "usd" ? "USD" : "tokens") + "). เว้นว่าง = ใช้ยอดเดิม " + fmt(b.unit, b.amount) + "\nตัวนับจะเริ่มใหม่และเกณฑ์แจ้งเตือนจะรีเซ็ต", "");
        if (v === null) return;
        act({ action: "ai_budget_topup", key: b.key, amount: v.trim() }).then(function (j) { if (j) msg("เติม token แล้ว — เริ่มรอบใหม่", true); });
      };
      var del = el("button", "red", "ลบ"); del.type = "button";
      del.onclick = function () { if (confirm("ลบงบ " + nameOf(b) + "?")) act({ action: "ai_budget_delete", key: b.key }).then(function (j) { if (j) msg("ลบงบแล้ว", true); }); };
      tdA.appendChild(up); tdA.appendChild(del);
      tr.appendChild(tdA);
      t.appendChild(tr);
    });
    var at = $("aiAlerts");
    at.innerHTML = "";
    var h2 = el("tr");
    ["เวลา", "เกณฑ์", "ข้อความ", "ส่งไปที่"].forEach(function (h) { h2.appendChild(el("th", null, h)); });
    at.appendChild(h2);
    if (!bd.alerts.length) { var e2 = el("tr"); var td2 = el("td", "muted", "ยังไม่มีการแจ้งเตือน"); td2.colSpan = 4; e2.appendChild(td2); at.appendChild(e2); }
    bd.alerts.forEach(function (a) {
      var tr = el("tr", a.ack ? "" : "ai-unack");
      tr.appendChild(el("td", null, bkk(a.at)));
      tr.appendChild(el("td", null, "≤" + a.threshold + "%"));
      tr.appendChild(el("td", null, a.text));
      tr.appendChild(el("td", "muted", a.sent && a.sent.length ? a.sent.map(function (s) { return s.channel + (s.ok ? " ✓" : " ✗"); }).join(", ") : "เฉพาะหน้า admin"));
      at.appendChild(tr);
    });
    var unack = bd.alerts.filter(function (a) { return !a.ack; });
    var ban = $("aiAlertBanner");
    ban.innerHTML = "";
    if (unack.length) {
      var d = el("div", "ai-banner");
      d.textContent = "⚠️ token/เครดิต AI ใกล้หมด (" + unack.length + " รายการยังไม่รับทราบ): " + unack[0].text.replace(/^⚠️ NEXTTRADE: token\/เครดิต AI ใกล้หมด — /, "");
      ban.appendChild(d);
    }
  }
  function init() {
    $("bScope").addEventListener("change", fillTargets);
    $("bAdd").addEventListener("click", function () {
      var amount = $("bAmount").value;
      if (!(Number(amount) > 0)) return msg("ใส่ยอดที่ซื้อ (> 0)", false);
      act({ action: "ai_budget_set", scope: $("bScope").value, target: $("bTarget").value, unit: $("bUnit").value, amount: amount })
        .then(function (j) { if (j) { $("bAmount").value = ""; msg("บันทึกงบแล้ว", true); } });
    });
    $("aiAck").addEventListener("click", function () { act({ action: "ai_alerts_ack" }).then(function (j) { if (j) msg("รับทราบแล้ว", true); }); });
  }
  window.NtAdminBudget = { render: function (ai) { if (!ai || !ai.budget) return; B.ai = ai; render(); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
