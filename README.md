# sinthaiPOS

ระบบหลังบ้าน POS สำหรับร้านค้าปลีก/ส่งขนาดเล็ก (สต็อกสินค้า ~350 รายการ) ออกแบบให้:

- **ใช้งานได้ทั้งมือถือ iOS และโน้ตบุ๊ก Windows** ผ่านเบราว์เซอร์ ในรูปแบบ PWA (ติดตั้งเป็นแอปได้
  จากปุ่ม "Add to Home Screen" บน iOS Safari หรือ "Install" บน Chrome/Edge) ไม่ต้องผ่าน App Store
- **เจ้าของร้านยังทำงานบน Google Sheet ที่คุ้นเคย** ระบบดึงข้อมูลจากชีตไปเข้าฐานข้อมูล
  PostgreSQL (ต่อยอดจาก Phase 1) ให้เอง ไม่ต้องเปลี่ยนวิธีทำงานเดิม
- **ต้นทุนต่ำที่สุด (ฟรี)** — Apps Script + GitHub Pages ล้วนอยู่ใน free tier
- **เห็นกำไรต่อสินค้าทันที** โดยแยกราคา Makro (ต้นทุน) ออกจากราคา Lotus/BigC (คู่แข่ง)

อ่านรายละเอียดสถาปัตยกรรมแบบเต็มได้ที่ [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## โครงสร้างโปรเจกต์

```
data/          สินค้าและราคาที่นำเข้าจาก Google Sheet (+ สแนปช็อตชีตต้นทาง)
sql/           Migration ต่อยอด Phase 1 PostgreSQL (007+)
scripts/       import_from_sheet.py (ชีต→CSV), build_catalog.py (คำนวณกำไร),
               make_price_worklist.py (ใบงานเก็บราคา Makro)
tests/         เทสต์ SQL migration, การนำเข้าข้อมูล, และ e2e ที่ขับแอปจริงในเบราว์เซอร์
apps-script/   Backend API (Google Apps Script ผูกกับ Google Sheet) — deploy ด้วย clasp
web/           PWA frontend (Vite + vanilla JS) — หน้าขาย/สต็อก/รายงาน
docs/          เอกสารสถาปัตยกรรม, โครงสร้าง Sheet, และผลตรวจข้อมูล
```

> **เริ่มที่นี่:** [`docs/STATUS.md`](docs/STATUS.md) — สรุปว่าทำอะไรไปแล้ว
> และตอนนี้ติดอะไรอยู่
>
> **อ่านต่อ:** [`docs/DATA_FINDINGS.md`](docs/DATA_FINDINGS.md) — สรุปสิ่งที่พบจาก
> ข้อมูลจริง 141 รายการ รวมถึง **สินค้า 6 รายการที่กำลังขายต่ำกว่าทุน** และ
> **130 รายการที่ยังไม่รู้ต้นทุน**

## เส้นทางของข้อมูล

```
Google Sheet "สินไทยพาณิชย์"  ← เจ้าของร้านแก้ที่นี่
        │  import_from_sheet.py
        ▼
   data/*.csv                  ← อยู่ใน git ตรวจ diff ได้
        │  build_catalog.py / sql/008
        ├─────────────► PostgreSQL (sinthai)   ← ฐานข้อมูลหลักของระบบ
        └─────────────► build/sheet_products.csv → แผ่น Products ที่ POS ใช้
```

แก้ข้อมูลสินค้าและราคาที่ **Google Sheet** เท่านั้น ไฟล์ CSV และแผ่น Products เป็นผลลัพธ์
ที่ถูกสร้างใหม่ทุกรอบ เหตุผลเต็มอยู่ใน [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

```bash
# นำเข้าข้อมูลจาก Google Sheet (ดาวน์โหลดชีตเป็น .xlsx ทับ data/source/ ก่อน)
python3 scripts/import_from_sheet.py

# ดูรายงานสุขภาพราคา (ต้นทุน / กำไร / รายการที่ขาดทุน)
python3 scripts/build_catalog.py

# สร้างไฟล์นำเข้า → build/catalog_priced.csv และ build/sheet_products.csv
python3 scripts/build_catalog.py --write

# ใบงานเก็บราคา Makro (พิมพ์พกไปได้) → build/makro_worklist.html
python3 scripts/make_price_worklist.py

# นำเข้าฐานข้อมูล PostgreSQL (ต่อจาก 001-006 ของ Phase 1)
psql -U postgres -d sinthai -f sql/007_pos_extensions.sql
psql -U postgres -d sinthai -f sql/009_template_sample_confidence.sql
psql -U postgres -d sinthai \
  -v products_csv=/absolute/path/to/data/products_master.csv \
  -v vendor_csv=/absolute/path/to/data/vendor_prices.csv \
  -f sql/008_seed_pos_catalog.sql

# ทดสอบ migration + การนำเข้า (ต้องมี PostgreSQL ในเครื่อง)
./tests/run_sql_tests.sh

# ทดสอบตรรกะฝั่งแอป
cd web && npm test

# ทดสอบตรรกะการติดตั้งฝั่ง Apps Script (จำลอง Sheets API ไม่ต้องขึ้น Google)
node --test "tests/apps-script/*.test.mjs"

# ทดสอบโดยขับแอปจริงในเบราว์เซอร์ (ดู tests/e2e/README.md)
node tests/e2e/mock-api.mjs   # แล้วรัน smoke.mjs ตามขั้นตอนในเอกสาร
```

## เริ่มต้นใช้งาน (ครั้งแรก)

### 1. ตั้งค่า Backend (Google Sheet + Apps Script)
ทำตาม [`apps-script/README.md`](apps-script/README.md) ทีละขั้น — จะได้ URL ของ Web App
และ API token มาใช้ในขั้นถัดไป

> ไม่ต้องสร้างชีตและพิมพ์หัวคอลัมน์เอง — รันฟังก์ชัน `setupSheets()` ครั้งเดียวสร้างให้ครบ
> แล้วรัน `checkSetup()` เพื่อให้ระบบบอกว่าอะไรยังขาดก่อนเปิดใช้จริง

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

- **แก้ไขสินค้า / เพิ่มสินค้าใหม่ / แก้ราคา** — แก้ในชีต `SKU Price Comparison` ของ Google Sheet
  แล้วรันขั้นตอน "เส้นทางของข้อมูล" ข้างบนใหม่
- **บันทึกราคาซัพพลายเออร์/คู่แข่งที่สำรวจได้** — เพิ่มแถวในชีต `Reference` พร้อม URL อ้างอิง
  และ Match Type ระบบจะแปลงเป็นระดับความน่าเชื่อถือแล้วคำนวณต้นทุน/กำไรให้เอง
  > เก็บ **ราคา Makro ก่อนเสมอ** เพราะเป็นตัวเดียวที่บอกได้ว่าขายแล้วกำไรหรือขาดทุน
  > ราคา Lotus/BigC บอกได้แค่เพดานราคาขาย
- **อย่าแก้แผ่น `Products` ที่ POS ใช้โดยตรง** — เป็นผลลัพธ์ที่ถูกเขียนทับทุกรอบ
- **ขายของตอนเน็ตหลุด** — ระบบยังกดขายได้ปกติ บิลจะถูกเก็บไว้ในเครื่อง (IndexedDB) แล้ว sync
  อัตโนมัติเมื่อเน็ตกลับมา
- **ตรวจนับสต็อก** — ในแอป ไปที่แท็บ "ตรวจนับ" กรอกจำนวนที่นับได้จริง ระบบคำนวณส่วนต่าง
  และบันทึกไว้ให้ตรวจย้อนหลังได้เอง (ใช้ตอนเปิดร้านครั้งแรกและตอนนับรอบประจำ)
- **เก็บบาร์โค้ดสินค้า** — ในแอป ไปที่แท็บ "เก็บบาร์โค้ด" แล้วเดินยิงทีละตัว
  ระบบตรวจหลักตรวจสอบให้ก่อนบันทึกทุกครั้ง จึงกันการยิงพลาด/พิมพ์ผิดได้
- **พิมพ์ใบเสร็จ** — หลังบันทึกการขาย ใบเสร็จจะขึ้นให้พร้อมปุ่มพิมพ์ (ใช้ได้ทั้งเครื่องพิมพ์
  ใบเสร็จความร้อนและ A4) ตั้งชื่อร้าน/ที่อยู่/ข้อความท้ายบิลได้ในชีต `Settings`
- **ดูว่าต้องซื้ออะไรบ้าง / รับของเข้า** — แท็บ "สั่งซื้อ/รับของ" บอกรายการที่ต่ำกว่าจุดสั่งซื้อ
  พร้อมประมาณการค่าใช้จ่ายจากราคา Makro และให้บันทึกจำนวนที่ซื้อกลับมาเข้าสต็อกได้เลย
- **กดขายผิด** — กดปุ่ม "ยกเลิกบิล" บนใบเสร็จได้ทันที หรือย้อนไปยกเลิกจากรายการบิล
  ในแท็บ "รายงาน" ระบบคืนสินค้าเข้าสต็อกให้เอง และเก็บบิลเดิมไว้ตรวจย้อนหลังได้
- **ดูกำไรรายวัน / สินค้าใกล้หมด** — ในแอป ไปที่แท็บ "รายงาน" และ "สต็อก"
  รายงานบอก **กำไรขั้นต้น** พร้อมเตือนถ้าวันนั้นขายสินค้าต่ำกว่าทุน

## Roadmap (ยังไม่ทำในรอบนี้)
ดูหัวข้อ "แผนขยายในอนาคต" ใน [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
