#!/usr/bin/env python3
"""
build_catalog.py — แปลงข้อมูลวิจัยราคา (data/*.csv) ให้เป็นแคตตาล็อกพร้อมใช้ + รายงานสุขภาพราคา

ทำไมต้องมีสคริปต์นี้แทนที่จะพิมพ์ต้นทุน/กำไรลง CSV ตรงๆ:
ต้นทุนและกำไรเป็น "ค่าที่คำนวณได้" จากราคาซัพพลายเออร์ ถ้าพิมพ์มือไว้จะหลุดจากที่มาทันที
ที่ราคา Makro เปลี่ยน สคริปต์นี้ทำให้ตัวเลขทุกตัวย้อนกลับไปหาแหล่งอ้างอิงได้เสมอ

แนวคิดสำคัญ — แยกบทบาทผู้ขาย:
  Makro      = supplier  → ราคาที่ร้าน "ซื้อเข้า" = ต้นทุน
  Lotus/BigC = competitor → ราคาที่ลูกค้า "เทียบได้" = เพดานราคาขาย
workbook เดิมจัดสามเจ้านี้เป็น vendor เหมือนกันหมด ทำให้อ่านกำไรไม่ออก

การใช้งาน:
    python3 scripts/build_catalog.py                 # แสดงรายงานอย่างเดียว
    python3 scripts/build_catalog.py --write         # เขียนไฟล์ผลลัพธ์ลง build/
"""

import argparse
import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
BUILD = ROOT / "build"

# เป้าหมายกำไรขั้นต้น (ปรับได้ตามนโยบายร้าน)
TARGET_RETAIL_MARGIN = 0.12      # ขายปลีก 12%
TARGET_WHOLESALE_MARGIN = 0.06   # ขายส่ง 6%
# ขายปลีกควรถูกกว่าคู่แข่งเล็กน้อยเพื่อให้ลูกค้าเลือกเรา
COMPETITOR_UNDERCUT = 0.98
# ต่ำกว่านี้ถือว่ากำไรบางจนน่ากังวล
THIN_MARGIN_PCT = 0.05


