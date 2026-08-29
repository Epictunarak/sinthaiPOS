#!/usr/bin/env python3
"""
เทสต์ตัวแปลงข้อมูลจากชีต — จุดที่ความถูกต้องของข้อมูลทั้งระบบเกิดขึ้น

ถ้าตัวแยกตรงนี้อ่านผิด จะไม่มีอะไรเตือนเลย ข้อมูลจะผิดเงียบๆ แล้วไปโผล่เป็นตัวเลข
ต้นทุนและกำไรที่ผิดในรายงาน ซึ่งกว่าจะรู้ตัวก็ตัดสินใจเรื่องราคาไปแล้ว

รันด้วย: python3 tests/test_import_from_sheet.py
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from import_from_sheet import clean, format_number, normalize_sku, parse_pack_qty  # noqa: E402


class TestClean(unittest.TestCase):
    def test_barcode_ตัวเลขล้วนต้องไม่กลายเป็นทศนิยม(self):
        # openpyxl อ่านบาร์โค้ดที่เป็นตัวเลขล้วนมาเป็น float ถ้าปล่อยไว้จะได้
        # "8851959142011.0" ซึ่งยิงสแกนแล้วหาไม่เจอตลอดกาล
        self.assertEqual(clean(8851959142011.0), "8851959142011")
        self.assertEqual(clean(8850718801015.0), "8850718801015")

    def test_เก็บทศนิยมจริงไว้(self):
        self.assertEqual(clean(1.5), "1.5")

    def test_ยุบช่องว่างและตัดหัวท้าย(self):
        # ชีตมีทั้ง "ฟันโอ" และ "ฟันโอ " ซึ่งถ้าไม่ normalize จะกลายเป็นคนละแบรนด์
        self.assertEqual(clean("ฟันโอ "), "ฟันโอ")
        self.assertEqual(clean("  ยูโร่   เค้ก  "), "ยูโร่ เค้ก")

    def test_ค่าว่างคืนสตริงว่าง(self):
        self.assertEqual(clean(None), "")
        self.assertEqual(clean(""), "")


class TestFormatNumber(unittest.TestCase):
    def test_จำนวนเต็มไม่มีจุดทศนิยมห้อยท้าย(self):
        self.assertEqual(format_number(325.0), "325")
        self.assertEqual(format_number(600), "600")

    def test_ทศนิยมจริงยังอยู่ครบ(self):
        self.assertEqual(format_number(1.5), "1.5")

    def test_ค่าว่าง(self):
        self.assertEqual(format_number(None), "")


class TestNormalizeSku(unittest.TestCase):
    def test_ปรับให้เป็นสี่หลักเสมอ(self):
        # ชีตมีทั้ง SKU001 (3 หลัก) และ SKU0016 (4 หลัก) ปนกัน
        self.assertEqual(normalize_sku("SKU001"), "SKU0001")
        self.assertEqual(normalize_sku("SKU0016"), "SKU0016")
        self.assertEqual(normalize_sku("SKU85"), "SKU0085")

    def test_รับช่องว่างและตัวพิมพ์เล็ก(self):
        self.assertEqual(normalize_sku(" sku 7 "), "SKU0007")

    def test_คืนNoneเมื่อไม่ใช่รหัสSKU(self):
        self.assertIsNone(normalize_sku(""))
        self.assertIsNone(normalize_sku(None))
        self.assertIsNone(normalize_sku("ไม่ใช่รหัส"))


class TestParsePackQty(unittest.TestCase):
    def test_รูปแบบที่พบจริงในชีต(self):
        cases = {
            "Coke Original 325ml x 24 units": 24,
            "SINGHA Drinking Water 1.5L Pack 6": 6,
            "ยูโร่ คัสตาร์ดเค้ก 17 ก. 12 ชิ้น": 12,
            "ยูโร่ เค้กกล้วย 17 ก. x 12": 12,
            "ไมโลนมยูเอชที 170มล.x 8": 8,
            "ชาช่า เมล็ดทานตะวันกลิ่นมะพร้าว 72 ก. แพ็ค 6": 6,
        }
        for name, expected in cases.items():
            qty, found = parse_pack_qty(name)
            self.assertTrue(found, f"ควรอ่านจำนวนต่อแพ็คจาก: {name}")
            self.assertEqual(qty, expected, name)

    def test_รองรับการสะกดแพ็กด้วย_ก(self):
        # เจอจริงในชีต 1 แถว ถ้าไม่รองรับ จำนวนจะถูกตั้งเป็น 1 เงียบๆ
        # แล้วต้นทุนต่อหน่วยกับกำไรของสินค้าตัวนั้นจะผิดทั้งหมด
        qty, found = parse_pack_qty("มอลคิสท์ แครกเกอร์ สอดไส้ครีมรสคาปูชิโน 46 กรัม แพ็ก 12")
        self.assertTrue(found, "ต้องอ่าน 'แพ็ก 12' ได้เหมือน 'แพ็ค 12'")
        self.assertEqual(qty, 12)

    def test_ชื่อที่ไม่ได้บอกจำนวนต้องคืน_1_พร้อมบอกว่าไม่เจอ(self):
        for name in ["โฟร์โมสต์รสจืด 225 มล.",
                     "ดัชมิลล์คิดส์นมเปรี้ยวรสส้ม 90มล.",
                     "FANTA Mixed Fruit Flavored Soft Drink 1.5 L."]:
            qty, found = parse_pack_qty(name)
            self.assertFalse(found, f"ไม่ควรเดาจำนวนจาก: {name}")
            self.assertEqual(qty, 1)

    def test_ไม่เอาตัวเลขที่เป็นส่วนหนึ่งของชื่อสินค้ามาเป็นจำนวน(self):
        # "ไฮ10แคลเซี่ยม" คือชื่อสูตร ไม่ใช่จำนวนต่อแพ็ค
        qty, found = parse_pack_qty("ดีมอลต์ไฮ10แคลเซี่ยม 180มล.")
        self.assertFalse(found)
        self.assertEqual(qty, 1)

    def test_ไม่เอาราคาที่อยู่ในชื่อมาเป็นจำนวน(self):
        qty, found = parse_pack_qty("ซุปเปอร์สตาร์ทวิน36ก. 5 บาท")
        self.assertFalse(found)
        self.assertEqual(qty, 1)

    def test_ปฏิเสธจำนวนที่มากเกินจริง(self):
        # กันกรณีอ่านเลขขนาดบรรจุหรือเลขอื่นมาเป็นจำนวนต่อแพ็ค
        qty, found = parse_pack_qty("สินค้าทดสอบ x 9999")
        self.assertFalse(found)
        self.assertEqual(qty, 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
