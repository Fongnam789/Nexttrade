# AI Model (admin) — pricing, per-model caps, active model, budgets & alerts

All admin-only: `/admin` → **AI Model** card; server routes `/api/admin/data` + `/api/admin/action` (admin session cookie + `X-NT-Admin` header).

## Pricing — `ai_models.json`
USD per 1M tokens, verified 2026-10-09, each model has `source_url`. `id` is the Vercel AI Gateway model id.
Admin edits are stored server-side (`cfg:ai_models_v1`); "รีเซ็ต" returns to the file values.
Gemini 3.8 Flash has two tiers (promo until 2026-12-31, then 1.50/7.50). Claude Haiku 5.5 has `token_factor` 1.3 (its tokenizer uses ~30% more tokens; applied to estimates only when the toggle is on).

## Per-model caps
Each model has its own soft/hard **requests per user per month** (default 100/150). When a model is active, `api/_lib/ai-caps.js` returns that model's caps,
so `/api/chat` ("ใช้ระบบของเรา") and `/api/ai/usage` enforce them. The global caps card only applies when no model is active. Usage counters are per user per month and are not reset when the active model changes.

## Active model → /api/chat
`cfg:ai_model_active`. Ours mode calls `https://ai-gateway.vercel.sh/v1/chat/completions` with `AI_GATEWAY_API_KEY`. Returns 503 when
`CHAT_ALLOW_SERVER_KEYS` ≠ 1 / no active model (`no_active_model`) / no key (`our_key_not_configured`). BYOK unchanged.

## Cost table (estimate)
monthly = users × model cap (soft or hard) × (in_tokens × price_in + out_tokens × price_out) / 1e6 [× token_factor].
Rows 100…2000 users. Assumes every user hits the cap; excludes tax, gateway fees, cache discounts.

## Purchased budgets + low-token alerts (`api/_lib/ai-budget.js`)
- Admin enters what was bought per model (`model:<id>`) or provider (`provider:<name>`), in USD or tokens.
- `/api/chat` ours mode records the real `usage.prompt_tokens/completion_tokens` from the gateway response, priced with the current (admin) prices for the Bangkok date. BYOK is not counted.
- Remaining ≤ 20 % / 10 % / 5 % → one alert per threshold per budget period: admin banner + alert list, and push to
  Telegram (`ADMIN_ALERT_TELEGRAM_BOT_TOKEN` + `ADMIN_ALERT_TELEGRAM_CHAT_ID`) and/or LINE (`ADMIN_ALERT_LINE_TOKEN` + `ADMIN_ALERT_LINE_TO`) if set; otherwise skipped silently and the admin shows "ยังไม่ได้ตั้งช่องทางแจ้งเตือน".
- "เติม token" starts a new period (counter 0, thresholds re-armed; optional new amount).
- **Requires a durable store (Upstash Redis) and `AI_GATEWAY_API_KEY` + `CHAT_ALLOW_SERVER_KEYS=1`**; with the memory store counters/alerts are lost on cold start, and with no key there is no usage to count.
