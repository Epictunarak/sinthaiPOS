-- 007_pos_extensions.sql
-- ต่อยอดจาก Phase 1 (001-006) เพื่อรองรับการขายหน้าร้าน (POS)
--
-- หลักการ: migration นี้ "เพิ่มอย่างเดียว ไม่ลบไม่แก้ของเดิม" (additive only)
-- รันซ้ำได้ปลอดภัย (idempotent) — ใช้ IF NOT EXISTS ทุกจุด
--
-- อ้างอิงสิ่งที่ Phase 1 มีอยู่แล้ว:
--   sinthai.products(product_id, sku_code, barcode, brand, product_name, ...)
--   sinthai.find_product_by_barcode(text)
--   sinthai.record_stock_movement(sku_code, movement_type, qty, note)
--   sinthai.stock_on_hand_view(sku_code, ...)
--
-- หมายเหตุ: Phase 1 มีตารางราคาผู้ขายอยู่แล้ว แต่ไฟล์นี้สร้างตารางใหม่ชื่อ
-- vendor_price_research แยกออกมา เพื่อไม่ชนกับของเดิมที่ผมยังไม่เห็น schema จริง
-- ถ้าตารางเดิมครอบคลุมอยู่แล้ว ให้ย้ายข้อมูลแล้วลบตารางนี้ทิ้งได้

begin;

-- ---------------------------------------------------------------------------
-- 1. คอลัมน์ที่ POS ต้องใช้ แต่ Phase 1 ยังไม่มี
-- ---------------------------------------------------------------------------
alter table sinthai.products
    add column if not exists category            text,
    add column if not exists subcategory         text,
    add column if not exists pack_size           numeric(12, 3),
    add column if not exists pack_size_unit      text,
    -- จำนวนชิ้นต่อแพ็ค เช่น ลัง 24 กระป๋อง = 24
    -- จำเป็นมากสำหรับร้านค้าส่ง เพราะราคาซัพพลายเออร์บางเจ้าให้มาเป็นราคาต่อชิ้น
    add column if not exists pack_qty            integer not null default 1,
    add column if not exists cost_price          numeric(12, 2),
    add column if not exists retail_price        numeric(12, 2),
    add column if not exists wholesale_price     numeric(12, 2),
    add column if not exists wholesale_min_qty   integer not null default 1,
    add column if not exists reorder_point       integer not null default 0,
    add column if not exists is_active           boolean not null default true,
    -- ธงบอกปัญหาคุณภาพข้อมูล เช่น barcode_missing, no_supplier_price
    add column if not exists data_flags          text,
    add column if not exists updated_at          timestamptz not null default now();

-- Postgres ไม่มี "add constraint if not exists" จึงต้องเช็กเองก่อน
-- ไม่งั้นรัน migration ซ้ำรอบสองจะ error ว่า constraint ซ้ำ
do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'sinthai.products'::regclass
          and conname  = 'products_pack_qty_positive'
    ) then
        alter table sinthai.products
            add constraint products_pack_qty_positive check (pack_qty > 0) not valid;
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'sinthai.products'::regclass
          and conname  = 'products_prices_non_negative'
    ) then
        alter table sinthai.products
            add constraint products_prices_non_negative
            check (
                (cost_price      is null or cost_price      >= 0) and
                (retail_price    is null or retail_price    >= 0) and
                (wholesale_price is null or wholesale_price >= 0)
            ) not valid;
    end if;
end $$;

create index if not exists products_category_idx on sinthai.products (category, subcategory);
create index if not exists products_brand_idx    on sinthai.products (brand);
create index if not exists products_active_idx   on sinthai.products (is_active) where is_active;

