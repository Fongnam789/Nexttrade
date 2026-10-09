/**
 * EA Marketplace (ตลาด EA) — catalog grid + per-EA detail (#ea/<slug>[/<tab>]).
 * Data: ea_catalog.json (drop real backtests in later). Reviews: localStorage per EA.
 * Never fabricates results: backtest null => empty state; sample is labelled as not real.
 */
(function (global) {
  "use strict";

  var DATA_URL = "./ea_catalog.json";
  var TABS = [
    { id: "overview", label: "ภาพรวม / การทำงาน" },
    { id: "backtest", label: "Backtest" },
    { id: "reviews", label: "รีวิว" },
  ];
  var state = { data: null, loading: null, csvCache: {} };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function load() {
    if (state.data) return Promise.resolve(state.data);
    if (state.loading) return state.loading;
    state.loading = fetch(DATA_URL, { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) { state.data = d; return d; });
    return state.loading;
  }
  function findEa(slug) {
    var list = (state.data && state.data.eas) || [];
    for (var i = 0; i < list.length; i++) if (list[i].slug === slug) return list[i];
    return null;
  }

  /* ---------- reviews (localStorage) ---------- */
  function revKey(slug) { return "nt_ea_reviews_" + slug; }
  function getReviews(slug) {
    try {
      var arr = JSON.parse(localStorage.getItem(revKey(slug)) || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveReviews(slug, arr) {
    try { localStorage.setItem(revKey(slug), JSON.stringify(arr)); return true; } catch (e) { return false; }
  }
  function avgStars(arr) {
    if (!arr.length) return 0;
    var s = 0;
    arr.forEach(function (r) { s += Number(r.stars) || 0; });
    return s / arr.length;
  }
  function starText(v) {
    var full = Math.round(v);
    var out = "";
    for (var i = 1; i <= 5; i++) out += i <= full ? "★" : "☆";
    return out;
  }
  function googleUser() {
    return global.NexxGoogleAuth && global.NexxGoogleAuth.getUser && global.NexxGoogleAuth.getUser();
  }

  /* ---------- views ---------- */
  function showList() {
    var list = $("mkList"), det = $("mkDetail");
    if (list) list.hidden = false;
    if (det) det.hidden = true;
    renderList();
  }

  function renderList() {
    var grid = $("mkGrid");
    if (!grid) return;
    load().then(function (d) {
      grid.innerHTML = "";
      (d.eas || []).forEach(function (ea) {
        var card = el("button", "card ea-card");
        card.type = "button";
        card.setAttribute("data-ea", ea.slug);
        var top = el("div", "ea-card-top");
        var badge = el("span", "ea-badge", (ea.name || "?").replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase());
        var head = el("div", "ea-card-head");
        head.appendChild(el("strong", "ea-name", ea.name));
        if (ea.version) head.appendChild(el("span", "ea-ver", ea.version));
        top.appendChild(badge);
        top.appendChild(head);
        card.appendChild(top);
        card.appendChild(el("span", "tag", ea.style || "EA"));
        card.appendChild(el("p", "ea-tagline", ea.tagline || ""));
        var meta = el("div", "ea-meta");
        var revs = getReviews(ea.slug);
        var rv = el("span", "ea-stars");
        rv.textContent = revs.length ? starText(avgStars(revs)) + " " + avgStars(revs).toFixed(1) + " (" + revs.length + ")" : "☆☆☆☆☆ ยังไม่มีรีวิว";
        meta.appendChild(rv);
        var bt = ea.backtest;
        meta.appendChild(el("span", "ea-chip " + (bt && bt.is_real ? "ok" : "dim"), bt && bt.is_real ? "มีผล Backtest" : "ยังไม่มีผล Backtest"));
        card.appendChild(meta);
        card.appendChild(el("span", "ea-more", "ดูรายละเอียด →"));
        card.addEventListener("click", function () { location.hash = "ea/" + ea.slug; });
        grid.appendChild(card);
      });
    }).catch(function (e) {
      grid.innerHTML = "";
      grid.appendChild(el("p", "bad", "โหลดแคตตาล็อก EA ไม่สำเร็จ (" + e.message + ")"));
    });
  }

  function showDetail(slug, tab) {
    var list = $("mkList"), det = $("mkDetail");
    if (list) list.hidden = true;
    if (det) det.hidden = false;
    var body = $("mkDetailBody");
    if (!body) return;
    body.innerHTML = "";
    body.appendChild(el("p", "muted", "กำลังโหลด…"));
    load().then(function () {
      var ea = findEa(slug);
      body.innerHTML = "";
      if (!ea) {
        body.appendChild(el("p", "bad", "ไม่พบ EA นี้ในแคตตาล็อก"));
        return;
      }
      renderDetail(body, ea, TABS.some(function (t) { return t.id === tab; }) ? tab : "overview");
    }).catch(function (e) {
      body.innerHTML = "";
      body.appendChild(el("p", "bad", "โหลดข้อมูลไม่สำเร็จ (" + e.message + ")"));
    });
  }

  function renderDetail(body, ea, tab) {
    var hero = el("div", "card ea-hero");
    var top = el("div", "ea-card-top");
    top.appendChild(el("span", "ea-badge lg", (ea.name || "?").replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase()));
    var head = el("div", "ea-card-head");
    var h = el("h1", "ea-title", ea.name);
    head.appendChild(h);
    var sub = el("div", "ea-sub");
    if (ea.version) sub.appendChild(el("span", "ea-ver", ea.version));
    sub.appendChild(el("span", "tag", ea.style || "EA"));
    var revs = getReviews(ea.slug);
    sub.appendChild(el("span", "ea-stars", revs.length ? starText(avgStars(revs)) + " " + avgStars(revs).toFixed(1) + " (" + revs.length + " รีวิว)" : "ยังไม่มีรีวิว"));
    head.appendChild(sub);
    top.appendChild(head);
    hero.appendChild(top);
    hero.appendChild(el("p", "ea-tagline", ea.tagline || ""));
    var tabs = el("div", "ea-tabs");
    tabs.setAttribute("role", "tablist");
    TABS.forEach(function (t) {
      var b = el("button", "ea-tab" + (t.id === tab ? " on" : ""), t.label);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", t.id === tab ? "true" : "false");
      b.addEventListener("click", function () {
        var target = "#ea/" + ea.slug + (t.id === "overview" ? "" : "/" + t.id);
        if (location.hash !== target) location.hash = target.slice(1);
      });
      tabs.appendChild(b);
    });
    hero.appendChild(tabs);
    body.appendChild(hero);

    var pane = el("div", "ea-pane");
    body.appendChild(pane);
    if (tab === "backtest") renderBacktest(pane, ea);
    else if (tab === "reviews") renderReviews(pane, ea);
    else renderOverview(pane, ea);
  }

  function listBlock(title, items, empty, bullets) {
    var c = el("div", "card");
    c.appendChild(el("h2", null, title));
    if (!items || !items.length) {
      c.appendChild(el("p", "muted", empty || "ยังไม่มีข้อมูล"));
      return c;
    }
    var ul = el("ul", "ea-list" + (bullets ? " bullets" : ""));
    items.forEach(function (t) { ul.appendChild(el("li", null, t)); });
    c.appendChild(ul);
    return c;
  }
  function chips(items) {
    var w = el("div", "ea-chips");
    if (!items || !items.length) { w.appendChild(el("span", "muted", "ยังไม่มีข้อมูล")); return w; }
    items.forEach(function (t) { w.appendChild(el("span", "ea-chip", t)); });
    return w;
  }

  function renderOverview(pane, ea) {
    var grid = el("div", "grid cols-2");
    var left = el("div", "grid");
    var ov = el("div", "card");
    ov.appendChild(el("h2", null, "ภาพรวม"));
    ov.appendChild(el("p", null, ea.overview || "ยังไม่มีข้อมูล"));
    left.appendChild(ov);
    left.appendChild(listBlock("การทำงาน", ea.how_it_works, "ยังไม่มีรายละเอียดการทำงานจากซอร์ส"));
    var right = el("div", "grid");
    var spec = el("div", "card");
    spec.appendChild(el("h2", null, "สเปก"));
    spec.appendChild(el("h3", null, "ไทม์เฟรม"));
    spec.appendChild(chips(ea.timeframes));
    spec.appendChild(el("h3", "ea-h3-gap", "สัญลักษณ์"));
    spec.appendChild(chips(ea.symbols));
    spec.appendChild(el("h3", "ea-h3-gap", "ไฟล์ซอร์ส"));
    spec.appendChild(el("p", "muted", ea.source_file || "ยังไม่มีไฟล์ในระบบ"));
    right.appendChild(spec);
    var risk = listBlock("ข้อควรรู้ด้านความเสี่ยง", ea.risk_notes, "ยังไม่มีข้อมูล", true);
    risk.appendChild(el("p", "muted ea-foot", "ค่าข้างต้นเป็นค่าเริ่มต้นในซอร์ส ปรับได้ใน Inputs ของ EA · ผลในอดีตไม่รับประกันผลในอนาคต"));
    right.appendChild(risk);
    grid.appendChild(left);
    grid.appendChild(right);
    pane.appendChild(grid);
  }

  /* ---------- backtest ---------- */
  function fmtNum(v, d) {
    var n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString("en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  }
  function parseCsv(text) {
    var lines = String(text || "").replace(/\r/g, "").split("\n").filter(function (l) { return l.trim(); });
    if (lines.length < 2) return [];
    var sep = lines[0].indexOf("\t") >= 0 ? "\t" : (lines[0].indexOf(";") >= 0 ? ";" : ",");
    var head = lines[0].split(sep).map(function (h) { return h.replace(/[<>"]/g, "").trim().toLowerCase(); });
    var col = head.indexOf("equity");
    if (col < 0) col = head.indexOf("balance");
    if (col < 0) col = head.length - 1;
    var out = [];
    for (var i = 1; i < lines.length; i++) {
      var v = Number(String(lines[i].split(sep)[col] || "").replace(/[" ]/g, ""));
      if (Number.isFinite(v)) out.push(v);
    }
    return out;
  }
  function equityFor(bt) {
    if (Array.isArray(bt.equity) && bt.equity.length > 1) return Promise.resolve(bt.equity);
    if (bt.equity_csv) {
      if (state.csvCache[bt.equity_csv]) return Promise.resolve(state.csvCache[bt.equity_csv]);
      return fetch(bt.equity_csv).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
        .then(function (t) { var a = parseCsv(t); state.csvCache[bt.equity_csv] = a; return a; });
    }
    return Promise.resolve([]);
  }
  function equitySvg(points, sample) {
    var W = 720, H = 260, P = 34;
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("class", "ea-equity");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", sample ? "กราฟ equity ตัวอย่าง (ไม่ใช่ผลจริง)" : "กราฟ equity");
    if (points.length < 2) return svg;
    var min = Math.min.apply(null, points), max = Math.max.apply(null, points);
    if (max === min) { max += 1; min -= 1; }
    var x = function (i) { return P + (i * (W - P * 2)) / (points.length - 1); };
    var y = function (v) { return H - P - ((v - min) * (H - P * 2)) / (max - min); };
    var id = "eqg" + Math.random().toString(36).slice(2, 8);
    svg.innerHTML =
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#ffd770" stop-opacity=".35"/><stop offset="1" stop-color="#ffd770" stop-opacity="0"/></linearGradient></defs>';
    for (var g = 0; g <= 4; g++) {
      var gy = P + (g * (H - P * 2)) / 4;
      var ln = document.createElementNS(ns, "line");
      ln.setAttribute("x1", P); ln.setAttribute("x2", W - P); ln.setAttribute("y1", gy); ln.setAttribute("y2", gy);
      ln.setAttribute("stroke", "rgba(212,165,64,.14)"); ln.setAttribute("stroke-width", "1");
      svg.appendChild(ln);
      var lab = document.createElementNS(ns, "text");
      lab.setAttribute("x", 4); lab.setAttribute("y", gy + 4);
      lab.setAttribute("fill", "#a8987a"); lab.setAttribute("font-size", "11");
      lab.textContent = fmtNum(max - (g * (max - min)) / 4, 0);
      svg.appendChild(lab);
    }
    var d = "";
    points.forEach(function (v, i) { d += (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); });
    var area = document.createElementNS(ns, "path");
    area.setAttribute("d", d + "L" + x(points.length - 1) + " " + (H - P) + "L" + x(0) + " " + (H - P) + "Z");
    area.setAttribute("fill", "url(#" + id + ")");
    svg.appendChild(area);
    var line = document.createElementNS(ns, "path");
    line.setAttribute("d", d);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", sample ? "#c9a24a" : "#ffd770");
    line.setAttribute("stroke-width", "2.4");
    if (sample) line.setAttribute("stroke-dasharray", "6 5");
    svg.appendChild(line);
    if (sample) {
      var wm = document.createElementNS(ns, "text");
      wm.setAttribute("x", W / 2); wm.setAttribute("y", H / 2);
      wm.setAttribute("text-anchor", "middle"); wm.setAttribute("fill", "rgba(255,215,112,.16)");
      wm.setAttribute("font-size", "34"); wm.setAttribute("font-weight", "700");
      wm.textContent = "ตัวอย่าง · ไม่ใช่ผลจริง";
      svg.appendChild(wm);
    }
    return svg;
  }
  function statsTable(bt) {
    var cur = bt.currency || "";
    var rows = [
      ["กำไรสุทธิ (Net profit)", fmtNum(bt.net_profit, 2) + " " + cur],
      ["Max Drawdown", fmtNum(bt.max_drawdown_pct, 2) + "%"],
      ["Profit Factor", fmtNum(bt.profit_factor, 2)],
      ["Win rate", fmtNum(bt.win_rate_pct, 1) + "%"],
      ["จำนวนเทรด", fmtNum(bt.total_trades, 0)],
      ["ช่วงเวลา", bt.period || "—"],
      ["สัญลักษณ์ / TF", (bt.symbol || "—") + " · " + (bt.timeframe || "—")],
      ["ทุนเริ่มต้น", fmtNum(bt.initial_deposit, 0) + " " + cur],
      ["โมเดลทดสอบ", bt.model || "—"],
      ["ที่มา", bt.source || "—"],
    ];
    var t = el("table", "ea-stats");
    rows.forEach(function (r) {
      var tr = el("tr");
      tr.appendChild(el("td", null, r[0]));
      tr.appendChild(el("td", null, r[1]));
      t.appendChild(tr);
    });
    return t;
  }
  function backtestCard(bt, sample) {
    var c = el("div", "card" + (sample ? " ea-sample" : ""));
    c.appendChild(el("h2", null, sample ? "ตัวอย่างการแสดงผล Backtest" : "ผล Backtest"));
    if (sample) c.appendChild(el("div", "warn ea-sample-banner", (bt.label || "ตัวอย่างข้อมูล (ยังไม่ใช่ผลจริง)") + " — " + (bt.source || "ตัวเลขสมมุติ")));
    var grid = el("div", "grid cols-2");
    var chartBox = el("div", "ea-chart");
    chartBox.appendChild(el("p", "muted", "กำลังโหลดกราฟ…"));
    grid.appendChild(chartBox);
    grid.appendChild(statsTable(bt));
    c.appendChild(grid);
    equityFor(bt).then(function (pts) {
      chartBox.innerHTML = "";
      if (pts.length < 2) { chartBox.appendChild(el("p", "muted", "ยังไม่มีข้อมูล equity")); return; }
      chartBox.appendChild(equitySvg(pts, sample));
    }).catch(function (e) {
      chartBox.innerHTML = "";
      chartBox.appendChild(el("p", "bad", "โหลด CSV ไม่สำเร็จ (" + e.message + ")"));
    });
    return c;
  }
  function renderBacktest(pane, ea) {
    var bt = ea.backtest;
    if (bt && bt.is_real) {
      pane.appendChild(backtestCard(bt, false));
      return;
    }
    var empty = el("div", "card ea-empty");
    empty.appendChild(el("div", "ea-empty-ico", "📊"));
    empty.appendChild(el("h2", null, "ยังไม่มีผล backtest"));
    empty.appendChild(el("p", "muted", "EA ตัวนี้ยังไม่มีผลทดสอบจริงในระบบ เมื่อได้รายงาน MT5 Strategy Tester หรือไฟล์ CSV equity ทีมงานจะใส่ใน ea_catalog.json แล้วผลจะแสดงที่นี่"));
    pane.appendChild(empty);
    var sample = state.data && state.data.sample_backtest;
    if (sample) {
      var det = el("details", "ea-sample-wrap");
      det.appendChild(el("summary", null, "ดูตัวอย่างหน้าตาการแสดงผล (ตัวอย่างข้อมูล ยังไม่ใช่ผลจริง)"));
      det.addEventListener("toggle", function () {
        if (det.open && !det.dataset.ready) {
          det.appendChild(backtestCard(sample, true));
          det.dataset.ready = "1";
        }
      });
      pane.appendChild(det);
    }
  }

  /* ---------- reviews ---------- */
  function renderReviews(pane, ea) {
    var grid = el("div", "grid cols-2");
    var listCard = el("div", "card");
    var formCard = el("div", "card");
    grid.appendChild(listCard);
    grid.appendChild(formCard);
    pane.appendChild(grid);

    function drawList() {
      var revs = getReviews(ea.slug);
      listCard.innerHTML = "";
      listCard.appendChild(el("h2", null, "รีวิวจากผู้ใช้"));
      var sum = el("div", "ea-rev-sum");
      var avg = avgStars(revs);
      sum.appendChild(el("span", "ea-rev-avg", revs.length ? avg.toFixed(1) : "–"));
      var right = el("div");
      right.appendChild(el("div", "ea-stars lg", starText(avg)));
      right.appendChild(el("div", "muted", revs.length ? revs.length + " รีวิว" : "ยังไม่มีรีวิว เป็นคนแรกที่รีวิว EA ตัวนี้"));
      sum.appendChild(right);
      listCard.appendChild(sum);
      if (!revs.length) return;
      revs.slice().reverse().forEach(function (r) {
        var item = el("div", "ea-rev");
        var hd = el("div", "ea-rev-hd");
        hd.appendChild(el("strong", null, r.name || "ผู้ใช้"));
        if (r.google) hd.appendChild(el("span", "ea-chip ok", "Google"));
        hd.appendChild(el("span", "ea-stars", starText(r.stars)));
        item.appendChild(hd);
        item.appendChild(el("p", null, r.text || ""));
        item.appendChild(el("span", "muted ea-rev-date", r.ts ? new Date(r.ts).toLocaleString("th-TH") : ""));
        listCard.appendChild(item);
      });
    }

    formCard.appendChild(el("h2", null, "เขียนรีวิว"));
    formCard.appendChild(el("p", "muted", "รีวิวเก็บในเบราว์เซอร์นี้ (localStorage) จนกว่าจะมีระบบหลังบ้าน"));
    var u = googleUser();
    var nameLbl = el("label", "field", "ชื่อผู้รีวิว");
    var nameIn = el("input");
    nameIn.maxLength = 60;
    nameIn.placeholder = "ชื่อที่แสดง";
    if (u && (u.name || u.email)) { nameIn.value = u.name || u.email; nameIn.readOnly = true; }
    nameLbl.appendChild(nameIn);
    formCard.appendChild(nameLbl);
    formCard.appendChild(el("p", "muted ea-hint", u ? "ใช้ชื่อจากบัญชี Google" : "แนะนำให้เข้าสู่ระบบ Google ก่อน เพื่อใช้ชื่อจากบัญชี"));
    var starLbl = el("div", "field", "ให้คะแนน");
    var starRow = el("div", "ea-star-input");
    var picked = 0;
    var starBtns = [];
    for (var i = 1; i <= 5; i++) {
      (function (n) {
        var b = el("button", "ea-star-btn", "★");
        b.type = "button";
        b.setAttribute("aria-label", n + " ดาว");
        b.addEventListener("click", function () {
          picked = n;
          starBtns.forEach(function (sb, k) { sb.classList.toggle("on", k < n); });
        });
        starBtns.push(b);
        starRow.appendChild(b);
      })(i);
    }
    starLbl.appendChild(starRow);
    formCard.appendChild(starLbl);
    var txtLbl = el("label", "field", "ความเห็น");
    var txt = el("textarea");
    txt.rows = 4;
    txt.maxLength = 1000;
    txt.placeholder = "เล่าประสบการณ์ใช้งาน EA ตัวนี้";
    txtLbl.appendChild(txt);
    formCard.appendChild(txtLbl);
    var send = el("button", "btn", "ส่งรีวิว");
    send.type = "button";
    send.style.marginTop = "12px";
    var msg = el("p", "muted");
    formCard.appendChild(send);
    formCard.appendChild(msg);
    send.addEventListener("click", function () {
      var gu = googleUser();
      var name = (gu && (gu.name || gu.email)) || nameIn.value.trim();
      var text = txt.value.trim();
      if (!name) { msg.className = "bad"; msg.textContent = "กรุณาใส่ชื่อ หรือเข้าสู่ระบบ Google"; return; }
      if (!picked) { msg.className = "bad"; msg.textContent = "กรุณาให้คะแนน 1–5 ดาว"; return; }
      if (text.length < 3) { msg.className = "bad"; msg.textContent = "กรุณาเขียนความเห็นอย่างน้อย 3 ตัวอักษร"; return; }
      var arr = getReviews(ea.slug);
      arr.push({ name: name.slice(0, 60), google: !!gu, stars: picked, text: text.slice(0, 1000), ts: Date.now() });
      if (!saveReviews(ea.slug, arr)) { msg.className = "bad"; msg.textContent = "บันทึกไม่สำเร็จ (เบราว์เซอร์ไม่อนุญาต localStorage)"; return; }
      txt.value = "";
      picked = 0;
      starBtns.forEach(function (sb) { sb.classList.remove("on"); });
      msg.className = "ok";
      msg.textContent = "บันทึกรีวิวแล้ว";
      drawList();
    });
    drawList();
  }

  /* ---------- routing ---------- */
  function route() {
    var h = (location.hash || "").replace(/^#/, "");
    var menu = global.NexxSiteMenu;
    if (h.indexOf("ea/") === 0) {
      var parts = h.split("/");
      if (menu && menu.goSpa) menu.goSpa("market");
      try { history.replaceState(null, "", "#" + h); } catch (e) {}
      showDetail(decodeURIComponent(parts[1] || ""), parts[2] || "overview");
      window.scrollTo(0, 0);
      return;
    }
    if (h === "market") {
      if (menu && menu.goSpa) menu.goSpa("market");
      showList();
      return;
    }
    /* back/forward to another existing page */
    var page = h && document.getElementById(h);
    if (page && page.classList.contains("page") && menu && menu.goSpa) menu.goSpa(h);
  }

  function init() {
    var back = $("mkBack");
    if (back) back.addEventListener("click", function () { location.hash = "market"; });
    document.querySelectorAll('#siteMenu [data-page="market"]').forEach(function (b) {
      b.addEventListener("click", function () { showList(); });
    });
    window.addEventListener("hashchange", route);
    window.addEventListener("nexx-google-auth", function () {
      var h = (location.hash || "").replace(/^#/, "");
      if (/^ea\/[^/]+\/reviews$/.test(h)) route();
    });
    var h = (location.hash || "").replace(/^#/, "");
    if (h.indexOf("ea/") === 0 || h === "market") route();
    else renderList();
  }

  global.NexxEaMarket = { load: load, route: route, parseCsv: parseCsv };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof window !== "undefined" ? window : globalThis);
