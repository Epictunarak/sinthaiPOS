#!/usr/bin/env python3
"""
เทสต์การคงยอดสต็อกไว้ตอนสร้างแผ่น Products ใหม่

ทำไมสำคัญ: แผ่น Products ถูกสร้างใหม่ทุกครั้งจากข้อมูลต้นทาง แต่ StockQty เป็นค่าที่
ระบบเขียนระหว่างขายจริง ไม่ใช่ค่าจากชีตต้นทาง ถ้าเขียน 0 ทับทุกรอบ สต็อกที่พนักงาน
เดินนับทั้งร้าน (งานหลายชั่วโมง) จะหายทันทีที่วาง CSV ทับรอบถัดไป โดยไม่มีอะไรเตือน

รันด้วย: python3 tests/test_build_catalog.py
"""

import csv
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import build_catalog  # noqa: E402


def write_products_export(path, rows):
    """เขียนไฟล์หน้าตาเหมือนที่ export จากแผ่น Products ใน Google Sheet"""
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["SKU", "Barcode", "Name", "Category", "Unit", "Cost",
                    "RetailPrice", "WholesalePrice", "WholesaleMinQty",
                    "StockQty", "ReorderPoint", "Active"])
        for r in rows:
            w.writerow(r)


class TestReadLiveStock(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(__file__).resolve().parent / "_tmp_data"
        self.tmp.mkdir(exist_ok=True)
        patcher = mock.patch.object(build_catalog, "DATA", self.tmp)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self._cleanup)

    def _cleanup(self):
        for f in self.tmp.glob("*"):
            f.unlink()
        self.tmp.rmdir()

    def test_ไม่มีไฟล์ถือว่าไม่มียอดเดิม(self):
        # ติดตั้งครั้งแรกยังไม่เคย export — ต้องไม่พังและถือว่าเริ่มที่ 0
        self.assertEqual(build_catalog.read_live_stock(), {})

    def test_อ่านยอดคงเหลือและจุดสั่งซื้อจากไฟล์ที่ส่งออกมา(self):
        write_products_export(self.tmp / "stock_levels.csv", [
            ["SKU0016", "", "ยูโร่", "Snack", "แพ็ค", 51, 50, 53, 5, 24, 6, "TRUE"],
            ["SKU0003", "8851959142011", "SINGHA", "Beverage", "แพ็ค", 49, 50, 52, 5, 8, 3, "TRUE"],
        ])
        levels = build_catalog.read_live_stock()
        self.assertEqual(levels["SKU0016"]["stock_qty"], 24)
        self.assertEqual(levels["SKU0016"]["reorder_point"], 6)
        self.assertEqual(levels["SKU0003"]["stock_qty"], 8)

    def test_ยอดศูนย์ต้องถูกเก็บเป็นศูนย์ไม่ใช่ถูกมองว่าไม่มีค่า(self):
        # 0 เป็นค่าที่ถูกต้อง (ของหมดจริง) ถ้าเผลอใช้ falsy check จะกลายเป็นค่า default
        write_products_export(self.tmp / "stock_levels.csv", [
            ["SKU0099", "", "ของหมด", "Snack", "ชิ้น", 10, 20, "", 5, 0, 2, "TRUE"],
        ])
        levels = build_catalog.read_live_stock()
        self.assertEqual(levels["SKU0099"]["stock_qty"], 0)
        self.assertEqual(levels["SKU0099"]["reorder_point"], 2)

    def test_ช่องว่างใช้ค่าเริ่มต้นแทนที่จะพัง(self):
        write_products_export(self.tmp / "stock_levels.csv", [
            ["SKU0001", "", "ของใหม่", "", "ชิ้น", "", 20, "", 5, "", "", "TRUE"],
        ])
        levels = build_catalog.read_live_stock()
        self.assertEqual(levels["SKU0001"]["stock_qty"], build_catalog.DEFAULT_STOCK_QTY)
        self.assertEqual(levels["SKU0001"]["reorder_point"], build_catalog.DEFAULT_REORDER_POINT)

    def test_ข้ามแถวที่ไม่มีรหัสสินค้า(self):
        # แถวว่างท้ายชีตเป็นเรื่องปกติใน Google Sheets
        write_products_export(self.tmp / "stock_levels.csv", [
            ["SKU0016", "", "ยูโร่", "Snack", "แพ็ค", 51, 50, 53, 5, 24, 6, "TRUE"],
            ["", "", "", "", "", "", "", "", "", "", "", ""],
        ])
        levels = build_catalog.read_live_stock()
        self.assertEqual(list(levels), ["SKU0016"])


