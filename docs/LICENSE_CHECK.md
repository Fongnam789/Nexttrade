# EA License — ออกและตรวจไลเซนส์

ไลเซนส์ผูกกับ **EA + เลขบัญชี MT5 + ชื่อเซิร์ฟเวอร์โบรกเกอร์** และลงลายเซ็น HMAC-SHA256 ที่เซิร์ฟเวอร์เท่านั้น
(ไม่มีการเซ็นในเบราว์เซอร์) ด้วย env `LICENSE_SECRET` บน Vercel (ไม่อยู่ใน repo)

## รูปแบบคีย์

```
NTL1.<base64url(JSON payload)>.<base64url(HMAC-SHA256(LICENSE_SECRET, "NTL1." + payloadPart))>
payload = { v, ea, acct, srv, st, iat, exp, uid, jti }
```

- `st` ที่เซ็นในคีย์ = `pending_payment` เสมอ (ยังไม่มีระบบยืนยันชำระอัตโนมัติ)
- สถานะจริงมาจากเรคคอร์ดฝั่งเซิร์ฟเวอร์ (`jti`) ที่แอดมินจัดการใน `/admin`:
  `pending_payment` → `pending_approval` (ยืนยันชำระ) → `active` (อนุมัติ) หรือ `revoked`

## API

| Method | Path | Auth | ใช้ทำอะไร |
|---|---|---|---|
| POST | `/api/license` | `Authorization: Bearer <Google ID token>` | ออกคีย์ `{ ea, account, server }` |
| POST | `/api/license/verify` | public | EA ตรวจคีย์ `{ key, account, server?, ea? }` |
| GET/POST | `/api/ea/requests` | Google ID token | ลูกค้าดูสถานะ / เลือกวิธีรับ EA |

ผล verify:

```json
{ "valid": true, "status": "active", "trade_allowed": true, "ea": "keylevel-oneshot",
  "account": "12345678", "server": "Exness-MT5Real8", "expires_at": "2026-11-08T13:00:00.000Z" }
```

EA เทรดได้เมื่อ `trade_allowed === true` เท่านั้น (valid + ยังไม่หมดอายุ + บัญชีตรง + สถานะ `active`)

## ฝั่ง EA (MQL5)

1. **เช็คเลขบัญชีแบบออฟไลน์** — ถอด payload (ส่วนกลางของคีย์) แล้วเทียบ `acct` กับ `AccountInfoInteger(ACCOUNT_LOGIN)`
   (ตรวจลายเซ็นในเครื่องไม่ได้ เพราะห้ามฝัง `LICENSE_SECRET` ใน EA)
2. **ตรวจออนไลน์** — `WebRequest` ไป `/api/license/verify` ตอน `OnInit` และทุก ๆ N ชั่วโมง
   ต้องเพิ่ม URL `https://web-ai-dashboard-nt.vercel.app` ใน MT5 › Tools › Options › Expert Advisors › Allow WebRequest

```mql5
input string InpLicenseKey = "";   // NTL1.xxxxx.yyyyy
#define NT_VERIFY_URL "https://web-ai-dashboard-nt.vercel.app/api/license/verify"

string B64UrlToB64(string s)
{
   StringReplace(s, "-", "+");
   StringReplace(s, "_", "/");
   while(StringLen(s) % 4 != 0) s += "=";
   return s;
}

// 1) offline: payload.acct must equal this account
bool LicenseAccountMatches(const string key)
{
   string parts[];
   if(StringSplit(key, '.', parts) != 3 || parts[0] != "NTL1") return false;
   uchar src[], dst[], empty[];
   StringToCharArray(B64UrlToB64(parts[1]), src, 0, StringLen(B64UrlToB64(parts[1])));
   if(CryptDecode(CRYPT_BASE64, src, empty, dst) <= 0) return false;
   string json = CharArrayToString(dst);
   string want = "\"acct\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\"";
   return StringFind(json, want) >= 0;
}

// 2) online: server checks signature, expiry, account, admin status
bool LicenseTradeAllowed(const string key)
{
   string body = "{\"key\":\"" + key + "\",\"account\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) +
                 "\",\"server\":\"" + AccountInfoString(ACCOUNT_SERVER) + "\"}";
   uchar req[], res[];
   string resHeaders;
   StringToCharArray(body, req, 0, StringLen(body));
   int code = WebRequest("POST", NT_VERIFY_URL, "Content-Type: application/json\r\n", 5000, req, res, resHeaders);
   if(code != 200) { Print("License verify HTTP ", code, " err ", GetLastError()); return false; }
   string out = CharArrayToString(res);
   return StringFind(out, "\"trade_allowed\":true") >= 0;
}

int OnInit()
{
   if(!LicenseAccountMatches(InpLicenseKey)) { Alert("ไลเซนส์ไม่ตรงกับบัญชีนี้"); return INIT_FAILED; }
   if(!LicenseTradeAllowed(InpLicenseKey))   { Alert("ไลเซนส์ยังไม่พร้อมใช้งาน (รอชำระ/รออนุมัติ/ถูกเพิกถอน)"); return INIT_FAILED; }
   EventSetTimer(6 * 3600); // re-check every 6 h
   return INIT_SUCCEEDED;
}

void OnTimer()
{
   if(!LicenseTradeAllowed(InpLicenseKey)) { Print("License no longer active — stop trading"); ExpertRemove(); }
}
```

> นโยบายเมื่อเน็ตหลุด (grace period) ให้ทีมกำหนดเอง ตัวอย่างข้างบนปิด EA ถ้าตรวจไม่ผ่าน

## ข้อจำกัดตอนนี้ (ต้องมี backend/DB)

- เรคคอร์ดสถานะ (ชำระ/อนุมัติ/เพิกถอน) อยู่ใน store แบบ pluggable (`api/_lib/store.js`) —
  ถ้ายังไม่ต่อ Vercel KV/Upstash (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) จะอยู่ในหน่วยความจำและหายได้
  (verify จะถอยไปใช้สถานะในคีย์ = `pending_payment` ⇒ ไม่ให้เทรด ซึ่งปลอดภัย)
- ยังไม่มีการยืนยันชำระอัตโนมัติจาก blockchain / ลิงก์ดาวน์โหลดไฟล์ส่วนตัว
