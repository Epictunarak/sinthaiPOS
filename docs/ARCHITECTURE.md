# สถาปัตยกรรม sinthaiPOS

ระบบ POS หลังบ้านสำหรับร้านค้าปลีก/ส่งขนาดเล็ก (สต็อก ~350 SKU) ออกแบบให้ต้นทุนต่ำที่สุด
(ใช้ tier ฟรีทั้งหมด), ดูแลง่ายจาก VS Code คนเดียว, และใช้ Google Sheets ที่ร้านคุ้นเคยอยู่แล้ว
เป็นฐานข้อมูลหลัก แทนที่จะย้ายไปใช้ฐานข้อมูลใหม่

## ภาพรวม

```
┌─────────────────────────────┐        HTTPS (JSON, text/plain)      ┌──────────────────────────┐
│   PWA (web/)                │  ───────────────────────────────▶   │  Google Apps Script       │
│   - iOS Safari (Add to      │  ◀───────────────────────────────   │  Web App (apps-script/)   │
│     Home Screen)            │                                      │  - doGet / doPost router  │
│   - Windows Chrome/Edge     │                                      │  - ตรวจ token             │
│   - ติดตั้งเป็นแอปได้ (PWA) │                                      │  - อ่าน/เขียน Sheet       │
│   - ทำงาน offline ได้บางส่วน│                                      │  - คำนวณ stock/ยอดขาย     │
│     (IndexedDB queue)       │                                      └───────────┬──────────────┘
└─────────────────────────────┘                                                  │
        │ โฮสต์ฟรีบน                                                            │ อ่าน/เขียนตรง
        │ GitHub Pages / Cloudflare Pages                                        ▼
        ▼                                                              ┌──────────────────────────┐
   (static files)                                                      │  Google Sheet             │
                                                                        │  (ฐานข้อมูลหลัก - ของเดิม) │
                                                                        │  Products / Sales /       │
                                                                        │  SaleItems / StockMoves / │
                                                                        │  Staff / Settings         │
                                                                        └──────────────────────────┘
```

## ทำไมเลือกแบบนี้

- **ไม่มีเซิร์ฟเวอร์ให้ดูแล** — Apps Script รันบน infra ของ Google ฟรี ไม่มี cold start แบบ
  free-tier server ทั่วไป (เช่น Render/Railway ที่ sleep เมื่อไม่มีคนใช้ ซึ่งแย่มากสำหรับ POS
  หน้าร้านที่ต้องตอบสนองทันที)
- **ใช้ Google Sheets เดิมได้เลย** — ไม่ต้อง migrate ข้อมูล 350 รายการไปฐานข้อมูลใหม่, พนักงาน/
  เจ้าของร้านที่คุ้นกับ Sheets ยังแก้ข้อมูลตรงในชีตได้ (เช่น เพิ่มสินค้าใหม่, แก้ราคา) โดยระบบ POS
  จะอ่านค่าล่าสุดเสมอ
- **PWA ตัวเดียวใช้ได้ทั้ง iOS และ Windows** — ไม่ต้องเขียน 2 แอปแยก ไม่ต้องมี Apple Developer
  account ($99/ปี) ไม่ต้องผ่าน App Store review
- **โฮสต์ frontend ฟรี** — GitHub Pages ของ repo นี้ (หรือ Cloudflare Pages) deploy ผ่าน GitHub
  Actions อัตโนมัติทุกครั้งที่ push

## ข้อจำกัดที่ต้องรู้ (trade-off)

- Google Sheets เหมาะกับสเกลนี้ (~350 SKU, ร้านเดียว) แต่ไม่เหมาะกับหลายสาขาที่เขียนพร้อมกัน
  หนักๆ หรือข้อมูลหลักหมื่น-แสนแถว ถ้าร้านขยายสาขาในอนาคต ค่อยย้าย backend ไปฐานข้อมูลจริง
  (Postgres/Supabase) ได้ในภายหลัง — Apps Script layer ถูกออกแบบให้เป็น "API boundary" ที่สลับ
  ฐานข้อมูลด้านหลังได้โดยไม่กระทบ frontend มากนัก
- Apps Script Web App มี quota ฟรี (เช่น เวลารันสคริปต์ต่อวัน) ซึ่งเพียงพอมากสำหรับร้านเล็ก
  แต่ควรรู้ไว้ถ้าร้านค้าปลีก/ส่งมีธุรกรรมหลักพันครั้ง/วัน
- Offline mode ของ PWA รองรับ "ขายของตอนเน็ตหลุด แล้ว sync ทีหลัง" แต่ไม่ใช่ full offline-first
  database — ต้องออนไลน์อย่างน้อยครั้งแรกเพื่อโหลดสินค้า/ล็อกอิน

## ส่วนประกอบ

### 1. Google Sheet (ฐานข้อมูล)
ดูรายละเอียดชีตทั้งหมดใน [`SHEET_SCHEMA.md`](./SHEET_SCHEMA.md)

### 2. Apps Script Backend (`apps-script/`)
- REST-like API ผ่าน `doGet`/`doPost` เดียว, แยก route ด้วย `?action=`
- ตรวจ `token` ทุก request (เก็บใน Script Properties) กัน URL หลุดแล้วมีคนยิง API เข้ามาป่วน
- ใช้ `LockService` ป้องกัน race condition ตอนตัดสต็อกพร้อมกันหลายเครื่อง
- endpoint หลัก: `login`, `products`, `createSale`, `adjustStock`, `report`
- deploy ผ่าน [`clasp`](https://github.com/google/clasp) จาก VS Code ได้ตรง (ดู README)

### 3. PWA Frontend (`web/`)
- Vite + vanilla JS (ไม่ผูก framework หนักๆ, แก้ง่ายจาก VS Code คนเดียว)
- `vite-plugin-pwa` สร้าง manifest + service worker (precache หน้าเว็บ, cache สินค้าไว้ใช้ offline)
- IndexedDB (`src/db.js`) เก็บ: แคชสินค้า, คิวการขายที่ยังไม่ sync (`pendingSales`)
- หน้าจอหลัก: `login`, `pos` (ขายของ), `inventory` (ดูสต็อก/สินค้าใกล้หมด), `reports` (ยอดขายรายวัน)
- รองรับเครื่องยิงบาร์โค้ด USB/บลูทูธแบบ keyboard-emulation ได้ทันที (พิมพ์ + Enter) และมี fallback
  กล้องมือถือผ่าน `BarcodeDetector` API เป็น progressive enhancement

## แผนขยายในอนาคต (ไม่อยู่ใน scope รอบนี้)
- หน้าจอ CRUD สินค้า/พนักงานเต็มรูปแบบใน PWA (รอบนี้ยังแก้ผ่าน Sheet โดยตรง)
- พิมพ์ใบเสร็จผ่านเครื่องพิมพ์ ESC/POS โดยตรง (รอบนี้ใช้ print หน้าเว็บ/PDF ไปก่อน)
- แจ้งเตือนสต็อกใกล้หมดผ่าน LINE Notify/Email
- ย้าย backend ไปฐานข้อมูลจริงเมื่อร้านขยายหลายสาขา
