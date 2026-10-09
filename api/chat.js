/**
 * BYOK chat proxy for Vercel serverless.
 * Customer API key MUST arrive in X-Customer-Api-Key (or body.api_key).
 * BYOK never reads company env keys. "ใช้ระบบของเรา" (mode:"ours") needs CHAT_ALLOW_SERVER_KEYS=1 + AI_GATEWAY_API_KEY and
 * an admin-selected active model (cfg:ai_model_active); metered by that model's soft/hard caps. No secrets in repo.
 */
const G = require("./_lib/google");
const U = require("./_lib/ai-usage");
const AM = require("./_lib/ai-models");
const AB = require("./_lib/ai-budget");

const SYSTEM = [
  "You are Nexttrade AI assistant for a Thai FX/gold trader dashboard.",
  "Answer in the user's language (Thai if they write Thai).",
  "Discuss bias, session, news risk, EA rules at a high level.",
  "Never invent live fills, balances, or order tickets. Keep answers concise.",
].join(" ");

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Customer-Api-Key, Authorization");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === "object") {
      resolve(req.body);
      return;
    }
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 200000) {
        reject(new Error("body_too_large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

/** "ใช้ระบบของเรา": Vercel AI Gateway (OpenAI-compatible), model = admin-selected active model id (e.g. "openai/gpt-6-luna"). */
async function callGateway(key, model, messages) {
  const r = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature: 0.2, messages }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error((j && j.error && (j.error.message || j.error)) || "gateway_http_" + r.status);
    err.status = r.status;
    throw err;
  }
  return { reply: j.choices[0].message.content, usage: j.usage || null };
}

async function callOpenAI(key, messages) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      messages,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error((j && j.error && j.error.message) || "openai_http_" + r.status);
    err.status = r.status;
    throw err;
  }
  return j.choices[0].message.content;
}

async function callXai(key, messages) {
  const r = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.XAI_MODEL || "grok-4",
      temperature: 0.2,
      messages,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error((j && j.error && j.error.message) || "xai_http_" + r.status);
    err.status = r.status;
    throw err;
  }
  return j.choices[0].message.content;
}

async function callAnthropic(key, messages) {
  let system = SYSTEM;
  const turns = [];
  for (const m of messages) {
    if (m.role === "system") system = m.content;
    else turns.push({ role: m.role, content: m.content });
  }
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
      max_tokens: 1200,
      temperature: 0.2,
      system,
      messages: turns,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error((j && j.error && j.error.message) || "anthropic_http_" + r.status);
    err.status = r.status;
    throw err;
  }
  return j.content[0].text;
}

