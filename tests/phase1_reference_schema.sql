-- phase1_reference_schema.sql
--
-- *** ไฟล์นี้ไม่ใช่ schema จริงของ Phase 1 และไม่ใช่ส่วนหนึ่งของลำดับการรันจริง ***
--
-- นี่คือ "โครงจำลองขั้นต่ำ" ของ Phase 1 ที่สร้างขึ้นจากสิ่งที่สังเกตได้จาก
-- README และสคริปต์ PowerShell ที่ให้มา เพื่อใช้ทดสอบ migration 007+ ในเครื่อง
-- ตอนที่ยังไม่มีไฟล์ sql/001_schema.sql ตัวจริงอยู่ใน repo นี้
--
-- หลักฐานที่ใช้อ้างอิงชื่อคอลัมน์:
--   run_products_preview.ps1 -> select product_id, sku_code, barcode, brand, product_name
--   run_product_count.ps1    -> select count(product_id) from sinthai.products
--   README                   -> find_product_by_barcode / record_stock_movement / stock_on_hand_view
--
-- เมื่อนำ sql/001_schema.sql ตัวจริงเข้ามาใน repo แล้ว ให้ลบไฟล์นี้ทิ้ง
-- แล้วชี้ tests/run_sql_tests.sh ไปที่ไฟล์จริงแทน

create schema if not exists sinthai;
create schema if not exists sinthai_staging;

create table if not exists sinthai.products (
    product_id   bigint generated always as identity primary key,
    sku_code     text not null unique,
    barcode      text,
    brand        text,
    product_name text not null
);

-- บาร์โค้ดที่ไม่ว่างต้องไม่ซ้ำกัน แต่ปล่อยว่างได้ (ตามที่ README ระบุ)
create unique index if not exists products_barcode_unique_idx
    on sinthai.products (barcode)
    where barcode is not null and barcode <> '';

create table if not exists sinthai.stock_movements (
    movement_id   bigint generated always as identity primary key,
    sku_code      text not null references sinthai.products (sku_code),
    movement_type text not null check (movement_type in ('stock_in', 'stock_out', 'adjustment')),
    qty           numeric(14, 3) not null,
    note          text,
    created_at    timestamptz not null default now()
);

create or replace view sinthai.stock_on_hand_view as
select
    p.sku_code,
    p.product_name,
    coalesce(sum(
        case m.movement_type
            when 'stock_in'   then  m.qty
            when 'stock_out'  then -m.qty
            when 'adjustment' then  m.qty
        end
    ), 0) as qty_on_hand
from sinthai.products p
left join sinthai.stock_movements m on m.sku_code = p.sku_code
group by p.sku_code, p.product_name;

create or replace function sinthai.record_stock_movement(
    p_sku_code text,
    p_movement_type text,
    p_qty numeric,
    p_note text default null
) returns bigint language sql as $$
    insert into sinthai.stock_movements (sku_code, movement_type, qty, note)
    values (p_sku_code, p_movement_type, p_qty, p_note)
    returning movement_id;
$$;

create or replace function sinthai.find_product_by_barcode(p_barcode text)
returns setof sinthai.products language sql stable as $$
    select * from sinthai.products where barcode = p_barcode;
$$;
