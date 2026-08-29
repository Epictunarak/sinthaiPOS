-- 008_seed_pos_catalog.sql
-- นำเข้าแคตตาล็อกสินค้าจริง + ราคาผู้ขาย จาก data/*.csv เข้าสู่ Phase 1 database
--
-- รันด้วย (จากโฟลเดอร์ราก repo):
--   psql -U postgres -d sinthai \
--     -v products_csv=data/products_master.csv \
--     -v vendor_csv=data/vendor_prices.csv \
--     -f sql/008_seed_pos_catalog.sql
--
-- *** ต้องใส่ path แบบเต็ม (absolute path) ***
-- ไฟล์นี้ใช้ COPY ฝั่ง server (แบบเดียวกับ 003_load_csv.sql ของ Phase 1)
-- เพราะ \copy ฝั่ง client ของ psql ไม่ขยายตัวแปร :'var' ให้ (เป็นข้อจำกัดของ psql เอง)
-- ผลที่ตามมา: ตัวฐานข้อมูลต้องอ่านไฟล์นั้นได้เอง และผู้รันต้องเป็น superuser
-- หรืออยู่ในกลุ่ม pg_read_server_files ซึ่งตรงกับที่ Phase 1 รัน psql -U postgres
-- บนเครื่องเดียวกันอยู่แล้ว
--
-- ถ้าย้ายฐานข้อมูลไปอยู่คนละเครื่อง (เช่น Supabase) COPY แบบนี้จะใช้ไม่ได้
-- ให้เปลี่ยนไปนำเข้าผ่าน scripts/build_catalog.py หรือแก้เป็น \copy พร้อมพิมพ์ path ตรงๆ
--
-- รันซ้ำได้ปลอดภัย: products ใช้ upsert ตาม sku_code,
-- vendor_price_research ใช้ on conflict ตาม (sku_code, vendor, checked_date)

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- 1. โหลด CSV เข้า staging ชั่วคราว (หายไปเองเมื่อจบ session)
-- ---------------------------------------------------------------------------
-- ลำดับคอลัมน์ต้องตรงกับ data/products_master.csv ที่ scripts/import_from_sheet.py สร้าง
create temporary table stg_products (
    sku_code        text,
    legacy_sku_code text,
    barcode         text,
    brand           text,
    product_name    text,
    category        text,
    subcategory     text,
    pack_size       numeric,
    pack_size_unit  text,
    pack_qty        integer,
    retail_price    numeric,
    active          text,
    data_flags      text
) on commit drop;

create temporary table stg_vendor_prices (
    sku_code     text,
    vendor       text,
    vendor_role  text,
    price        numeric,
    price_basis  text,
    confidence   text,
    checked_date date,
    source_url   text,
    note         text
) on commit drop;

copy stg_products      from :'products_csv' with (format csv, header true);
copy stg_vendor_prices from :'vendor_csv'   with (format csv, header true);

-- ---------------------------------------------------------------------------
-- 2. Upsert สินค้า
--    barcode ว่างใน CSV ต้องเก็บเป็น NULL ไม่ใช่ '' ไม่งั้น unique index
--    จะมองว่าสินค้าหลายตัวมีบาร์โค้ดซ้ำกัน (คือ '') แล้ว insert ไม่ผ่าน
-- ---------------------------------------------------------------------------
insert into sinthai.products as p (
    sku_code, legacy_sku_code, barcode, brand, product_name,
    category, subcategory, pack_size, pack_size_unit, pack_qty,
    retail_price, is_active, data_flags, updated_at
)
select
    s.sku_code,
    nullif(trim(s.legacy_sku_code), ''),
    nullif(trim(s.barcode), ''),
    s.brand,
    s.product_name,
    s.category,
    s.subcategory,
    s.pack_size,
    s.pack_size_unit,
    coalesce(s.pack_qty, 1),
    s.retail_price,
    upper(coalesce(s.active, 'TRUE')) = 'TRUE',
    nullif(trim(s.data_flags), ''),
    now()
from stg_products s
on conflict (sku_code) do update set
    legacy_sku_code = excluded.legacy_sku_code,
    barcode        = excluded.barcode,
    brand          = excluded.brand,
    product_name   = excluded.product_name,
    category       = excluded.category,
    subcategory    = excluded.subcategory,
    pack_size      = excluded.pack_size,
    pack_size_unit = excluded.pack_size_unit,
    pack_qty       = excluded.pack_qty,
    retail_price   = excluded.retail_price,
    is_active      = excluded.is_active,
    data_flags     = excluded.data_flags,
    updated_at     = now();

-- ---------------------------------------------------------------------------
-- 3. โหลดราคาผู้ขาย (เก็บทุกครั้งที่เช็ก เพื่อดูแนวโน้มราคาย้อนหลังได้)
-- ---------------------------------------------------------------------------
insert into sinthai.vendor_price_research (
    sku_code, vendor, vendor_role, price, price_basis,
    confidence, checked_date, source_url, note
)
select
    v.sku_code, v.vendor, v.vendor_role, v.price, v.price_basis,
    v.confidence, v.checked_date,
    nullif(trim(v.source_url), ''),
    nullif(trim(v.note), '')
from stg_vendor_prices v
where exists (select 1 from sinthai.products p where p.sku_code = v.sku_code)
on conflict (sku_code, vendor, checked_date) do update set
    vendor_role = excluded.vendor_role,
    price       = excluded.price,
    price_basis = excluded.price_basis,
    confidence  = excluded.confidence,
    source_url  = excluded.source_url,
    note        = excluded.note;

-- ---------------------------------------------------------------------------
-- 4. คำนวณต้นทุนจากราคาซัพพลายเออร์ที่ถูกที่สุด (ปรับเป็นราคาต่อแพ็คแล้ว)
--    ต้นทุนไม่ใช่ค่าที่พิมพ์มือ แต่เป็นผลจากราคาที่บันทึกไว้ — ที่มาตรวจสอบได้เสมอ
-- ---------------------------------------------------------------------------
update sinthai.products p
set cost_price = c.cost_price,
    updated_at = now()
from (
    select sku_code, min(pack_equivalent_price) as cost_price
    from sinthai.vendor_price_pack_equivalent_view
    where vendor_role = 'supplier'
      -- ราคาตัวอย่างที่ติดมากับเทมเพลตไม่ใช่ต้นทุนจริง (ดู 009)
      and confidence <> 'template_sample'
    group by sku_code
) c
where c.sku_code = p.sku_code;

-- ---------------------------------------------------------------------------
-- 5. ราคาขายส่งเริ่มต้น = ต้นทุน + 6% (นโยบายตั้งต้น ปรับได้ภายหลัง)
--    เขียนเฉพาะรายการที่ยังไม่เคยตั้งราคาส่งไว้ เพื่อไม่ทับราคาที่เจ้าของร้านตั้งเอง
-- ---------------------------------------------------------------------------
update sinthai.products
set wholesale_price   = round(cost_price * 1.06, 2),
    wholesale_min_qty = 5,
    updated_at        = now()
where cost_price is not null
  and wholesale_price is null;

commit;

\echo ''
\echo '--- สรุปผลการนำเข้า ---'
select count(*) as products_loaded from sinthai.products;
select count(*) as vendor_prices_loaded from sinthai.vendor_price_research;
select price_status, count(*) from sinthai.product_margin_view group by price_status order by 2 desc;
