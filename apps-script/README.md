# Apps Script Backend — วิธีติดตั้ง

## 1. สร้าง Google Sheet เปล่า

สร้าง Google Sheet ใหม่ ชื่ออะไรก็ได้ (เช่น "sinthaiPOS Data") **ยังไม่ต้องสร้างชีตย่อยเอง**

## 2. เปิด Apps Script ที่ผูกกับ Sheet นี้

ในไฟล์ Sheet ที่เพิ่งสร้าง: เมนู **Extensions > Apps Script**

> ต้องเปิดจากเมนูนี้เท่านั้น ไม่ใช่สร้าง Apps Script project แยกลอยๆ เพราะโค้ดใช้
> `SpreadsheetApp.getActiveSpreadsheet()` ซึ่งหมายถึงไฟล์ที่ผูกอยู่

## 3. อัปโค้ดขึ้นไปด้วย clasp

```bash
npm install -g @google/clasp
clasp login
cd apps-script
cp .clasp.json.example .clasp.json    # ใส่ scriptId จาก Project Settings
clasp push
```

## 4. สร้างชีตทั้งหมดด้วยคำสั่งเดียว

ใน Apps Script editor เลือกฟังก์ชัน **`setupSheets`** จากเมนูด้านบน แล้วกด **Run**

จะสร้างชีตทั้ง 7 แผ่นพร้อมหัวคอลัมน์ที่ถูกต้องให้อัตโนมัติ (Products, Sales, SaleItems,
StockMovements, Staff, Settings, BarcodeCaptures) และตั้งคอลัมน์บาร์โค้ดเป็นรูปแบบข้อความ
เพื่อกันเลข 0 นำหน้าหาย

> **ปลอดภัยกับข้อมูลเดิม** ฟังก์ชันนี้ไม่ลบชีต ไม่ลบแถว และไม่ย้ายตำแหน่งคอลัมน์ที่มีอยู่แล้ว
> เติมเฉพาะสิ่งที่ขาด รันซ้ำได้

## 5. ตั้ง API token

**Project Settings > Script Properties > Add script property**

- Key: `API_TOKEN`
- Value: สตริงสุ่มยาวๆ (เช่นจาก `openssl rand -hex 24`)

ค่านี้ต้องตรงกับ `VITE_API_TOKEN` ที่ตั้งฝั่ง `web/.env`

## 6. เพิ่มพนักงานอย่างน้อยหนึ่งคน

รหัส PIN ต้องเก็บเป็นค่า **SHA-256** ไม่ใช่ตัวเลขตรงๆ — ใช้ฟังก์ชันช่วยที่เตรียมไว้:

1. เปิดไฟล์ `Setup.gs` ใน editor
2. แก้บรรทัด `var pin = '1234';` ในฟังก์ชัน `makePinHash` เป็น PIN ที่ต้องการ
3. เลือกฟังก์ชัน **`makePinHash`** แล้วกด **Run**
4. คัดลอกค่า hash จาก Execution log ไปใส่คอลัมน์ `PinHash` ในชีต `Staff`

แถวในชีต `Staff` ต้องมี `UserId`, `Name`, `PinHash`, `Role` (owner/cashier) และ `Active` = TRUE

## 7. ตรวจความพร้อมก่อน deploy

เลือกฟังก์ชัน **`checkSetup`** แล้วกด **Run** จากนั้นดู Execution log

จะบอกชัดเจนว่าอะไรยังขาด เช่น ชีตหาย คอลัมน์ไม่ครบ ยังไม่ได้ตั้ง token ยังไม่มีพนักงาน
เก็บ PIN ผิดวิธี หรือมีบาร์โค้ดซ้ำกัน — แก้ให้หมดก่อนไปขั้นถัดไป

## 8. Deploy เป็น Web App

**Deploy > New deployment**

- Type: **Web app**
- Execute as: **Me**
- Who has access: **Anyone**

คัดลอก URL ที่ลงท้ายด้วย `/exec` ไปใส่ใน `web/.env` เป็น `VITE_API_BASE_URL`

> ทุกครั้งที่แก้โค้ดแล้ว `clasp push` ต้องกด **Deploy > Manage deployments > แก้ไข (ดินสอ) >
> Version: New version > Deploy** ด้วย ไม่งั้น URL เดิมจะยังรันโค้ดเวอร์ชันเก่า

## 9. ทดสอบว่าเรียกได้จริง

```bash
curl "https://script.google.com/macros/s/XXXX/exec?action=ping&token=YOUR_TOKEN"
# ควรได้ {"ok":true,"time":"..."}
```

---

## นำสินค้าเข้าระบบ

หลังติดตั้งเสร็จ ให้สร้างแคตตาล็อกจากชีตต้นทางแล้ววางลงแผ่น `Products`:

```bash
python3 scripts/import_from_sheet.py
python3 scripts/build_catalog.py --write
# วาง build/sheet_products.csv ทับแผ่น Products
```

รายละเอียดอยู่ใน [`../README.md`](../README.md)

## ทดสอบโค้ดฝั่ง Apps Script

ตรรกะการติดตั้งมีเทสต์ที่รันได้ในเครื่องโดยไม่ต้องขึ้น Google:

```bash
node --test "tests/apps-script/*.test.mjs"
```

ใช้ตัวจำลอง Sheets API ใน `tests/apps-script/harness.mjs` ครอบคลุม 40 เคส:

- **ขั้นตอนติดตั้ง** — สร้างชีต รันซ้ำ เติมคอลัมน์ที่ขาดโดยไม่ย้ายของเดิม และทุกกรณีที่
  `checkSetup` ต้องจับได้
- **API ทั้งเส้น** — เรียกผ่าน `doGet`/`doPost` เหมือนที่แอปเรียกจริง ตรวจว่าขายแล้วตัดสต็อกถูก,
  บิลหลายรายการที่ของไม่พอตัวหนึ่งต้องไม่ตัดสต็อกตัวอื่นเลย, ยิงบิลซ้ำไม่ตัดสต็อกซ้ำ,
  ยกเลิกบิลคืนของครบและยกเลิกซ้ำไม่ได้, บิลที่ยกเลิกไม่ถูกนับในรายงาน,
  และ **ชื่อ field ทุกตัวที่ฝั่งแอปอ่านต้องมีอยู่จริงในคำตอบ**
