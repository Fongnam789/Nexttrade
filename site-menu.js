/**
 * Customer nav → subdomain hosts per locked plan (app/ai/news/pay/go).
 * Admin host never appears in this menu.
 * UI: hamburger top-left → side drawer. Labels = titles only (no app./ai. prefixes).
 */
(function (global) {
  "use strict";

  var PAGE_HOST = {
    profile: "app",
    home: "app",
    tree: "app",
    keys: "app",
    ai: "ai",
    control: "ai",
    news: "news",
    pay: "pay",
    aff: "go",
    market: "app",
  };

  /* Visible labels only — do NOT show subdomain prefixes on menu */
  var LABELS = {
    profile: "โปรไฟล์สมาชิก",
    home: "ฮับ",
    ai: "กราฟ + แชต",
    control: "ควบคุม",
    news: "ข่าว",
    pay: "ชำระเงิน",
    aff: "Affiliate",
    tree: "ผังสมาชิก",
    keys: "API Keys",
    market: "ตลาด EA",
  };

  function hosts() {
    return global.CUSTOMER_HOSTS || {};
  }

  function rootDomain() {
    return String(global.CUSTOMER_ROOT_DOMAIN || "nexxtrade.example");
  }

  function mode() {
    var m = String(global.CUSTOMER_MENU_MODE || "auto").toLowerCase();
    if (m === "spa" || m === "hosts") return m;
    var host = (location.hostname || "").toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".vercel.app") ||
      host.endsWith(".github.io")
    ) {
      return "spa";
    }
    if (host.endsWith("." + rootDomain()) || host === rootDomain()) {
      return "hosts";
    }
    return "spa";
  }

  function urlFor(page) {
    var key = PAGE_HOST[page] || "app";
    var base = hosts()[key] || "";
    var hash = "#" + page;
    if (mode() === "spa" || !base) {
      return hash;
    }
    return String(base).replace(/\/$/, "") + "/" + hash;
  }

  function menuEl() {
    return document.getElementById("siteMenu");
  }

  function backdropEl() {
    return document.getElementById("menuBackdrop");
  }

  function toggleBtn() {
    return document.getElementById("menuToggle");
  }

  function setOpen(open) {
    var menu = menuEl();
    var bd = backdropEl();
    var btn = toggleBtn();
    if (menu) menu.classList.toggle("open", !!open);
    if (bd) bd.classList.toggle("open", !!open);
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    try {
      document.body.style.overflow = open ? "hidden" : "";
    } catch (e) {}
  }

  function closeMenu() {
    setOpen(false);
  }

  function openMenu() {
    setOpen(true);
  }

  function toggleMenu() {
    var menu = menuEl();
    setOpen(!(menu && menu.classList.contains("open")));
  }

  function goSpa(name) {
    var pages = document.querySelectorAll(".page");
    var nav = document.querySelectorAll("#siteMenu [data-page]");
    pages.forEach(function (p) {
      p.classList.toggle("on", p.id === name);
    });
    nav.forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-page") === name);
    });
    try {
      history.replaceState(null, "", "#" + name);
    } catch (e) {}
    if (global.NexxDashboardWidgets && global.NexxDashboardWidgets.onPage) {
      global.NexxDashboardWidgets.onPage(name);
    }
  }

  function navigate(page) {
    var href = urlFor(page);
    if (href.charAt(0) === "#") {
      goSpa(page);
      closeMenu();
      return;
    }
    location.href = href;
  }

  function wire() {
    var menu = menuEl();
    if (!menu) return;

    menu.querySelectorAll("[data-page]").forEach(function (el) {
      var page = el.getAttribute("data-page");
      var label = LABELS[page];
      if (label) {
        el.textContent = label;
      }
      if (el.tagName === "A") {
        el.setAttribute("href", urlFor(page));
      }
      el.addEventListener("click", function (ev) {
        if (mode() === "spa" || urlFor(page).charAt(0) === "#") {
          ev.preventDefault();
          navigate(page);
        }
        /* hosts mode: let browser follow absolute href */
      });
    });

    document.querySelectorAll("[data-go]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        ev.preventDefault();
        navigate(b.getAttribute("data-go"));
      });
    });

    var toggle = toggleBtn();
    if (toggle) {
      toggle.onclick = function (ev) {
        ev.preventDefault();
        toggleMenu();
      };
    }
    var closer = document.getElementById("menuClose");
    if (closer) {
      closer.onclick = function (ev) {
        ev.preventDefault();
        closeMenu();
      };
    }
    var bd = backdropEl();
    if (bd) {
      bd.onclick = function () {
        closeMenu();
      };
    }
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") closeMenu();
    });

    if (location.hash && location.hash.length > 1) {
      goSpa(location.hash.slice(1));
    } else {
      goSpa("profile");
    }

    var modePill = document.getElementById("hostModeHint");
    if (modePill) {
      modePill.textContent =
        mode() === "spa"
          ? "เมนูโหมด SPA (Vercel เดียว) · โดเมนจริงยังเป็น placeholder " + rootDomain()
          : "เมนูโหมดซับโดเมน · " + rootDomain();
    }
  }

  global.NexxSiteMenu = {
    urlFor: urlFor,
    navigate: navigate,
    mode: mode,
    goSpa: goSpa,
    wire: wire,
    open: openMenu,
    close: closeMenu,
    toggle: toggleMenu,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})(typeof window !== "undefined" ? window : globalThis);
