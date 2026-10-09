/**
 * Customer AI Chat — real wiring (no hardcoded sample answers).
 * Priority:
 *  1) Local Nexttrade-AI-Agent at LOCAL_AGENT_URL (default http://127.0.0.1:8787)
 *  2) BYOK via CHAT_PROXY_URL or same-origin /api/chat (customer key in header; never committed)
 * Never invents company API keys. Keys live in localStorage (browser) or agent .env.
 */
(function (root) {
  "use strict";

  var LS_KEYS = "nt_customer_api_keys_v1";
  var LS_WARN = "nt_customer_api_keys_warned";

  var PROVIDER_MAP = {
    Grok: "xai",
    "GPT-4.1": "openai",
    GPT: "openai",
    Claude: "anthropic",
    Gemini: "gemini",
  };

  function agentBase() {
    return String(root.LOCAL_AGENT_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
  }

  function proxyUrl() {
    var configured = String(root.CHAT_PROXY_URL || "").trim();
    if (configured) return configured.replace(/\/$/, "");
    // Same-origin Vercel serverless when present
    return "/api/chat";
  }

  function loadKeys() {
    try {
      var raw = localStorage.getItem(LS_KEYS);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveKeys(obj) {
    var clean = {
      openai: String((obj && obj.openai) || "").trim(),
      anthropic: String((obj && obj.anthropic) || "").trim(),
      gemini: String((obj && obj.gemini) || "").trim(),
      xai: String((obj && obj.xai) || "").trim(),
    };
    localStorage.setItem(LS_KEYS, JSON.stringify(clean));
    return clean;
  }

  function clearKeys() {
    localStorage.removeItem(LS_KEYS);
  }

  function keyForProvider(provider) {
    var keys = loadKeys();
    var p = (provider || "xai").toLowerCase();
    if (p === "grok") p = "xai";
    return keys[p] || "";
  }

  function modelToProvider(label) {
    return PROVIDER_MAP[label] || String(label || "xai").toLowerCase();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function appendBubble(logEl, text, mine) {
    var div = document.createElement("div");
    div.className = mine ? "bubble me" : "bubble";
    div.textContent = text;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
    return div;
  }

  function probeAgent(timeoutMs) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var t = setTimeout(function () {
      if (ctrl) ctrl.abort();
    }, timeoutMs || 1200);
    return fetch(agentBase() + "/health", {
      method: "GET",
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (r) {
        clearTimeout(t);
        if (!r.ok) return null;
        return r.json().catch(function () {
          return { ok: true };
        });
      })
      .catch(function () {
        clearTimeout(t);
        return null;
      });
  }

  function chatViaAgent(message, provider, history, apiKey) {
    var body = {
      message: message,
      provider: provider,
      history: history || [],
    };
    if (apiKey) body.api_key = apiKey;
    return fetch(agentBase() + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().then(function (j) {
        return { http: r.status, data: j };
      });
    });
  }

  function chatViaProxy(message, provider, history, apiKey) {
    if (!apiKey) {
      return Promise.resolve({
        http: 0,
        data: {
          ok: false,
          error: "no_key",
          reply:
            "ยังไม่มี Local Agent และยังไม่ได้ใส่คีย์ในแท็บ API Keys — ไม่ตอบตัวอย่างปลอม กรุณารัน Nexttrade-AI-Agent ที่ " +
            agentBase() +
            " หรือใส่คีย์ของคุณ (เก็บในเบราว์เซอร์)",
        },
      });
    }
    return fetch(proxyUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Customer-Api-Key": apiKey,
      },
      body: JSON.stringify({
        message: message,
        provider: provider,
        history: history || [],
      }),
    }).then(function (r) {
      return r
        .json()
        .catch(function () {
          return { ok: false, error: "bad_json", reply: "พร็อกซีตอบไม่เป็น JSON (HTTP " + r.status + ")" };
        })
        .then(function (j) {
          return { http: r.status, data: j };
        });
    });
  }

  function chatViaOurs(message, provider, history) {
    var auth = root.NexxGoogleAuth;
    var tok = auth && auth.getCredential ? auth.getCredential() : "";
    if (!tok) {
      return Promise.resolve({ reply: "โหมดใช้ระบบของเรา: กรุณาเข้าสู่ระบบ Google (อีกครั้ง) ก่อนแชต", source: "gated", provider: provider, error: "login_required", gated: true });
    }
    return fetch(proxyUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
      body: JSON.stringify({ message: message, provider: provider, history: history || [], mode: "ours" }),
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: "bad_json", reply: "HTTP " + r.status }; });
    }).then(function (d) {
      if (d && d.usage) {
        try { root.dispatchEvent(new CustomEvent("nexx-ai-usage", { detail: d.usage })); } catch (e) {}
      }
      var reply = d.reply || d.error || "ไม่มีข้อความตอบกลับ";
      if (d.ok && d.usage && d.usage.state === "soft") {
        reply += "\n\n⚠ ใช้ถึง Soft Cap แล้ว (" + d.usage.used + "/" + d.usage.hard + ") — เมื่อถึง Hard Cap จะถูกระงับ";
      }
      return { reply: reply, source: "ours", provider: d.provider || provider, gated: !!d.gated, error: d.ok === false ? d.error : null };
    }).catch(function (err) {
      return { reply: "เชื่อมระบบของเราไม่ได้ (" + (err && err.message ? err.message : String(err)) + ")", source: "gated", provider: provider, error: "fetch_failed", gated: true };
    });
  }

  /**
   * Send one chat turn. Returns { reply, source, provider, gated?, error? }
   */
  function sendChat(opts) {
    var message = String((opts && opts.message) || "").trim();
    var provider = modelToProvider((opts && opts.model) || (opts && opts.provider) || "Grok");
    var history = (opts && opts.history) || [];
    var apiKey = keyForProvider(provider);

    if (!message) {
      return Promise.resolve({ reply: "", error: "empty", source: "none" });
    }

    // Mode B "ใช้ระบบของเรา" (chosen in โปรไฟล์สมาชิก): server key + server-side soft/hard caps.
    // Default stays BYOK / Local Agent exactly as before.
    if (root.NexxAiUsage && root.NexxAiUsage.mode && root.NexxAiUsage.mode() === "ours") {
      return chatViaOurs(message, provider, history);
    }

    return probeAgent(1200).then(function (health) {
      if (health && health.ok !== false) {
        return chatViaAgent(message, provider, history, apiKey || undefined)
          .then(function (res) {
            var d = res.data || {};
            var reply = d.reply || d.error || "Local Agent ไม่ส่งข้อความกลับ";
            return {
              reply: reply,
              source: "local_agent",
              provider: d.provider || provider,
              gated: !!d.gated,
              error: d.ok === false ? d.error : null,
              health: health,
            };
          })
          .catch(function (err) {
            return {
              reply: "เรียก Local Agent ไม่สำเร็จ: " + (err && err.message ? err.message : String(err)),
              source: "local_agent",
              provider: provider,
              error: "fetch_failed",
            };
          });
      }

      // Fallback: BYOK proxy (customer key only)
      return chatViaProxy(message, provider, history, apiKey)
        .then(function (res) {
          var d = res.data || {};
          if (res.http === 404 || res.http === 405) {
            return {
              reply:
                "ไม่พบ Local Agent ที่ " +
                agentBase() +
                " และยังไม่มีพร็อกซีแชตบนโฮสต์นี้\n" +
                "วิธีใช้จริง: ติดตั้ง Nexttrade-AI-Agent แล้วรัน python -m agent.server (คีย์อยู่ใน .env ของคุณ)\n" +
                "หรือใส่คีย์ในแท็บ API Keys แล้วรอ /api/chat บน Vercel",
              source: "gated",
              provider: provider,
              error: "no_backend",
              gated: true,
            };
          }
          return {
            reply: d.reply || d.error || d.detail || "พร็อกซีไม่ส่งข้อความ",
            source: "byok_proxy",
            provider: d.provider || provider,
            gated: !!d.gated,
            error: d.ok === false ? d.error : null,
          };
        })
        .catch(function (err) {
          return {
            reply:
              "เชื่อม Local Agent ไม่ได้ และพร็อกซีล้มเหลว (" +
              (err && err.message ? err.message : String(err)) +
              ")\nรัน agent ที่ " +
              agentBase() +
              " หรือใส่คีย์ใน API Keys",
            source: "gated",
            provider: provider,
            error: "all_failed",
            gated: true,
          };
        });
    });
  }

  function updateStatusEl(el, health, keys) {
    if (!el) return;
    var hasKey = keys && (keys.openai || keys.anthropic || keys.gemini || keys.xai);
    if (health && health.ok !== false) {
      el.textContent =
        "สถานะ: Local Agent พร้อม (" +
        agentBase() +
        ")" +
        (hasKey ? " · มีคีย์ในเบราว์เซอร์ (ส่งให้ agent ได้ถ้า .env ว่าง)" : " · ใช้คีย์จาก .env ของ agent");
      el.className = "ok";
    } else if (hasKey) {
      el.textContent =
        "สถานะ: ไม่พบ Local Agent — จะลอง BYOK ผ่านพร็อกซีด้วยคีย์ในเบราว์เซอร์ (ไม่เก็บคีย์บริษัท)";
      el.className = "muted";
    } else {
      el.textContent =
        "สถานะ: ยังไม่พร้อมคุยจริง — รัน Local Agent ที่ " +
        agentBase() +
        " หรือใส่คีย์ในแท็บ API Keys (ไม่ตอบตัวอย่างปลอม)";
      el.className = "warn";
    }
  }

  function bindChatUi(cfg) {
    cfg = cfg || {};
    var log = document.getElementById(cfg.logId || "log");
    var input = document.getElementById(cfg.inputId || "q");
    var btn = document.getElementById(cfg.askId || "ask");
    var modelEl = document.getElementById(cfg.modelId || "model");
    var statusEl = document.getElementById(cfg.statusId || "chatStatus");
    if (!log || !input || !btn) return;

    var history = [];

    function refreshStatus() {
      probeAgent(1000).then(function (h) {
        updateStatusEl(statusEl, h, loadKeys());
      });
    }
    refreshStatus();
    setInterval(refreshStatus, 15000);

    function doSend() {
      var q = input.value.trim();
      if (!q) return;
      input.value = "";
      appendBubble(log, q, true);
      var thinking = appendBubble(log, "กำลังเรียกโมเดล…", false);
      var model = modelEl ? modelEl.value : "Grok";
      btn.disabled = true;
      sendChat({ message: q, model: model, history: history }).then(function (res) {
        thinking.remove();
        var prefix = "";
        if (res.source === "local_agent") prefix = "[Local Agent] ";
        else if (res.source === "byok_proxy") prefix = "[BYOK] ";
        else if (res.gated) prefix = "[รอต่อสาย] ";
        appendBubble(log, prefix + (res.reply || "ไม่มีข้อความ"), false);
        if (res.reply && !res.error) {
          history.push({ role: "user", content: q });
          history.push({ role: "assistant", content: res.reply });
          if (history.length > 24) history = history.slice(-24);
        }
        btn.disabled = false;
        refreshStatus();
      });
    }

    btn.onclick = doSend;
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    });
  }

  function bindKeysUi(cfg) {
    cfg = cfg || {};
    var saveBtn = document.getElementById(cfg.saveId || "saveKeysBtn");
    var clearBtn = document.getElementById(cfg.clearId || "clearKeysBtn");
    var msg = document.getElementById(cfg.msgId || "keysMsg");
    var warn = document.getElementById(cfg.warnId || "keysWarn");
    var ids = {
      openai: cfg.openaiId || "keyOpenAI",
      anthropic: cfg.anthropicId || "keyClaude",
      gemini: cfg.geminiId || "keyGemini",
      xai: cfg.xaiId || "keyGrok",
    };

    var existing = loadKeys();
    Object.keys(ids).forEach(function (k) {
      var el = document.getElementById(ids[k]);
      if (el && existing[k]) el.placeholder = "(บันทึกแล้วในเบราว์เซอร์ — วางใหม่เพื่อแทนที่)";
    });

    if (warn) {
      warn.textContent =
        "คำเตือน: คีย์เก็บใน localStorage ของเบราว์เซอร์นี้ (ไม่ได้เข้ารหัส) — อย่าใช้บนเครื่องสาธารณะ · บริษัทไม่เก็บคีย์ของคุณบนเซิร์ฟเวอร์";
    }

    if (saveBtn) {
      saveBtn.onclick = function () {
        var obj = {};
        Object.keys(ids).forEach(function (k) {
          var el = document.getElementById(ids[k]);
          var v = el ? el.value.trim() : "";
          obj[k] = v || existing[k] || "";
          if (el) el.value = "";
        });
        saveKeys(obj);
        localStorage.setItem(LS_WARN, "1");
        if (msg) {
          msg.className = "ok";
          msg.textContent = "บันทึกคีย์ในเบราว์เซอร์แล้ว — ใช้กับ Local Agent หรือ BYOK พร็อกซีเท่านั้น ไม่ขึ้น GitHub";
        }
        Object.keys(ids).forEach(function (k) {
          var el = document.getElementById(ids[k]);
          if (el && obj[k]) el.placeholder = "(บันทึกแล้วในเบราว์เซอร์ — วางใหม่เพื่อแทนที่)";
        });
      };
    }
    if (clearBtn) {
      clearBtn.onclick = function () {
        clearKeys();
        if (msg) {
          msg.className = "muted";
          msg.textContent = "ลบคีย์ออกจากเบราว์เซอร์แล้ว";
        }
      };
    }
  }

  root.NexxAiChat = {
    LS_KEYS: LS_KEYS,
    loadKeys: loadKeys,
    saveKeys: saveKeys,
    clearKeys: clearKeys,
    sendChat: sendChat,
    probeAgent: probeAgent,
    bindChatUi: bindChatUi,
    bindKeysUi: bindKeysUi,
    agentBase: agentBase,
    modelToProvider: modelToProvider,
  };
})(typeof window !== "undefined" ? window : this);