-- ---------------------------------------------------------------------------
-- 2. ราคาผู้ขาย พร้อม "บทบาท" ของผู้ขาย
--
--    นี่คือส่วนที่ workbook เดิมขาดไป: Makro / Lotus / BigC ถูกนับเป็น vendor
--    เหมือนกันหมด ทั้งที่ Makro คือแหล่งซื้อ (= ต้นทุนเรา) ส่วน Lotus / BigC
--    คือร้านคู่แข่ง (= เพดานราคาขายเรา) ถ้าไม่แยกบทบาท จะคำนวณกำไรไม่ได้เลย
-- ---------------------------------------------------------------------------
create table if not exists sinthai.vendor_price_research (
    vendor_price_id bigint generated always as identity primary key,
    sku_code        text        not null,
    vendor          text        not null,
    -- supplier   = ร้านที่เราไปซื้อของมาขาย (Makro)
    -- competitor = ร้านที่ขายชนกับเรา (Lotus, BigC)
    vendor_role     text        not null check (vendor_role in ('supplier', 'competitor')),
    price           numeric(12, 2) not null check (price >= 0),
    -- pack = ราคาต่อแพ็ค/ลัง | unit = ราคาต่อชิ้นเดี่ยว (ต้องคูณ pack_qty ก่อนเทียบ)
    price_basis     text        not null check (price_basis in ('pack', 'unit')),
    -- verified   = เปิดหน้าสินค้าตรงรุ่นตรงขนาดแล้ว
    -- comparable = ขนาดไม่ตรงเป๊ะ ใช้รุ่นใกล้เคียงแทน
    -- listing    = เจอแค่หน้า search / หน้าแบรนด์ ยังไม่ยืนยันรุ่น
    confidence      text        not null check (confidence in ('verified', 'comparable', 'listing')),
    checked_date    date        not null,
    source_url      text,
    note            text,
    created_at      timestamptz not null default now(),
    constraint vendor_price_research_unique unique (sku_code, vendor, checked_date)
);

create index if not exists vendor_price_research_sku_idx
    on sinthai.vendor_price_research (sku_code);

-- ---------------------------------------------------------------------------
-- 3. View: ราคาปรับให้เป็นหน่วยเดียวกัน (ต่อแพ็ค) เพื่อเทียบกันได้จริง
-- ---------------------------------------------------------------------------
create or replace view sinthai.vendor_price_pack_equivalent_view as
select
    v.sku_code,
    v.vendor,
    v.vendor_role,
    v.price                        as raw_price,
    v.price_basis,
    case when v.price_basis = 'unit'
         then v.price * p.pack_qty
         else v.price
    end                            as pack_equivalent_price,
    v.confidence,
    v.checked_date,
    v.source_url
from sinthai.vendor_price_research v
join sinthai.products p on p.sku_code = v.sku_code;

-- ---------------------------------------------------------------------------
-- 4. View: สุขภาพราคาต่อสินค้า — ตัวเดียวกับที่ scripts/build_catalog.py คำนวณ
--    มีทั้งสองที่เพราะ: สคริปต์ใช้ตอนยังไม่มี DB / view ใช้ตอนระบบรันจริง
-- ---------------------------------------------------------------------------
create or replace view sinthai.product_margin_view as
with pack_prices as (
    select * from sinthai.vendor_price_pack_equivalent_view
),
supplier_cost as (
    select sku_code, min(pack_equivalent_price) as cost_price
    from pack_prices where vendor_role = 'supplier'
    group by sku_code
),
competitor_floor as (
    select sku_code, min(pack_equivalent_price) as competitor_min_price
    from pack_prices where vendor_role = 'competitor'
    group by sku_code
)
select
    p.sku_code,
    p.brand,
    p.product_name,
    p.category,
    p.pack_qty,
    s.cost_price,
    p.retail_price,
    c.competitor_min_price,
    p.retail_price - s.cost_price                                   as margin,
    case when s.cost_price > 0
         then round((p.retail_price - s.cost_price) / s.cost_price, 4)
    end                                                             as margin_pct,
    case
        when s.cost_price is null                    then 'no_supplier_price'
        when p.retail_price < s.cost_price           then 'selling_below_cost'
        when (p.retail_price - s.cost_price) / s.cost_price < 0.05 then 'thin_margin'
        else 'ok'
    end                                                             as price_status
from sinthai.products p
left join supplier_cost    s on s.sku_code = p.sku_code
left join competitor_floor c on c.sku_code = p.sku_code
where p.is_active;

comment on view sinthai.product_margin_view is
    'สุขภาพราคาต่อ SKU: ต้นทุนจาก supplier, เพดานจาก competitor, และสถานะกำไร';

commit;
