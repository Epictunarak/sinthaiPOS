-- 009_template_sample_confidence.sql
-- เพิ่มระดับความน่าเชื่อถือ 'template_sample' และกันไม่ให้ถูกใช้คำนวณต้นทุน
--
-- ที่มา: ชีต Reference มีราคาบางแถวที่หมายเหตุระบุว่า
--   "Original sample data retained from template."
-- คือค่าตัวอย่างที่ติดมากับเทมเพลตตั้งแต่แรก ไม่ใช่ราคาที่ไปสำรวจจริง
-- แต่ชีตกลับติดสถานะว่า "Verified" ไว้ ซึ่งขัดกับหมายเหตุของตัวเอง
--
-- กระทบ SKU0001 (Coke ลัง 24) และ SKU0002 (Lay's แพ็ค 6) อย่างละ 3 แถว
-- ถ้านับเป็นต้นทุน จะได้กำไร 2,141% และ 426% ซึ่งเป็นตัวเลขที่ไม่มีความหมาย
--
-- รันซ้ำได้ปลอดภัย

begin;

-- ---------------------------------------------------------------------------
-- 0. เก็บรหัส SKU เดิมที่เขียนไว้ในชีต (เช่น SKU001 ก่อนปรับเป็น SKU0001)
--    พนักงานยังเรียกรหัสเดิมอยู่ ต้องค้นเจอทั้งสองแบบ
-- ---------------------------------------------------------------------------
alter table sinthai.products
    add column if not exists legacy_sku_code text;

create index if not exists products_legacy_sku_idx
    on sinthai.products (legacy_sku_code)
    where legacy_sku_code is not null;

-- ---------------------------------------------------------------------------
-- 1. ขยาย CHECK ให้รับค่าใหม่
-- ---------------------------------------------------------------------------
alter table sinthai.vendor_price_research
    drop constraint if exists vendor_price_research_confidence_check;

alter table sinthai.vendor_price_research
    add constraint vendor_price_research_confidence_check
    check (confidence in ('verified', 'comparable', 'listing', 'template_sample'));

-- ---------------------------------------------------------------------------
-- 2. คำนวณต้นทุนใหม่โดยไม่นับราคาตัวอย่าง
--
--    เพดานราคาจากคู่แข่งก็ใช้เฉพาะราคาที่ยืนยันว่าเป็นสินค้ารุ่นเดียวขนาดเดียวกัน
--    (confidence = 'verified') เพราะราคา comparable มักเป็นคนละขนาดบรรจุ
--    เคสจริง: BigC เค้ก 144 ก. ราคา 42 ถูกนำไปเทียบกับแพ็ค 17 ก. x12 (=204 ก.)
--    ซึ่งคิดต่อกรัมแล้ว Makro ถูกกว่า — ถ้าใช้ตัวเลขนั้นตั้งเพดาน ระบบจะสรุปผิดว่า
--    ร้านสู้ราคาคู่แข่งไม่ได้
-- ---------------------------------------------------------------------------
-- ต้อง drop ก่อน เพราะ create or replace view เพิ่มคอลัมน์ตรงกลางรายการไม่ได้
-- (competitor_ceiling_price ถูกแทรกก่อน margin) ยังไม่มีอะไรอ้างอิง view นี้จึง drop ได้ปลอดภัย
drop view if exists sinthai.product_margin_view;

create view sinthai.product_margin_view as
with pack_prices as (
    select * from sinthai.vendor_price_pack_equivalent_view
    where confidence <> 'template_sample'
),
supplier_cost as (
    select sku_code, min(pack_equivalent_price) as cost_price
    from pack_prices where vendor_role = 'supplier'
    group by sku_code
),
competitor_all as (
    select sku_code, min(pack_equivalent_price) as competitor_min_price
    from pack_prices where vendor_role = 'competitor'
    group by sku_code
),
competitor_verified as (
    select sku_code, min(pack_equivalent_price) as competitor_ceiling_price
    from pack_prices
    where vendor_role = 'competitor' and confidence = 'verified'
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
    cv.competitor_ceiling_price,
    p.retail_price - s.cost_price                                   as margin,
    case when s.cost_price > 0
         then round((p.retail_price - s.cost_price) / s.cost_price, 4)
    end                                                             as margin_pct,
    case
        when s.cost_price   is null                  then 'no_supplier_price'
        when p.retail_price is null                  then 'no_retail_price'
        when p.retail_price < s.cost_price           then 'selling_below_cost'
        when (p.retail_price - s.cost_price) / s.cost_price < 0.05 then 'thin_margin'
        else 'ok'
    end                                                             as price_status
from sinthai.products p
left join supplier_cost       s  on s.sku_code  = p.sku_code
left join competitor_all      c  on c.sku_code  = p.sku_code
left join competitor_verified cv on cv.sku_code = p.sku_code
where p.is_active;

commit;
