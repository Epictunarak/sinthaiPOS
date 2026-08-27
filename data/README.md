# data/ — ข้อมูลสินค้าและราคา

## ต้นทางคือ Google Sheet

ต้นทางจริงของข้อมูลคือ Google Sheet **"สินไทยพาณิชย์"**
`https://docs.google.com/spreadsheets/d/1d_dMTYFI0opKvJdgFoqRezIwjav25ZrfGjcANLD7dnc`

ชีตที่ใช้:
- `SKU Price Comparison` → รายการสินค้า
- `Reference` → ราคาผู้ขายพร้อม URL อ้างอิงและสถานะการตรวจสอบ

## ไฟล์ในโฟลเดอร์นี้

| ไฟล์ | สร้างจาก | แก้ด้วยมือได้ไหม |
|---|---|---|
| `source/sinthai_sheet_snapshot.xlsx` | ดาวน์โหลดจาก Google Sheet | ไม่ — ให้ดาวน์โหลดใหม่ทับ |
| `products_master.csv` | `scripts/import_from_sheet.py` | **ไม่ — จะถูกเขียนทับ** |
| `vendor_prices.csv` | `scripts/import_from_sheet.py` | **ไม่ — จะถูกเขียนทับ** |

**แก้ข้อมูลสินค้าและราคาที่ Google Sheet เท่านั้น** แล้วนำเข้าใหม่ ไฟล์ CSV สองไฟล์นี้เป็น
ผลลัพธ์ที่ถูกสร้างใหม่ทุกครั้ง (commit ไว้ใน git เพื่อให้เห็น diff ว่าข้อมูลเปลี่ยนอะไรบ้าง
ระหว่างการนำเข้าแต่ละรอบ)

## ขั้นตอนอัปเดตข้อมูล

```bash
# 1. ดาวน์โหลดชีตเป็น .xlsx (File > Download > Microsoft Excel)
#    วางทับ data/source/sinthai_sheet_snapshot.xlsx

# 2. แปลงเป็น CSV ที่ระบบใช้
python3 scripts/import_from_sheet.py

# 3. ดูผลกระทบต่อกำไร (จะบอกว่ามีสินค้าไหนขายต่ำกว่าทุนบ้าง)
python3 scripts/build_catalog.py

# 4. สร้างไฟล์ผลลัพธ์ลง build/
python3 scripts/build_catalog.py --write

# 5. นำเข้าฐานข้อมูล PostgreSQL (ดู ../README.md)
```

## สิ่งที่ **ไม่** ถูกเก็บใน CSV โดยตั้งใจ

**ต้นทุน กำไร และราคาขายส่ง ไม่ถูกเก็บเป็นค่าตายตัว** เพราะเป็นค่าที่ *คำนวณได้*
จาก `vendor_prices.csv` ถ้าพิมพ์เก็บไว้ พอราคา Makro เปลี่ยน ตัวเลขจะค้างอยู่กับอดีต
โดยไม่มีใครรู้ตัว

ค่าเหล่านี้คำนวณสองที่ และต้องให้คำตอบตรงกันเสมอ (มีเทสต์คุมใน `tests/run_sql_tests.sh`):
- `scripts/build_catalog.py` — ใช้ตอนยังไม่มีฐานข้อมูล
- `sinthai.product_margin_view` — ใช้ตอนระบบรันจริง

## คอลัมน์สำคัญที่ต้องเข้าใจ

### `vendor_role` — ผู้ขายรายไหนทำหน้าที่อะไร
- `Makro` = **supplier** ราคาที่ร้านซื้อเข้า = **ต้นทุน**
- `Lotus` / `BigC` = **competitor** ราคาที่ลูกค้าเทียบได้ = **เพดานราคาขาย**

ชีตเดิมจัดสามเจ้านี้เป็น vendor เหมือนกันหมด ทำให้คำนวณกำไรไม่ได้

### `price_basis` — ราคานี้คือต่อชิ้นหรือต่อแพ็ค
ราคาบางแถวเป็นราคา *ต่อชิ้น* บางแถวเป็นราคา *ต่อแพ็ค* ทุกราคาจะถูกแปลงเป็น "ต่อแพ็ค"
ก่อนนำไปเทียบเสมอ

### `confidence` — ราคานี้เชื่อได้แค่ไหน
| ค่า | ใช้ตั้งราคาได้ไหม |
|---|---|
| `verified` | ได้ |
| `comparable` | ใช้ประกอบ ไม่ใช้ตัดสินใจ (มักคนละขนาดบรรจุ) |
| `listing` | ต้องตรวจซ้ำก่อน |
| `template_sample` | **ไม่ได้** — ค่าตัวอย่างจากเทมเพลต ระบบตัดออกอัตโนมัติ |

### `data_flags` — ปัญหาที่ตรวจพบในแต่ละแถว
เช่น `barcode_missing`, `sku_assigned_by_import`, `pack_qty_not_in_name`,
`category_missing`, `unit_corrected_L_to_ml`

รายละเอียดทั้งหมดอยู่ใน [`../docs/DATA_FINDINGS.md`](../docs/DATA_FINDINGS.md)

`build/` เป็นผลลัพธ์ที่สร้างใหม่ได้เสมอ จึงไม่ถูก commit เข้า git
