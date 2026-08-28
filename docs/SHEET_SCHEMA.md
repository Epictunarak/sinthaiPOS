# โครงสร้าง Google Sheet ที่ POS ใช้

> **ชีตนี้ไม่ใช่ต้นทางข้อมูล** ต้นทางคือ Google Sheet "สินไทยพาณิชย์" ของร้าน
> แผ่น `Products` ที่นี่ถูก *สร้างขึ้น* จาก `build/sheet_products.csv` ทุกรอบ
> อย่าพิมพ์แก้สินค้าหรือราคาในแผ่นนี้โดยตรง เพราะจะถูกเขียนทับ
> (ดู [`ARCHITECTURE.md`](./ARCHITECTURE.md) หัวข้อเส้นทางข้อมูล)
>
> แผ่นที่ระบบ *เขียน* ระหว่างใช้งานจริง — `Sales`, `SaleItems`, `StockMovements`,
> `BarcodeCaptures` — ไม่ถูกเขียนทับ เป็นข้อมูลสะสมของร้าน

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
| Reason | text | sale / restock / adjustment / stocktake (ตรวจนับ) |
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

## 6. `BarcodeCaptures` (ระบบสร้างให้เอง)

บันทึกทุกครั้งที่พนักงานยิงบาร์โค้ดผ่านหน้า "เก็บบาร์โค้ด" ในแอป ต่อท้ายอย่างเดียว ไม่ลบ

| คอลัมน์ | ชนิด | คำอธิบาย |
|---|---|---|
| Timestamp | datetime | เวลาที่ยิง |
| SKU | text | สินค้าที่ผูกบาร์โค้ดนี้ |
| Barcode | text | **ต้องตั้งรูปแบบเซลล์เป็น "ข้อความ"** ไม่งั้นเลข 0 นำหน้าจะหาย |
| PreviousBarcode | text | ค่าเดิมก่อนแก้ (ว่างถ้าเพิ่งมีครั้งแรก) |
| UserId | text | ใครเป็นคนยิง |

> ชีตนี้คือที่เดียวที่บาร์โค้ดรอดจากการ import รอบถัดไป ให้ export เป็น CSV ไปวางที่
> `data/barcode_captures.csv` เพื่อให้ `import_from_sheet.py` ผสมกลับเข้าไป

## 7. `Settings`
| คอลัมน์ | ชนิด | คำอธิบาย |
|---|---|---|
| Key | text | ชื่อค่าตั้ง (ดูรายการที่ระบบใช้ด้านล่าง) |
| Value | text | ค่าของ setting นั้น |

ค่าที่ระบบอ่านไปใช้จริงบนหัวใบเสร็จ (ไม่ใส่ก็ได้ ระบบมีค่าเริ่มต้นให้):

| Key | ใช้ที่ไหน |
|---|---|
| `ShopName` | ชื่อร้านบนหัวใบเสร็จ |
| `ShopAddress` | ที่อยู่ใต้ชื่อร้าน |
| `ShopPhone` | เบอร์โทรใต้ที่อยู่ |
| `ReceiptFooter` | ข้อความท้ายบิล เช่น "ขอบคุณที่อุดหนุนครับ" |

---

**หมายเหตุ:** ชื่อ tab (ชื่อชีต) ต้องตรงกับชื่อในตารางด้านบนเป๊ะๆ (ตัวพิมพ์เล็ก-ใหญ่ตรงกัน) เพราะ
`apps-script/Utils.gs` เรียกชีตด้วยชื่อเหล่านี้ตรงๆ
