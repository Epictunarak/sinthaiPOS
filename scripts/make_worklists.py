#!/usr/bin/env python3
"""
make_worklists.py — สร้างใบงานสำหรับเก็บข้อมูลที่ยังขาด

ข้อมูลของร้านยังมีช่องว่างหลายจุดที่ทำให้ระบบทำงานได้ไม่เต็มที่ ตั้งแต่ระดับ
"ขายไม่ได้เลย" ไปจนถึง "ขายได้แต่ไม่รู้ว่ากำไรหรือขาดทุน" สคริปต์นี้แยกเป็นใบงานตามงาน
ที่ต้องไปทำจริง พร้อมจัดลำดับความสำคัญให้

ใบงานที่สร้าง:
  1. ราคาขายที่ยังไม่มี      — สินค้าเหล่านี้ POS ขายไม่ได้เลย ต้องเติมก่อนอย่างอื่น
  2. ราคา Makro ที่ยังขาด    — ไม่มีก็ไม่รู้ว่าขายแล้วกำไรหรือขาดทุน
  3. ต้นทุนที่ต้องตรวจซ้ำ    — มีราคาแล้วแต่ยังไม่ยืนยันว่าตรงรุ่นตรงขนาด
  4. จำนวนต่อแพ็คที่ระบบเดา  — ถ้าเดาผิด ตัวเลขกำไรจะผิดตามทั้งหมด

เกณฑ์จัดลำดับของใบงานราคา Makro (จากสำคัญมากไปน้อย):

  1. แบรนด์ที่พบแล้วว่ามีสินค้าขายต่ำกว่าทุน
     ยูโร่เป็นตัวอย่างจริง: พอรู้ต้นทุน 5 จาก 8 ตัวก็พบว่าขาดทุนทันที
     อีก 3 ตัวที่เหลือในแบรนด์เดียวกันจึงมีโอกาสสูงมากที่จะขาดทุนเหมือนกัน

  2. กลุ่มที่ตั้งราคาขายเท่ากันหมดตั้งแต่ 3 รายการขึ้นไป
     นี่คือรูปแบบที่ทำให้ยูโร่ขาดทุน — ตั้งราคาเหมา 50 บาททั้งไลน์ ทั้งที่ Makro
     คิดไม่เท่ากัน (51 บ้าง 48 บ้าง) ตัวที่กำไรเลยต้องอุ้มตัวที่ขาดทุน

  3. ราคาขายสูง — ผิดพลาดทีนึงเสียเงินเยอะกว่า

ผลลัพธ์:
  build/makro_worklist.csv    คอลัมน์ตรงกับชีต Reference วางแปะกลับได้เลย
  build/makro_worklist.html   ใบงานเก็บราคา Makro (พิมพ์พกไปได้)
  build/data_gaps.html        ใบงานช่องว่างข้อมูลอื่นๆ ทั้งหมด

การใช้งาน:
    python3 scripts/make_worklists.py
"""

import csv
import html
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
BUILD = ROOT / "build"

FLAT_PRICE_GROUP_MIN = 3


def load_rows(name):
    with open(DATA / name, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def to_float(value):
    value = (value or "").strip()
    return float(value) if value else None


def build_worklist():
    products = load_rows("products_master.csv")
    vendor_prices = load_rows("vendor_prices.csv")

    # SKU ที่รู้ต้นทุนแล้ว (ไม่นับราคาตัวอย่างจากเทมเพลต)
    have_cost = {
        v["sku_code"]: float(v["price"])
        for v in vendor_prices
        if v["vendor_role"] == "supplier" and v["confidence"] != "template_sample"
    }

    # แบรนด์ที่พบสินค้าขายต่ำกว่าทุนแล้ว → ตัวที่เหลือในแบรนด์นั้นน่าสงสัย
    suspect_brands = set()
    by_sku = {p["sku_code"]: p for p in products}
    for sku, cost in have_cost.items():
        product = by_sku.get(sku)
        retail = to_float(product["retail_price"]) if product else None
        if product and retail is not None and retail < cost:
            suspect_brands.add(product["brand"])

    # กลุ่มที่ตั้งราคาเท่ากันหมดหลายรายการ (รูปแบบที่ทำให้ยูโร่ขาดทุน)
    price_groups = Counter(
        (p["brand"], p["retail_price"]) for p in products if p["retail_price"]
    )
    flat_groups = {key for key, count in price_groups.items() if count >= FLAT_PRICE_GROUP_MIN}

    missing = [p for p in products if p["sku_code"] not in have_cost]

    def priority(product):
        if product["brand"] in suspect_brands:
            return 1, "แบรนด์นี้พบสินค้าขายต่ำกว่าทุนแล้ว"
        if (product["brand"], product["retail_price"]) in flat_groups:
            count = price_groups[(product["brand"], product["retail_price"])]
            return 2, f"ตั้งราคาเท่ากัน {count} รายการในแบรนด์นี้"
        return 3, ""

    rows = []
    for product in missing:
        rank, reason = priority(product)
        rows.append({
            "priority": rank,
            "reason": reason,
            "sku_code": product["sku_code"],
            "brand": product["brand"],
            "product_name": product["product_name"],
            "category": product["category"],
            "pack_qty": product["pack_qty"],
            "retail_price": product["retail_price"],
        })

    rows.sort(key=lambda r: (
        r["priority"],
        r["brand"],
        -(to_float(r["retail_price"]) or 0),
        r["sku_code"],
    ))
    return rows, suspect_brands, flat_groups


def write_csv(rows):
    """คอลัมน์ตรงกับชีต Reference เพื่อวางแปะกลับเข้าไปได้ทันทีหลังกรอกราคา"""
    path = BUILD / "makro_worklist.csv"
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "SKU Code", "Brand", "Product Name", "Vendor", "Price",
            "URL / Search Link", "Match Type", "Last Checked", "Status", "Source Note",
        ])
        for row in rows:
            writer.writerow([
                row["sku_code"], row["brand"], row["product_name"], "Makro",
                "",  # ช่องกรอกราคา
                "", "Official product page", date.today().isoformat(),
                "Pending Vendor Price", row["reason"],
            ])
    return path