async function callGemini(key, messages) {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  let system = "";
  const contents = [];
  for (const m of messages) {
    if (m.role === "system") {
      system = m.content;
      continue;
    }
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    });
  }
  const body = { contents };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const r = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" +
      model +
      ":generateContent?key=" +
      encodeURIComponent(key),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error((j && j.error && j.error.message) || "gemini_http_" + r.status);
    err.status = r.status;
    throw err;
  }
  return j.candidates[0].content.parts[0].text;
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "invalid_json", reply: "" }));
    return;
  }

  const key =
    (req.headers["x-customer-api-key"] && String(req.headers["x-customer-api-key"]).trim()) ||
    (body.api_key && String(body.api_key).trim()) ||
    (body.apiKey && String(body.apiKey).trim()) ||
    "";

  // Explicit: do NOT fall back to process.env.*_API_KEY (company keys).
  // Optional future: set CHAT_ALLOW_SERVER_KEYS=1 + env keys to enable company-paid LLM.
  const allowServer = String(process.env.CHAT_ALLOW_SERVER_KEYS || "") === "1";
  let provider = String(body.provider || "xai").toLowerCase();
  if (provider === "grok") provider = "xai";

  let effectiveKey = key;
  let usage = null;
  let gatewayModel = "";
  const wantsOurs = !key && (String(body.mode || "") === "ours" || allowServer);
  if (wantsOurs) {
    // "ใช้ระบบของเรา": our server key, only for a verified Google account, metered by soft/hard caps (api/_lib/ai-caps.js).
    // BYOK requests (customer key present) are never metered and never touch server keys.
    const sendJson = (status, obj) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(obj));
    };
    const user = await G.userFromReq(req);
    if (!user) {
      return sendJson(401, { ok: false, error: "google_login_required", gated: true, reply: "โหมดใช้ระบบของเราต้องเข้าสู่ระบบ Google ก่อน" });
    }
    if (!String(body.message || body.text || "").trim()) {
      return sendJson(400, { ok: false, error: "empty_message", reply: "" });
    }
    if (!allowServer) {
      return sendJson(503, { ok: false, error: "our_key_not_configured", gated: true, reply: "ระบบของเรายังไม่เปิดใช้คีย์กลาง (แอดมินยังไม่ตั้งค่า) — ใช้ API token ของคุณเองไปก่อน" });
    }
    // Model = the one the admin selected in /admin → AI Model (stored server-side), called via Vercel AI Gateway.
    let am = null;
    try { am = await AM.active(); } catch (e) { am = null; }
    if (!am) {
      return sendJson(503, { ok: false, error: "no_active_model", gated: true, reply: "ระบบของเรายังไม่ได้เลือกโมเดล (แอดมินยังไม่ตั้งค่า) — ใช้ API token ของคุณเองไปก่อน" });
    }
    effectiveKey = String(process.env.AI_GATEWAY_API_KEY || "").trim();
    if (!effectiveKey) {
      return sendJson(503, { ok: false, error: "our_key_not_configured", gated: true, reply: "ระบบของเรายังไม่มีคีย์ AI Gateway (แอดมินยังไม่ตั้งค่า) — ใช้ API token ของคุณเองไปก่อน" });
    }
    provider = "gateway";
    gatewayModel = am.id;
    let r;
    try {
      r = await U.consume(user.sub);
    } catch (e) {
      return sendJson(503, { ok: false, error: "usage_store_error", gated: true, reply: "ตรวจโควตาไม่ได้ชั่วคราว ลองใหม่ภายหลัง" });
    }
    usage = r.usage;
    if (!r.allowed) {
      return sendJson(429, { ok: false, error: "hard_cap", gated: true, usage, reply: "ใช้ครบ Hard Cap แล้ว — ระงับการใช้จนกว่าจะรีเซ็ตรอบใหม่หรือเติมโควตา" });
    }
  }

  if (!effectiveKey) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        ok: false,
        error: "no_customer_key",
        gated: true,
        reply:
          "ต้องมีคีย์ลูกค้าในหัวข้อ X-Customer-Api-Key (หรือรัน Local Agent) หรือเลือกโหมดใช้ระบบของเราในโปรไฟล์",
      })
    );
    return;
  }

  const message = String(body.message || body.text || "").trim();
  if (!message) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "empty_message", reply: "" }));
    return;
  }

  const history = Array.isArray(body.history) ? body.history : [];
  const messages = [{ role: "system", content: SYSTEM }];
  for (const turn of history.slice(-12)) {
    const role = turn && turn.role;
    const content = turn && String(turn.content || "").trim();
    if ((role === "user" || role === "assistant") && content) {
      messages.push({ role, content });
    }
  }
  messages.push({ role: "user", content: message });

  try {
    let reply;
    if (provider === "gateway") {
      const g = await callGateway(effectiveKey, gatewayModel, messages);
      reply = g.reply;
      // Purchased-budget tracking + low-balance alerts (real token usage from the gateway response; never throws).
      await AB.record(gatewayModel, g.usage);
    }
    else if (provider === "openai") reply = await callOpenAI(effectiveKey, messages);
    else if (provider === "anthropic") reply = await callAnthropic(effectiveKey, messages);
    else if (provider === "gemini") reply = await callGemini(effectiveKey, messages);
    else if (provider === "xai") reply = await callXai(effectiveKey, messages);
    else {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: "unknown_provider", reply: "" }));
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true, provider, model: gatewayModel || undefined, reply, gated: false, source: key ? "byok" : "server_env", usage, soft_warning: !!(usage && usage.state !== "ok") }));
  } catch (e) {
    res.statusCode = e.status && e.status >= 400 ? e.status : 502;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        ok: false,
        error: "provider_error",
        detail: String(e.message || e),
        reply: "ผู้ให้บริการโมเดลตอบผิดพลาด — ตรวจคีย์/โควตา",
        provider,
      })
    );
  }
};
