# โครงสร้าง Google Sheet

สร้าง Google Sheet ไฟล์เดียว ชื่ออะไรก็ได้ (เช่น "sinthaiPOS Data") แล้วสร้างชีต (tab) ตามนี้
**แถวที่ 1 ของทุกชีตต้องเป็นหัวคอลัมน์ตามชื่อด้านล่างเป๊ะๆ** เพราะ Apps Script อ่านตามชื่อคอลัมน์

## 1. `Products`
| คอลัมน์ | ชนิด | คำอธิบาย |
|---|---|---|
| SKU | text | รหัสสินค้า (unique, ใช้เป็น key หลัก) |
| Barcode | text | บาร์โค้ด (ยิงสแกนแล้วค้นด้วยคอลัมน์นี้) |
| Name | text | ชื่อสินค้า |
| Category | text | หมวดหมู่ |
| Unit | text | หน่วยนับ เช่น ชิ้น, แพ็ค, ลัง |
| Cost | number | ต้นทุนต่อหน่วย |
| RetailPrice | number | ราคาขายปลีก |
| WholesalePrice | number | ราคาขายส่ง |
| WholesaleMinQty | number | จำนวนขั้นต่ำที่เริ่มคิดราคาส่ง |
| StockQty | number | จำนวนคงเหลือ (ระบบอัปเดตอัตโนมัติเมื่อมีการขาย/ปรับสต็อก) |
| ReorderPoint | number | จุดสั่งซื้อซ้ำ (ต่ำกว่านี้ = แจ้งเตือนใกล้หมด) |
| Active | boolean (TRUE/FALSE) | สินค้ายังขายอยู่ไหม |

## 2. `Sales`
| คอลัมน์ | ชนิด | คำอธิบาย |
|---|---|---|
| SaleID | text | รหัสการขาย (สร้างจาก server) |
| ClientSaleId | text | รหัสที่ฝั่ง PWA สร้างตอนขาย (กันบันทึกซ้ำตอน sync offline) |
| Timestamp | datetime | เวลาขาย |
| CashierId | text | รหัสพนักงานที่ขาย |
| CustomerName | text | ชื่อลูกค้า (ถ้ามี, ไม่บังคับ) |
| Subtotal | number | ยอดก่อนหักส่วนลด |
| Discount | number | ส่วนลด |
| Total | number | ยอดสุทธิ |
| PaymentMethod | text | cash / transfer / other |
| Status | text | completed / voided |

## 3. `SaleItems`
| คอลัมน์ | ชนิด | คำอธิบาย |
|---|---|---|
| SaleID | text | อ้างอิง Sales.SaleID |
| SKU | text | อ้างอิง Products.SKU |
| ProductName | text | ชื่อสินค้า ณ ตอนขาย (เผื่อ Products เปลี่ยนชื่อทีหลัง) |
| Qty | number | จำนวนที่ขาย |
| UnitPrice | number | ราคาต่อหน่วย ณ ตอนขาย |
| LineTotal | number | Qty × UnitPrice |

## 4. `StockMovements`
| คอลัมน์ | ชนิด | คำอธิบาย |
|---|---|---|
| Timestamp | datetime | เวลาที่เคลื่อนไหวสต็อก |
| SKU | text | อ้างอิง Products.SKU |
| ChangeQty | number | ค่าติดลบ = ตัดสต็อก (ขาย), ค่าบวก = รับเข้า/ปรับเพิ่ม |
| Reason | text | sale / restock / adjustment |
| RefSaleID | text | ถ้ามาจากการขาย ใส่ SaleID |
| UserId | text | ใครเป็นคนทำรายการ |

## 5. `Staff`
| คอลัมน์ | ชนิด | คำอธิบาย |
|---|---|---|
| UserId | text | รหัสพนักงาน |
| Name | text | ชื่อ |
| PinHash | text | รหัสผ่าน (PIN) ที่ hash แล้ว ห้ามเก็บ plain text |
| Role | text | owner / cashier |
| Active | boolean | ยังทำงานอยู่ไหม |

## 6. `Settings`
| คอลัมน์ | ชนิด | คำอธิบาย |
|---|---|---|
| Key | text | เช่น ShopName, Currency, ReceiptFooter |
| Value | text | ค่าของ setting นั้น |

---

**หมายเหตุ:** ชื่อ tab (ชื่อชีต) ต้องตรงกับชื่อในตารางด้านบนเป๊ะๆ (ตัวพิมพ์เล็ก-ใหญ่ตรงกัน) เพราะ
`apps-script/Utils.gs` เรียกชีตด้วยชื่อเหล่านี้ตรงๆ
