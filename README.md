# sinthaiPOS

ระบบหลังบ้าน POS สำหรับร้านค้าปลีก/ส่งขนาดเล็ก (สต็อกสินค้า ~350 รายการ) ออกแบบให้:

- **ใช้งานได้ทั้งมือถือ iOS และโน้ตบุ๊ก Windows** ผ่านเบราว์เซอร์ ในรูปแบบ PWA (ติดตั้งเป็นแอปได้
  จากปุ่ม "Add to Home Screen" บน iOS Safari หรือ "Install" บน Chrome/Edge) ไม่ต้องผ่าน App Store
- **ใช้ Google Sheets เดิมของร้านเป็นฐานข้อมูลหลัก** ไม่ต้อง migrate ข้อมูลสินค้า 350 รายการไปที่ไหน
- **ต้นทุนต่ำที่สุด (ฟรี)** — Apps Script + GitHub Pages ล้วนอยู่ใน free tier

อ่านรายละเอียดสถาปัตยกรรมแบบเต็มได้ที่ [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## โครงสร้างโปรเจกต์

```
apps-script/   Backend API (Google Apps Script ผูกกับ Google Sheet) — deploy ด้วย clasp
web/           PWA frontend (Vite + vanilla JS) — หน้าขาย/สต็อก/รายงาน
docs/          เอกสารสถาปัตยกรรม + โครงสร้าง Sheet
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

- **แก้ไขสินค้า / เพิ่มสินค้าใหม่ / แก้ราคา** — แก้ตรงในชีต `Products` ได้เลย ระบบ POS จะดึงค่า
  ล่าสุดทุกครั้งที่เปิดแอป (และ cache ไว้ใช้ตอนออฟไลน์)
- **ขายของตอนเน็ตหลุด** — ระบบยังกดขายได้ปกติ บิลจะถูกเก็บไว้ในเครื่อง (IndexedDB) แล้ว sync
  อัตโนมัติเมื่อเน็ตกลับมา
- **ดูยอดขายรายวัน / สินค้าใกล้หมด** — ในแอป ไปที่แท็บ "รายงาน" และ "สต็อก"

## Roadmap (ยังไม่ทำในรอบนี้)
ดูหัวข้อ "แผนขยายในอนาคต" ใน [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
