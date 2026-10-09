# Social Trade (`#social`)

Shows **only NEXTTRADE's own Master traders**: members who signed in with Google, applied in
`#social/me`, and were approved by an admin in `/admin`. There is no external or global Brokeree directory, no seeded or fake
Masters, and no invented statistics. With no approved Masters the page shows **"ยังไม่มี Master"**.

## Roles (checked server-side in `api/social/[op].js`)
| Role | How | Can |
|------|-----|-----|
| Client | Google login | see approved Masters, follow/unfollow, open the Master's Brokeree link ("Copy ผ่าน Brokeree") |
| Master applicant | Google login → `POST /api/social/apply` | status `pending` (cannot edit until approved) |
| Approved Master | admin `master_approve` | `POST /api/social/profile` to edit own profile |
| Admin | `/admin` (username/password session) | `master_approve`, `master_reject` (note), `master_suspend`, `master_delete` |

## Master profile fields
- `display_name` (2–40), `strategy` (20–2000), `risk` (`low|medium|high`), `min_deposit` (เงินลงทุนขั้นต่ำ, free text ≤ 60)
- `profit_share_pct` (optional, 0–100, ≤ 2 decimals), `fee_details` (optional, ≤ 300). Used only when Brokeree doesn't publish the value
- `brokeree_url` (required): **ลิงก์ Brokeree Social Trading**, the Strategy/Provider link from the Master's broker Brokeree
  portal (https, any domain, since every broker hosts its own portal). Clients join via this link.
- `myfxbook_url` (optional): must be `https://www.myfxbook.com/…`

## Offer terms (Profit sharing, minimum investment)
Read **server-side** from the Master's Brokeree link by `api/_lib/brokeree.js`, cached 6 h (failures 30 min), with `fetched_at`
shown to clients as "อ่านจากลิงก์ Brokeree … เมื่อ <time>".
- Supported link: `https://<broker portal>/portal/registration/subscription/<providerId>/<OfferName>` (the provider's offer link).
- The portal is an Angular SPA, so the HTML has no terms. We read the same **public, unauthenticated** JSON the registration page loads
  before login: `/api/brief/providers/<id>` and `/api/brief/providers/<id>/offers`.
- Parsed fields (as published; null stays null): `performance.fee` (%) and `performance.interval` → Profit sharing,
  `filters.minBalance` (+ offer currency, e.g. USC = US cents) → เงินลงทุนขั้นต่ำ, `managementFee`(+interval), `registrationFee`,
  offer name, provider nickname. Checked on 3 broker portals (Oct 2026): fee + interval always present; minBalance often null.
- Not available from these public endpoints: performance stats (returns, drawdown), follower counts, AUM.
- Fallback per field: Master-entered `profit_share_pct` (0–100) / `min_deposit` (free text) / `fee_details`, labelled **ข้อมูลจาก Master**.
  If neither exists, "—". Numbers are never invented.
- Other link shapes (ratings widgets, broker landing pages) → `unsupported_link` → Master fields only.

## Brokeree / Myfxbook display
- **No Brokeree API integration** (that needs broker credentials). Link-out only.
- `GET /api/social/preview?id=` probes the approved Master's links server-side:
  - `embeddable` is false if the page sends `X-Frame-Options` or a CSP `frame-ancestors` that doesn't allow `*`/`https:`.
    If embeddable, the detail page shows a sandboxed iframe **plus** an open-in-new-tab button. Otherwise it is link-out only.
  - Public `og:title` / `og:description` / `og:image` only. No cookies, no login, no private data.
  - SSRF guards: https only, public IPs only (DNS checked each hop), ≤ 3 redirects, 6 s timeout, ≤ 512 KB, cached 6 h.
  - Only links of approved Masters are probed. The client can't pass arbitrary URLs.
- Myfxbook sends `X-Frame-Options: SAMEORIGIN`, so it is always a link button (new tab).

## Following
`POST /api/social/follow {id, follow}`. "Copy ผ่าน Brokeree" opens the broker link in a new tab and records the follow.
The **Social Trade** card in โปรไฟล์สมาชิก lists followed Masters. Follower counts shown are counts in our system only.

## Storage
`api/_lib/social.js` uses `api/_lib/store.js`: Upstash Redis when `KV_REST_API_URL/TOKEN` or `UPSTASH_REDIS_REST_URL/TOKEN`
are set, otherwise in-memory (lost on cold start, so connect Redis for production).