def write_html(rows, suspect_brands, flat_groups):
    path = BUILD / "makro_worklist.html"
    labels = {
        1: "ด่วนที่สุด — แบรนด์นี้พบสินค้าขายต่ำกว่าทุนแล้ว",
        2: "ควรเก็บ — ตั้งราคาเหมาเท่ากันหลายรายการ",
        3: "เก็บเมื่อมีเวลา",
    }
    grouped = defaultdict(list)
    for row in rows:
        grouped[row["priority"]].append(row)

    parts = [f"""<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<title>ใบงานเก็บราคา Makro</title>
<style>
  body {{ font-family: -apple-system, 'Segoe UI', Sarabun, sans-serif; margin: 24px; color:#111; }}
  h1 {{ font-size: 20px; margin-bottom: 4px; }}
  .sub {{ color:#555; font-size: 13px; margin-bottom: 20px; }}
  h2 {{ font-size: 15px; margin: 22px 0 8px; padding: 6px 10px; background:#eee;
       border-left: 4px solid #0f766e; }}
  table {{ width:100%; border-collapse: collapse; font-size: 12px; }}
  th, td {{ border:1px solid #bbb; padding: 5px 7px; text-align:left; vertical-align: top; }}
  th {{ background:#f4f4f4; }}
  .write {{ width: 90px; background:#fffde7; }}
  .brand {{ white-space: nowrap; }}
  tr {{ page-break-inside: avoid; }}
  @media print {{ body {{ margin: 8mm; }} h2 {{ background:#eee !important;
      -webkit-print-color-adjust: exact; print-color-adjust: exact; }} }}
</style></head><body>
<h1>ใบงานเก็บราคา Makro — sinthaiPOS</h1>
<div class="sub">
  สินค้า {len(rows)} รายการที่ยังไม่รู้ต้นทุน · สร้างเมื่อ {date.today().isoformat()}<br>
  กรอกราคาที่เห็นบนป้าย Makro ลงช่องสีเหลือง แล้วคัดลอกกลับเข้าชีต
  <strong>Reference</strong> (หรือกรอกลง <code>build/makro_worklist.csv</code>)<br>
  <strong>สำคัญ:</strong> ต้องเป็นราคาของ <em>ขนาดบรรจุเดียวกัน</em> เท่านั้น
  ถ้าเจอคนละขนาด ให้จดขนาดที่เห็นไว้ในช่องหมายเหตุด้วย
</div>"""]

    for rank in sorted(grouped):
        parts.append(f"<h2>{html.escape(labels[rank])} ({len(grouped[rank])} รายการ)</h2>")
        parts.append("<table><thead><tr>"
                     "<th>SKU</th><th class='brand'>แบรนด์</th><th>สินค้า</th>"
                     "<th>ต่อแพ็ค</th><th>ราคาขายเรา</th>"
                     "<th class='write'>ราคา Makro</th><th class='write'>หมายเหตุ</th>"
                     "</tr></thead><tbody>")
        for row in grouped[rank]:
            parts.append(
                "<tr>"
                f"<td>{html.escape(row['sku_code'])}</td>"
                f"<td class='brand'>{html.escape(row['brand'])}</td>"
                f"<td>{html.escape(row['product_name'])}</td>"
                f"<td>{html.escape(str(row['pack_qty']))}</td>"
                f"<td>{html.escape(row['retail_price'] or '-')}</td>"
                "<td class='write'></td><td class='write'></td>"
                "</tr>"
            )
        parts.append("</tbody></table>")

    parts.append("</body></html>")
    path.write_text("\n".join(parts), encoding="utf-8")
    return path