class TestFormatQty(unittest.TestCase):
    def test_จำนวนเต็มไม่แสดงจุดทศนิยม(self):
        # ถ้าปล่อยเป็น 24.0 พนักงานจะอ่านว่าระบบเพี้ยน และ Sheets จะจัดรูปแบบเพี้ยนตาม
        self.assertEqual(build_catalog.format_qty(24.0), "24")
        self.assertEqual(build_catalog.format_qty(0), "0")

    def test_สินค้าชั่งกิโลเก็บทศนิยมไว้ได้(self):
        self.assertEqual(build_catalog.format_qty(1.5), "1.5")


class TestWriteOutputsคงสต็อกไว้(unittest.TestCase):
    """เทสต์เส้นทางจริงทั้งเส้น — เขียนไฟล์ออกมาแล้วอ่านกลับ ไม่ได้เช็คแค่ฟังก์ชันย่อย"""

    def setUp(self):
        base = Path(__file__).resolve().parent / "_tmp_out"
        self.data = base / "data"
        self.build = base / "build"
        self.data.mkdir(parents=True, exist_ok=True)
        self.build.mkdir(parents=True, exist_ok=True)
        for name, target in (("DATA", self.data), ("BUILD", self.build)):
            p = mock.patch.object(build_catalog, name, target)
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self._cleanup)

    def _cleanup(self):
        base = Path(__file__).resolve().parent / "_tmp_out"
        for f in sorted(base.rglob("*"), reverse=True):
            f.unlink() if f.is_file() else f.rmdir()
        base.rmdir()

    def _catalog(self):
        return [{
            "sku_code": "SKU0016", "barcode": "", "product_name": "ยูโร่ คัสตาร์ดเค้ก",
            "category": "Snack", "unit": "ชิ้น", "pack_qty": 12,
            "cost_price": 51.0, "retail_price": 50.0, "suggested_wholesale_price": 54,
        }]

    def _written_row(self):
        with open(self.build / "sheet_products.csv", encoding="utf-8-sig", newline="") as f:
            return list(csv.DictReader(f))[0]

    def test_สต็อกที่นับไว้แล้วต้องไม่ถูกล้างเป็นศูนย์(self):
        write_products_export(self.data / "stock_levels.csv", [
            ["SKU0016", "", "ยูโร่", "Snack", "แพ็ค", 51, 50, 53, 5, 24, 6, "TRUE"],
        ])
        build_catalog.write_outputs(self._catalog())

        row = self._written_row()
        self.assertEqual(row["StockQty"], "24", "สต็อกที่เดินนับทั้งร้านต้องไม่หาย")
        self.assertEqual(row["ReorderPoint"], "6", "จุดสั่งซื้อที่ตั้งเองไว้ต้องไม่ถูกรีเซ็ต")

    def test_สินค้าใหม่ที่ยังไม่มีในแผ่นเริ่มที่ศูนย์(self):
        write_products_export(self.data / "stock_levels.csv", [
            ["SKU9999", "", "สินค้าอื่น", "Snack", "ชิ้น", 10, 20, "", 5, 99, 9, "TRUE"],
        ])
        build_catalog.write_outputs(self._catalog())

        row = self._written_row()
        self.assertEqual(row["StockQty"], "0", "สินค้าที่ยังไม่เคยนับต้องเริ่มที่ 0 ไม่ใช่ยืมยอดตัวอื่น")
        self.assertEqual(row["ReorderPoint"], "3")

    def test_ติดตั้งครั้งแรกที่ยังไม่มีไฟล์ยอดคงเหลือ(self):
        build_catalog.write_outputs(self._catalog())
        self.assertEqual(self._written_row()["StockQty"], "0")


if __name__ == "__main__":
    unittest.main(verbosity=2)
