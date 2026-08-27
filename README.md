# sinthaiPOS

ระบบหลังบ้าน POS สำหรับร้านค้าปลีก/ส่งขนาดเล็ก (สต็อกสินค้า ~350 รายการ) ออกแบบให้:

- **ใช้งานได้ทั้งมือถือ iOS และโน้ตบุ๊ก Windows** ผ่านเบราว์เซอร์ ในรูปแบบ PWA (ติดตั้งเป็นแอปได้
  จากปุ่ม "Add to Home Screen" บน iOS Safari หรือ "Install" บน Chrome/Edge) ไม่ต้องผ่าน App Store
- **ใช้ Google Sheets เดิมของร้านเป็นฐานข้อมูลหลัก** ไม่ต้อง migrate ข้อมูลสินค้า 350 รายการไปที่ไหน
- **ต้นทุนต่ำที่สุด (ฟรี)** — Apps Script + GitHub Pages ล้วนอยู่ใน free tier

อ่านรายละเอียดสถาปัตยกรรมแบบเต็มได้ที่ [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## โครงสร้างโปรเจกต์

```
data/          ★ ต้นทางข้อมูลจริง (CSV ที่คนแก้ด้วยมือ) — ทุกอย่างสร้างจากที่นี่
sql/           Migration ต่อยอด Phase 1 PostgreSQL (007+)
scripts/       build_catalog.py — คำนวณต้นทุน/กำไร + สร้างไฟล์นำเข้า
tests/         เทสต์ SQL migration และการนำเข้าข้อมูลบน PostgreSQL จริง
apps-script/   Backend API (Google Apps Script ผูกกับ Google Sheet) — deploy ด้วย clasp
web/           PWA frontend (Vite + vanilla JS) — หน้าขาย/สต็อก/รายงาน
docs/          เอกสารสถาปัตยกรรม, โครงสร้าง Sheet, และผลตรวจข้อมูล
```

> **อ่านก่อนเริ่ม:** [`docs/DATA_FINDINGS.md`](docs/DATA_FINDINGS.md) — สรุปสิ่งที่พบจาก
> ข้อมูลราคาจริง รวมถึง **สินค้า 3 รายการที่กำลังขายต่ำกว่าทุน**

## ฐานข้อมูลหลักคือ PostgreSQL

`data/*.csv` คือต้นทาง → สร้างเป็นทั้งฐานข้อมูล PostgreSQL (Phase 1) และแผ่น Products
ใน Google Sheet ที่ POS ใช้ **ไม่แก้ข้อมูลสินค้าใน Google Sheet โดยตรง** เพราะจะถูกเขียนทับ
เหตุผลเต็มอยู่ใน [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

```bash
# ดูรายงานสุขภาพราคา (ต้นทุน / กำไร / รายการที่ขาดทุน)
python3 scripts/build_catalog.py

# สร้างไฟล์นำเข้า → build/catalog_priced.csv และ build/sheet_products.csv
python3 scripts/build_catalog.py --write

# นำเข้าฐานข้อมูล PostgreSQL (ต่อจาก 001-006 ของ Phase 1)
psql -U postgres -d sinthai -f sql/007_pos_extensions.sql
psql -U postgres -d sinthai \
  -v products_csv=/absolute/path/to/data/products_master.csv \
  -v vendor_csv=/absolute/path/to/data/vendor_prices.csv \
  -f sql/008_seed_pos_catalog.sql

# ทดสอบ migration + การนำเข้า (ต้องมี PostgreSQL ในเครื่อง)
./tests/run_sql_tests.sh
```

## เริ่มต้นใช้งาน (ครั้งแรก)

### 1. ตั้งค่า Backend (Google Sheet + Apps Script)
ทำตาม [`apps-script/README.md`](apps-script/README.md) ทีละขั้น — จะได้ URL ของ Web App
และ API token มาใช้ในขั้นถัดไป

### 2. รัน PWA บนเครื่องตัวเอง (dev)
```bash
cd web
npm install
cp .env.example .env
# แก้ web/.env ใส่ VITE_API_BASE_URL และ VITE_API_TOKEN ที่ได้จากขั้นตอนที่ 1
npm run dev
```
เปิด `http://localhost:5173` — ล็อกอินด้วย PIN ของพนักงานที่สร้างไว้ในชีต `Staff`

### 3. Deploy PWA ขึ้น GitHub Pages (ใช้งานจริงบนมือถือ/โน้ตบุ๊ก)
1. ใน GitHub repo: **Settings > Pages > Build and deployment > Source: GitHub Actions**
2. ใน **Settings > Secrets and variables > Actions** เพิ่ม repository secrets:
   - `VITE_API_BASE_URL`
   - `VITE_API_TOKEN`
3. Merge โค้ดเข้า branch `main` — workflow `.github/workflows/deploy-pages.yml` จะ build และ
   deploy ให้อัตโนมัติ ได้ลิงก์ `https://<username>.github.io/sinthaiPOS/`
4. เปิดลิงก์นั้นบน iPhone (Safari) แล้วกด แชร์ > "เพิ่มไปยังหน้าจอโฮม" หรือบน Windows (Chrome/Edge)
   กดไอคอน "ติดตั้ง" ที่แถบ URL — จะได้แอปแยกไอคอนเหมือนแอปทั่วไป

> หากไม่ได้ deploy ที่ path `/sinthaiPOS/` (เช่นใช้ custom domain หรือ Cloudflare Pages แทน)
> ให้ตั้งค่า env `VITE_BASE_PATH=/` ตอน build (ดู `web/vite.config.js`)

## การใช้งานประจำวัน

- **แก้ไขสินค้า / เพิ่มสินค้าใหม่ / แก้ราคา** — แก้ที่ `data/products_master.csv` แล้วรัน
  `python3 scripts/build_catalog.py --write` จากนั้นวาง `build/sheet_products.csv` ทับแผ่น
  `Products` ในชีต ระบบ POS จะดึงค่าล่าสุดทุกครั้งที่เปิดแอป (และ cache ไว้ใช้ตอนออฟไลน์)
  > อย่าแก้แผ่น `Products` ในชีตโดยตรง — จะถูกเขียนทับรอบถัดไป และทำให้ต้นทุน/กำไร
  > หลุดจากราคาซัพพลายเออร์ที่บันทึกไว้
- **บันทึกราคาซัพพลายเออร์/คู่แข่งที่สำรวจได้** — เพิ่มแถวใน `data/vendor_prices.csv`
  พร้อมระบุ `vendor_role` และ URL อ้างอิง ต้นทุนกับกำไรจะคำนวณใหม่ให้เอง
- **ขายของตอนเน็ตหลุด** — ระบบยังกดขายได้ปกติ บิลจะถูกเก็บไว้ในเครื่อง (IndexedDB) แล้ว sync
  อัตโนมัติเมื่อเน็ตกลับมา
- **ดูยอดขายรายวัน / สินค้าใกล้หมด** — ในแอป ไปที่แท็บ "รายงาน" และ "สต็อก"

## Roadmap (ยังไม่ทำในรอบนี้)
ดูหัวข้อ "แผนขยายในอนาคต" ใน [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
