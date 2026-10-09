# การใช้ AI — API token ของลูกค้า หรือ ระบบของเรา

ตั้งค่าในหน้า **โปรไฟล์สมาชิก › การใช้ AI / API token**

| โหมด | คีย์ | การจำกัด |
|---|---|---|
| A · ใช้ API token ของตัวเอง (BYOK) | เก็บในเบราว์เซอร์ลูกค้า (เมนู API Keys) ส่งไปกับคำถามแต่ละครั้งใน `X-Customer-Api-Key` · เซิร์ฟเวอร์ไม่เก็บ/ไม่ log | ไม่จำกัดโดยระบบ |
| B · ใช้ระบบของเรา | คีย์กลางใน env (`OPENAI_API_KEY` ฯลฯ) + `CHAT_ALLOW_SERVER_KEYS=1` | Soft/Hard Cap ต่อบัญชี Google บังคับที่ `/api/chat` |

## Cap

- **Soft cap**: ยังใช้ได้ แจ้งเตือน (แบนเนอร์ในโปรไฟล์ + ข้อความในแชต)
- **Hard cap**: `/api/chat` ตอบ 429 `hard_cap` จนกว่าจะรีเซ็ตรอบ (เวลาไทย) หรือแอดมินปรับ Cap
- ค่าเริ่มต้นใน `api/_lib/ai-caps.js` (`soft 100`, `hard 150` ข้อความ/เดือน) เป็น **ค่าชั่วคราว รอแอดมินกำหนด ไม่ใช่ราคา**
- ลำดับความสำคัญ: ค่าที่แอดมินตั้งใน `/admin` > env `AI_CAP_SOFT_MESSAGES` / `AI_CAP_HARD_MESSAGES` / `AI_CAP_PERIOD` > ค่าเริ่มต้น
- `GET /api/ai/usage` (Bearer Google ID token) คืน `used / soft / hard / state / resets_at / durable`

## ต้องมี DB

ตัวนับใช้ `api/_lib/store.js` — ถ้าไม่มี `KV_REST_API_URL` + `KV_REST_API_TOKEN` จะนับในหน่วยความจำต่อ instance
(ไม่ใช่ลิมิตจริง) · ยังไม่มี: เติมโควตาต่อบัญชี, ส่งแจ้งเตือนทางอีเมล/LINE เมื่อถึง Soft cap