def collect_gaps():
    """รวบรวมช่องว่างข้อมูลที่ไม่ใช่เรื่อง "ยังไม่มีราคา Makro" """
    products = load_rows("products_master.csv")
    vendor_prices = load_rows("vendor_prices.csv")

    by_sku = {p["sku_code"]: p for p in products}

    # ต้นทุนที่มีอยู่แล้วแต่ยังไม่ยืนยันว่าตรงรุ่นตรงขนาด — ตัวเลขกำไรที่คิดจากราคาพวกนี้
    # ยังสรุปไม่ได้เต็มปาก เช่น SKU0014 ใช้ราคาของ 250ml มาเทียบกับสินค้า 240ml
    unverified_cost = []
    for row in vendor_prices:
        if row["vendor_role"] != "supplier":
            continue
        if row["confidence"] in ("verified", "template_sample"):
            continue
        product = by_sku.get(row["sku_code"])
        if not product:
            continue
        unverified_cost.append({
            "sku_code": row["sku_code"],
            "product_name": product["product_name"],
            "brand": product["brand"],
            "price": row["price"],
            "confidence": row["confidence"],
            "note": row["note"],
        })
    unverified_cost.sort(key=lambda r: (r["confidence"], r["sku_code"]))

    def flagged(flag):
        return [p for p in products if flag in (p["data_flags"] or "").split(";")]

    return {
        "no_retail_price": sorted(flagged("no_retail_price"), key=lambda p: p["sku_code"]),
        "unverified_cost": unverified_cost,
        "pack_qty_guessed": sorted(flagged("pack_qty_not_in_name"),
                                   key=lambda p: (p["brand"], p["sku_code"])),
    }


def gaps_table(rows, columns, fill_columns):
    """สร้างตาราง HTML พร้อมช่องสีเหลืองไว้กรอกด้วยมือ"""
    head = "".join(f"<th>{html.escape(label)}</th>" for _, label in columns)
    head += "".join(f"<th class='write'>{html.escape(label)}</th>" for label in fill_columns)

    body = []
    for row in rows:
        cells = "".join(
            f"<td>{html.escape(str(row.get(key) or '-'))}</td>" for key, _ in columns
        )
        cells += "".join("<td class='write'></td>" for _ in fill_columns)
        body.append(f"<tr>{cells}</tr>")

    return (f"<table><thead><tr>{head}</tr></thead>"
            f"<tbody>{''.join(body)}</tbody></table>")


