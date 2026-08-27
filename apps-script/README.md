# Apps Script Backend — วิธี Deploy

## 1. สร้าง Google Sheet
สร้าง Google Sheet ตามโครงสร้างใน [`../docs/SHEET_SCHEMA.md`](../docs/SHEET_SCHEMA.md) (6 ชีต:
Products, Sales, SaleItems, StockMovements, Staff, Settings)

อย่าลืมเพิ่มพนักงานอย่างน้อย 1 คนในชีต `Staff` — คอลัมน์ `PinHash` ต้องเป็นค่า SHA-256 ของ PIN
(ไม่ใช่ PIN ตรงๆ) หา hash ได้จากคอนโซล browser:
```js
crypto.subtle.digest('SHA-256', new TextEncoder().encode('1234'))
  .then(buf => console.log([...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')));
```

## 2. เปิด Apps Script ผูกกับ Sheet
ใน Google Sheet ที่สร้าง: เมนู **Extensions > Apps Script** จะได้ project ใหม่ที่ผูกกับ Sheet นี้
โดยอัตโนมัติ (สำคัญ: ต้องเปิดจากเมนูนี้ ไม่ใช่สร้าง Apps Script project แยกลอยๆ เพราะโค้ดใน
`Code.gs` ใช้ `SpreadsheetApp.getActiveSpreadsheet()` ซึ่งอ้างถึง Sheet ที่ผูกอยู่)

## 3. Deploy โค้ดจาก VS Code ด้วย clasp
```bash
npm install -g @google/clasp
clasp login
cd apps-script
cp .clasp.json.example .clasp.json   # แล้วใส่ scriptId จาก Project Settings ของ Apps Script project
clasp push
```
(ทุกครั้งที่แก้โค้ดใน `apps-script/*.gs` ให้รัน `clasp push` เพื่ออัปขึ้น Apps Script)

## 4. ตั้งค่า API_TOKEN
ใน Apps Script editor: **Project Settings > Script Properties > Add script property**
- Key: `API_TOKEN`
- Value: สุ่มสตริงยาวๆ (เช่นจาก `openssl rand -hex 24`) — ค่านี้ต้องตรงกับ `VITE_API_TOKEN`
  ที่ตั้งฝั่ง `web/.env`

## 5. Deploy เป็น Web App
**Deploy > New deployment**
- Type: **Web app**
- Execute as: **Me**
- Who has access: **Anyone**

คัดลอก URL ที่ได้ (ลงท้ายด้วย `/exec`) ไปใส่ใน `web/.env` เป็น `VITE_API_BASE_URL`

ทุกครั้งที่แก้โค้ดแล้ว `clasp push` ต้องกด **Deploy > Manage deployments > แก้ไข (ไอคอนดินสอ) >
Version: New version > Deploy** ด้วย ไม่งั้น URL เดิมจะยังรันโค้ดเวอร์ชันเก่าอยู่

## 6. ทดสอบ
```bash
curl "https://script.google.com/macros/s/XXXX/exec?action=ping&token=YOUR_TOKEN"
# ควรได้ {"ok":true,"time":"..."}
```
