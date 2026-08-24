# ทำให้ Callback URL ของ Meta ไม่เปลี่ยนอีกต่อไป

## ปัญหาที่กำลังแก้

ตอนนี้เปิดอุโมงค์ด้วยคำสั่งนี้

```
cloudflared tunnel --url http://localhost:3000
```

ซึ่งเป็น **Quick Tunnel** — Cloudflare สุ่มชื่อใหม่ให้ทุกครั้ง เช่น
`brave-mountain-tiger.trycloudflare.com` แล้วครั้งหน้าเปลี่ยนเป็นชื่ออื่น

ผลคือ **ต้องเข้าไปแก้ Callback URL ที่ Meta ทุกครั้งที่เปิดเครื่อง** ซึ่งเสียเวลา
และเสี่ยงลืมแก้แล้วนึกว่าระบบพัง (ข้อความจะไม่เข้าเลย ทั้งที่โค้ดถูกต้อง)

**Named Tunnel** แก้ปัญหานี้ — ผูกกับโดเมนของเราถาวร ตั้งครั้งเดียวจบ

---

## สิ่งที่ต้องมี

| อย่าง | มีแล้วหรือยัง | หมายเหตุ |
|---|---|---|
| บัญชี Cloudflare | ฟรี | สมัครที่ cloudflare.com |
| โดเมนใน Cloudflare | **ต้องมี** | โดเมนอะไรก็ได้ที่ย้าย DNS มาที่ Cloudflare แล้ว |
| cloudflared | `brew install cloudflared` | มีอยู่แล้วถ้าเคยใช้ Quick Tunnel |

> **ถ้ายังไม่มีโดเมน** — จดโดเมนถูก ๆ สักอันก็พอ (ปีละ ~300-400 บาท)
> ใช้ซับโดเมนอย่าง `hubchat.ชื่อโดเมนของคุณ.com` ได้เลย ไม่ต้องมีเว็บจริง
>
> ตรงนี้เป็นสิ่งที่ผมทำแทนคุณไม่ได้ เพราะต้องใช้บัญชีและบัตรของคุณเอง

---

## ขั้นตอน — ทำครั้งเดียวจบ

### 1. เข้าสู่ระบบ Cloudflare จากเครื่อง

```bash
cloudflared tunnel login
```

เบราว์เซอร์จะเปิดขึ้นมาให้เลือกโดเมน เลือกแล้วจบ
คำสั่งนี้จะวางไฟล์ `cert.pem` ไว้ที่ `~/.cloudflared/`

### 2. สร้างอุโมงค์

```bash
cloudflared tunnel create hubchat
```

จะได้ผลประมาณนี้

```
Created tunnel hubchat with id 6ff42ae2-765d-4adf-8112-31c55c1551ef
```

**จด id นี้ไว้** — ต้องใช้ในขั้นถัดไป

### 3. ตั้งค่า

```bash
cp tunnel/config.example.yml tunnel/config.yml
```

เปิด `tunnel/config.yml` แล้วแก้ 3 บรรทัดที่เขียนว่า "แก้ตรงนี้" :

```yaml
tunnel: 6ff42ae2-765d-4adf-8112-31c55c1551ef
credentials-file: /Users/ice/.cloudflared/6ff42ae2-765d-4adf-8112-31c55c1551ef.json

ingress:
  - hostname: hubchat.โดเมนของคุณ.com
    service: http://localhost:3000
  - service: http_status:404
```

### 4. ชี้ DNS มาที่อุโมงค์

```bash
cloudflared tunnel route dns hubchat hubchat.โดเมนของคุณ.com
```

### 5. เปิดใช้

```bash
npm run dev      # หน้าต่างที่ 1
npm run tunnel   # หน้าต่างที่ 2
```

จะเห็นข้อความบอก Callback URL ที่ต้องเอาไปใส่ที่ Meta

---

## สิ่งที่ต้องทำที่ Meta — ครั้งเดียวเช่นกัน

1. เข้า https://developers.facebook.com → เลือกแอปของคุณ
2. ไปที่ **Webhooks** → Messenger → **Edit Callback URL**
3. ใส่

   ```
   Callback URL : https://hubchat.โดเมนของคุณ.com/api/webhooks/meta
   Verify Token : ค่าเดียวกับ META_VERIFY_TOKEN ใน .env.local
   ```

4. กด **Verify and Save**
5. ทำซ้ำที่ **Instagram** → Webhooks ถ้าใช้ IG ด้วย

**หลังจากนี้ไม่ต้องกลับมาแก้อีก** ต่อให้ปิดเครื่อง รีสตาร์ต หรือปิด-เปิด tunnel

---

## ตรวจว่าใช้ได้จริง

```bash
curl -i "https://hubchat.โดเมนของคุณ.com/api/health"
```

ได้ `200` = อุโมงค์ถึงเครื่องคุณแล้ว

> ⚠️ อย่าเอา URL ที่มี `hub.verify_token=...` ไปวางในที่สาธารณะ
> ค่านั้นคือรหัสลับที่ใช้ยืนยันว่า Meta เป็นคนยิงมาจริง

---

## ถ้าติดปัญหา

| อาการ | สาเหตุที่พบบ่อย |
|---|---|
| `failed to connect to origin` | ยังไม่ได้เปิด `npm run dev` |
| Meta ขึ้น "The URL couldn't be validated" | Verify Token ไม่ตรงกับใน `.env.local` |
| `tunnel credentials file not found` | ที่อยู่ `credentials-file` ใน config.yml ผิด |
| ข้อความไม่เข้าเลย | ยังไม่ได้กด Subscribe ฟิลด์ `messages` ในหน้า Webhooks |

---

## ทางเลือกอื่น ถ้ายังไม่อยากซื้อโดเมน

Named Tunnel ต้องมีโดเมน แต่มีทางอื่นที่ได้ที่อยู่คงที่เหมือนกัน :

- **ngrok แบบเสียเงิน** (~$8/เดือน) — ได้ subdomain คงที่ ไม่ต้องมีโดเมน
- **เอาขึ้นเซิร์ฟเวอร์จริงเลย** (Railway / Render) — ตามที่สเปกวางไว้ตั้งแต่ต้น
  วิธีนี้จบปัญหาถาวรและได้ที่อยู่จริง เหมาะเมื่อพร้อมใช้งานกับลูกค้าจริง

ระหว่างที่ยังไม่ตัดสินใจ Quick Tunnel เดิมยังใช้ได้อยู่ — แค่ต้องแก้ URL ทุกครั้ง