def write_gaps_html(gaps):
    path = BUILD / "data_gaps.html"
    sections = []

    sections.append(f"""
<h2>1. ยังไม่มีราคาขาย — POS ขายไม่ได้เลย ({len(gaps['no_retail_price'])} รายการ)</h2>
<p class="note">สินค้าเหล่านี้ไม่มีราคาขายในชีต ระบบจึงคิดเงินไม่ได้ ต้องเติมราคาลงคอลัมน์
<strong>Price</strong> ในชีต <strong>SKU Price Comparison</strong> ก่อนเปิดใช้จริง</p>
{gaps_table(gaps['no_retail_price'],
            [("sku_code", "SKU"), ("brand", "แบรนด์"), ("product_name", "สินค้า")],
            ["ราคาขาย"])}""")

    sections.append(f"""
<h2>2. ต้นทุนที่ต้องตรวจซ้ำก่อนเชื่อ ({len(gaps['unverified_cost'])} รายการ)</h2>
<p class="note">มีราคา Makro แล้ว แต่ยังไม่ยืนยันว่าเป็นสินค้ารุ่นเดียวขนาดเดียวกัน
ตัวเลขกำไรที่คิดจากราคาเหล่านี้จึงยังสรุปไม่ได้เต็มปาก
เปิดหน้าสินค้าจริงบน makro.pro แล้วยืนยันขนาดบรรจุให้ตรงก่อน</p>
{gaps_table(gaps['unverified_cost'],
            [("sku_code", "SKU"), ("product_name", "สินค้า"),
             ("price", "ราคาที่บันทึกไว้"), ("confidence", "ระดับ"), ("note", "หมายเหตุเดิม")],
            ["ราคาที่ยืนยันแล้ว"])}""")

    sections.append(f"""
<h2>3. จำนวนต่อแพ็คที่ระบบเดาเป็น 1 ({len(gaps['pack_qty_guessed'])} รายการ)</h2>
<p class="note">ชื่อสินค้าไม่ได้บอกจำนวนต่อแพ็ค ระบบจึงตั้งเป็น 1 ไว้ก่อน
ถ้าจริงๆ ขายยกแพ็ค ตัวเลขต้นทุนต่อหน่วยและกำไรจะผิดทั้งหมด
กรอกจำนวนจริงแล้วแก้ชื่อสินค้าในชีตให้ระบุแพ็คด้วย เช่น "x 4" หรือ "แพ็ค 6"</p>
{gaps_table(gaps['pack_qty_guessed'],
            [("sku_code", "SKU"), ("brand", "แบรนด์"), ("product_name", "สินค้า"),
             ("retail_price", "ราคาขาย")],
            ["จำนวนต่อแพ็คจริง"])}""")

    page = f"""<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<title>ใบงานเติมข้อมูลที่ขาด</title>
<style>
  body {{ font-family: -apple-system, 'Segoe UI', Sarabun, sans-serif; margin: 24px; color:#111; }}
  h1 {{ font-size: 20px; margin-bottom: 4px; }}
  .sub {{ color:#555; font-size: 13px; margin-bottom: 20px; }}
  h2 {{ font-size: 15px; margin: 26px 0 6px; padding: 6px 10px; background:#eee;
       border-left: 4px solid #0f766e; }}
  .note {{ font-size: 12px; color:#444; margin: 0 0 8px; }}
  table {{ width:100%; border-collapse: collapse; font-size: 12px; }}
  th, td {{ border:1px solid #bbb; padding: 5px 7px; text-align:left; vertical-align: top; }}
  th {{ background:#f4f4f4; }}
  .write {{ width: 110px; background:#fffde7; }}
  tr {{ page-break-inside: avoid; }}
  @media print {{ body {{ margin: 8mm; }}
    h2 {{ background:#eee !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }} }}
</style></head><body>
<h1>ใบงานเติมข้อมูลที่ขาด — sinthaiPOS</h1>
<div class="sub">
  สร้างเมื่อ {date.today().isoformat()} · กรอกช่องสีเหลืองแล้วนำกลับไปแก้ใน Google Sheet
  จากนั้นรัน <code>python3 scripts/import_from_sheet.py</code> อีกครั้ง<br>
  ใบงานเก็บราคา Makro ของ 130 รายการที่ยังไม่รู้ต้นทุน อยู่แยกที่
  <code>build/makro_worklist.html</code>
</div>
{''.join(sections)}
</body></html>"""

    path.write_text(page, encoding="utf-8")
    return path


def main():
    BUILD.mkdir(exist_ok=True)
    rows, suspect_brands, flat_groups = build_worklist()

    csv_path = write_csv(rows)
    html_path = write_html(rows, suspect_brands, flat_groups)

    counts = Counter(r["priority"] for r in rows)
    print(f"สินค้าที่ยังไม่รู้ต้นทุน: {len(rows)} รายการ\n")
    print(f"  ด่วนที่สุด (แบรนด์ที่พบว่าขาดทุนแล้ว) : {counts[1]:>3} รายการ")
    if suspect_brands:
        print(f"     แบรนด์: {', '.join(sorted(suspect_brands))}")
    print(f"  ควรเก็บ (ตั้งราคาเหมาเท่ากัน)         : {counts[2]:>3} รายการ")
    print(f"  เก็บเมื่อมีเวลา                       : {counts[3]:>3} รายการ")
    print(f"\nเขียนแล้ว: {csv_path.relative_to(ROOT)}")
    print(f"เขียนแล้ว: {html_path.relative_to(ROOT)}  (เปิดแล้วสั่งพิมพ์ได้เลย)")

    gaps = collect_gaps()
    gaps_path = write_gaps_html(gaps)
    print()
    print("ช่องว่างข้อมูลอื่นที่ต้องเติม:")
    print(f"  ยังไม่มีราคาขาย (ขายไม่ได้เลย) : {len(gaps['no_retail_price']):>3} รายการ")
    print(f"  ต้นทุนที่ต้องตรวจซ้ำ            : {len(gaps['unverified_cost']):>3} รายการ")
    print(f"  จำนวนต่อแพ็คที่ระบบเดาเป็น 1    : {len(gaps['pack_qty_guessed']):>3} รายการ")
    print(f"เขียนแล้ว: {gaps_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