def read_csv(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def to_float(value):
    value = (value or "").strip()
    return float(value) if value else None


def pack_equivalent(price, basis, pack_qty):
    """แปลงราคาให้เป็นหน่วยเดียวกันคือ 'ต่อแพ็ค' ก่อนนำไปเทียบกัน

    workbook เดิมกรอกราคา SKU0001/SKU0002 เป็นราคาต่อชิ้น แต่ราคาขายเป็นราคาต่อลัง
    ถ้าไม่แปลงตรงนี้ กำไรจะเพี้ยนมหาศาล (เช่น Coke ลัง 24 จะดูเหมือนกำไร 2,100%)
    """
    if price is None:
        return None
    return price * pack_qty if basis == "unit" else price


def build():
    products = read_csv(DATA / "products_master.csv")
    vendor_rows = read_csv(DATA / "vendor_prices.csv")

    prices_by_sku = {}
    for row in vendor_rows:
        prices_by_sku.setdefault(row["sku_code"], []).append(row)

    catalog = []
    for p in products:
        sku = p["sku_code"]
        pack_qty = int(p["pack_qty"])
        retail = to_float(p["retail_price"])
        rows = prices_by_sku.get(sku, [])

        supplier_prices, competitor_prices = [], []
        for r in rows:
            # ราคาที่ติดมากับเทมเพลตไม่ใช่ราคาที่สำรวจจริง เอามาคิดต้นทุนไม่ได้
            # (ชีตติดสถานะ Verified ไว้ ทั้งที่หมายเหตุบอกเองว่าเป็นค่าตัวอย่าง)
            if r["confidence"] == "template_sample":
                continue
            eq = pack_equivalent(to_float(r["price"]), r["price_basis"], pack_qty)
            if eq is None:
                continue
            entry = {"vendor": r["vendor"], "price": eq, "confidence": r["confidence"]}
            (supplier_prices if r["vendor_role"] == "supplier" else competitor_prices).append(entry)

        cost = min((s["price"] for s in supplier_prices), default=None)
        cost_vendor = next((s["vendor"] for s in supplier_prices if s["price"] == cost), "")
        cost_confidence = next((s["confidence"] for s in supplier_prices if s["price"] == cost), "")
        competitor_min = min((c["price"] for c in competitor_prices), default=None)

        # ใช้ตั้งราคาได้เฉพาะราคาคู่แข่งที่ยืนยันว่าเป็นสินค้ารุ่นเดียวขนาดเดียวกันจริง
        # ราคา comparable มักเป็นคนละขนาดบรรจุ (เคสจริง: BigC เค้ก 144 ก. ราคา 42
        # ถูกเอาไปเทียบกับแพ็ค 17 ก. x12 = 204 ก. ซึ่งคิดต่อกรัมแล้ว Makro ถูกกว่า)
        # ถ้าปล่อยให้ราคาแบบนั้นมากำหนดเพดาน ระบบจะแนะนำให้ "เปลี่ยนแหล่งซื้อ" ผิดๆ
        competitor_ceiling = min(
            (c["price"] for c in competitor_prices if c["confidence"] == "verified"),
            default=None,
        )

        issues = [f for f in (p["data_flags"] or "").split(";") if f]
        margin = margin_pct = suggested_retail = suggested_wholesale = None

        if cost is not None and retail is None:
            # รู้ต้นทุนแต่ยังไม่ได้ตั้งราคาขาย — เสนอราคาให้ แต่คำนวณกำไรไม่ได้
            suggested_retail = round(cost * (1 + TARGET_RETAIL_MARGIN))
            suggested_wholesale = round(cost * (1 + TARGET_WHOLESALE_MARGIN))
        elif cost is not None:
            margin = retail - cost
            margin_pct = margin / cost
            if margin < 0:
                issues.append("SELLING_BELOW_COST")
            elif margin_pct < THIN_MARGIN_PCT:
                issues.append("thin_margin")

            suggested_retail = round(cost * (1 + TARGET_RETAIL_MARGIN))
            if competitor_ceiling is not None:
                ceiling = competitor_ceiling * COMPETITOR_UNDERCUT
                if ceiling < cost:
                    # คู่แข่งขายถูกกว่าต้นทุนเรา — สู้ราคาตรงๆ ไม่ได้
                    issues.append("cannot_beat_competitor_price")
                    suggested_retail = None
                else:
                    suggested_retail = round(min(suggested_retail, ceiling))
            elif competitor_min is not None:
                # มีแต่ราคาคู่แข่งแบบไม่ตรงรุ่น — ใช้ตัดสินใจไม่ได้ ต้องไปตรวจของจริง
                issues.append("competitor_price_not_comparable")
            suggested_wholesale = round(cost * (1 + TARGET_WHOLESALE_MARGIN))
        else:
            issues.append("NO_SUPPLIER_PRICE")

        catalog.append({
            "sku_code": sku,
            "barcode": p["barcode"],
            "brand": p["brand"],
            "product_name": p["product_name"],
            "category": p["category"],
            "subcategory": p["subcategory"],
            "pack_qty": pack_qty,
            "unit": p["pack_size_unit"],
            "cost_price": cost,
            "cost_vendor": cost_vendor,
            "cost_confidence": cost_confidence,
            "retail_price": retail,
            "competitor_min_price": competitor_min,
            "margin": margin,
            "margin_pct": margin_pct,
            "suggested_retail_price": suggested_retail,
            "suggested_wholesale_price": suggested_wholesale,
            "issues": ";".join(sorted(set(issues))),
        })
    return catalog


def money(v):
    return "-" if v is None else f"{v:,.2f}"


def report(catalog):
    print("=" * 96)
    print("รายงานสุขภาพราคา (Price Health Report) — sinthaiPOS")
    print("=" * 96)
    print(f"{'SKU':9}{'สินค้า':46}{'ทุน':>9}{'ขาย':>9}{'กำไร%':>9}  สถานะ")
    print("-" * 96)
    for c in sorted(catalog, key=lambda x: (x["margin_pct"] is None, x["margin_pct"] or 0)):
        name = c["product_name"][:44]
        pct = "-" if c["margin_pct"] is None else f"{c['margin_pct']*100:.1f}%"
        if "SELLING_BELOW_COST" in c["issues"]:
            status = "ขายต่ำกว่าทุน"
        elif "NO_SUPPLIER_PRICE" in c["issues"]:
            status = "ยังไม่รู้ต้นทุน"
        elif "thin_margin" in c["issues"]:
            status = "กำไรบาง"
        else:
            status = "ปกติ"
        print(f"{c['sku_code']:9}{name:46}{money(c['cost_price']):>9}"
              f"{money(c['retail_price']):>9}{pct:>9}  {status}")

    below = [c for c in catalog if "SELLING_BELOW_COST" in c["issues"]]
    nocost = [c for c in catalog if "NO_SUPPLIER_PRICE" in c["issues"]]
    thin = [c for c in catalog if "thin_margin" in c["issues"]]
    nobarcode = [c for c in catalog if not c["barcode"]]

    print("\n" + "=" * 96)
    print("สรุปสิ่งที่ต้องทำ")
    print("=" * 96)
    print(f"  ขายต่ำกว่าทุน (แก้ด่วน)      : {len(below):>3} รายการ  {', '.join(c['sku_code'] for c in below)}")
    print(f"  ยังไม่มีราคาซัพพลายเออร์      : {len(nocost):>3} รายการ  {', '.join(c['sku_code'] for c in nocost)}")
    print(f"  กำไรบางกว่า {THIN_MARGIN_PCT:.0%}            : {len(thin):>3} รายการ  {', '.join(c['sku_code'] for c in thin)}")
    print(f"  ไม่มีบาร์โค้ด (สแกนขายไม่ได้) : {len(nobarcode):>3} รายการ")

    if below:
        print("\n  ราคาที่แนะนำสำหรับรายการที่ขายต่ำกว่าทุน:")
        for c in below:
            sug = c["suggested_retail_price"]
            if sug is None:
                print(f"    {c['sku_code']}  ทุน {money(c['cost_price'])}  ขายอยู่ {money(c['retail_price'])}"
                      f"  → คู่แข่งขายถูกกว่าทุนเรา ({money(c['competitor_min_price'])}) ต้องหาแหล่งซื้อใหม่")
            else:
                print(f"    {c['sku_code']}  ทุน {money(c['cost_price'])}  ขายอยู่ {money(c['retail_price'])}"
                      f"  → ควรขาย {money(sug)}")


def write_outputs(catalog):
    BUILD.mkdir(exist_ok=True)

    out = BUILD / "catalog_priced.csv"
    with open(out, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(catalog[0].keys()))
        w.writeheader()
        w.writerows(catalog)
    print(f"\nเขียนแล้ว: {out.relative_to(ROOT)}")

    # แผ่น Products สำหรับ Google Sheet — "สร้างจาก" ข้อมูลต้นทาง ไม่ใช่พิมพ์มือ
    # เพื่อไม่ให้เกิดฐานข้อมูลหลักสองชุดที่ค่อยๆ เพี้ยนออกจากกัน
    sheet = BUILD / "sheet_products.csv"
    with open(sheet, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["SKU", "Barcode", "Name", "Category", "Unit", "Cost",
                    "RetailPrice", "WholesalePrice", "WholesaleMinQty",
                    "StockQty", "ReorderPoint", "Active"])
        for c in catalog:
            w.writerow([
                c["sku_code"], c["barcode"], c["product_name"], c["category"],
                f'แพ็ค {c["pack_qty"]}' if c["pack_qty"] > 1 else c["unit"],
                "" if c["cost_price"] is None else f'{c["cost_price"]:.2f}',
                "" if c["retail_price"] is None else f'{c["retail_price"]:.2f}',
                "" if c["suggested_wholesale_price"] is None else c["suggested_wholesale_price"],
                5,
                0,   # ยอดคงเหลือเริ่มต้น — ต้องตรวจนับของจริงก่อนเปิดใช้
                3,   # จุดสั่งซื้อเริ่มต้น
                "TRUE",
            ])
    print(f"เขียนแล้ว: {sheet.relative_to(ROOT)}  (วางทับแผ่น Products ใน Google Sheet)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="เขียนผลลัพธ์ลงโฟลเดอร์ build/")
    args = ap.parse_args()

    catalog = build()
    report(catalog)
    if args.write:
        write_outputs(catalog)

    # ให้ CI จับได้ถ้ามีสินค้าขายต่ำกว่าทุน
    return 1 if any("SELLING_BELOW_COST" in c["issues"] for c in catalog) else 0


if __name__ == "__main__":
    sys.exit(main())
