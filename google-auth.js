/**
 * Customer Google login scaffold (GIS — Google Identity Services).
 * Plan: Login is Google; network node only after 20 USDT bill matches.
 * No client secret in repo. Requires window.GOOGLE_CLIENT_ID (public).
 */
(function (global) {
  "use strict";

  var GIS_SRC = "https://accounts.google.com/gsi/client";
  var LS_KEY = "nexx_google_session";
  var TOKEN_KEY = "nexx_google_id_token";
  var state = { user: null, credential: null };

  function getClientId() {
    if (global.GOOGLE_CLIENT_ID && String(global.GOOGLE_CLIENT_ID).trim()) {
      return String(global.GOOGLE_CLIENT_ID).trim();
    }
    try {
      var ls = localStorage.getItem("google_client_id");
      if (ls && ls.trim()) return ls.trim();
    } catch (e) {}
    return "";
  }

  function parseJwtPayload(cred) {
    try {
      var parts = String(cred).split(".");
      if (parts.length < 2) return null;
      var json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  function loadSession() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || !s.sub) return null;
      state.user = s;
      return s;
    } catch (e) {
      return null;
    }
  }

  function saveSession(user) {
    state.user = user;
    try {
      if (user) localStorage.setItem(LS_KEY, JSON.stringify(user));
      else localStorage.removeItem(LS_KEY);
    } catch (e) {}
  }

  function onCredential(response) {
    state.credential = response && response.credential;
    /* ID token kept for this tab only so server APIs (e.g. /api/license) can verify it; cleared on sign-out. */
    try { if (state.credential) sessionStorage.setItem(TOKEN_KEY, state.credential); } catch (e) {}
    var payload = parseJwtPayload(state.credential);
    if (!payload || !payload.sub) {
      throw new Error("โทเค็น Google ไม่ถูกต้อง");
    }
    /* Client-side session for UI only — production must verify id_token on backend. */
    var user = {
      sub: payload.sub,
      email: payload.email || "",
      name: payload.name || payload.email || "Google",
      picture: payload.picture || "",
      verified: Boolean(payload.email_verified),
      at: Date.now(),
      note: "client-only until backend verifies id_token",
    };
    saveSession(user);
    if (typeof global.dispatchEvent === "function") {
      global.dispatchEvent(new CustomEvent("nexx-google-auth", { detail: user }));
    }
    return user;
  }

  function loadGis() {
    return new Promise(function (resolve, reject) {
      if (global.google && global.google.accounts && global.google.accounts.id) {
        resolve();
        return;
      }
      var s = document.createElement("script");
      s.src = GIS_SRC;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("โหลด Google Identity Services ไม่สำเร็จ")); };
      document.head.appendChild(s);
    });
  }

  function init(callback) {
    var clientId = getClientId();
    if (!clientId) {
      return Promise.reject(new Error("ยังไม่ได้ตั้ง GOOGLE_CLIENT_ID"));
    }
    return loadGis().then(function () {
      global.google.accounts.id.initialize({
        client_id: clientId,
        callback: function (resp) {
          try {
            var user = onCredential(resp);
            if (typeof callback === "function") callback(null, user);
          } catch (err) {
            if (typeof callback === "function") callback(err);
          }
        },
        auto_select: false,
        cancel_on_tap_outside: true,
      });
    });
  }

  function renderButton(el, opts) {
    if (!el) return;
    var clientId = getClientId();
    if (!clientId) return;
    return init().then(function () {
      global.google.accounts.id.renderButton(el, Object.assign({
        type: "standard",
        theme: "filled_black",
        size: "large",
        text: "signin_with",
        shape: "pill",
        logo_alignment: "left",
        width: 220,
      }, opts || {}));
    });
  }

  function prompt() {
    var clientId = getClientId();
    if (!clientId) return Promise.reject(new Error("ยังไม่ได้ตั้ง GOOGLE_CLIENT_ID"));
    return init().then(function () {
      global.google.accounts.id.prompt();
    });
  }

  function signOut() {
    saveSession(null);
    state.credential = null;
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
    var clientId = getClientId();
    if (clientId && global.google && global.google.accounts && global.google.accounts.id) {
      try { global.google.accounts.id.disableAutoSelect(); } catch (e) {}
    }
    if (typeof global.dispatchEvent === "function") {
      global.dispatchEvent(new CustomEvent("nexx-google-auth", { detail: null }));
    }
  }

  /** Raw Google ID token for server-side verification, or "" if missing/expired (then sign in again). */
  function getCredential() {
    var cred = state.credential;
    if (!cred) {
      try { cred = sessionStorage.getItem(TOKEN_KEY) || ""; } catch (e) { cred = ""; }
    }
    var p = cred && parseJwtPayload(cred);
    if (!p || !p.exp || p.exp * 1000 < Date.now() + 30000) return "";
    return cred;
  }

  loadSession();

  global.NexxGoogleAuth = {
    getCredential: getCredential,
    getClientId: getClientId,
    getUser: function () { return state.user || loadSession(); },
    init: init,
    renderButton: renderButton,
    prompt: prompt,
    signOut: signOut,
    onCredential: onCredential,
  };
})(typeof window !== "undefined" ? window : globalThis);
