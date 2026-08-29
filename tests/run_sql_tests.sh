#!/usr/bin/env bash
# run_sql_tests.sh — ทดสอบ migration 007+ และการนำเข้าข้อมูลบน PostgreSQL จริง
#
# ทดสอบว่า:
#   1. migration รันผ่านบน schema เปล่า
#   2. migration รันซ้ำได้โดยไม่พัง (idempotent)
#   3. นำเข้า CSV แล้วได้จำนวนแถวถูกต้อง
#   4. นำเข้าซ้ำแล้วไม่เกิดข้อมูลซ้ำ
#   5. บาร์โค้ดว่างถูกเก็บเป็น NULL ไม่ใช่สตริงว่าง
#   6. รายงานกำไรจาก SQL ตรงกับที่ scripts/build_catalog.py คำนวณ
#
# ใช้:  ./tests/run_sql_tests.sh
# ต้องมี: PostgreSQL client + server ในเครื่อง (หรือชี้ PGHOST/PGPORT ไปที่ server อื่น)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${TEST_DB:-sinthai_test}"
# migration ตั้งใจให้รันซ้ำได้ NOTICE "already exists" จึงเป็นเรื่องปกติ ไม่ใช่ปัญหา
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
PSQL_ARGS=(-U "${PGUSER:-postgres}" -v ON_ERROR_STOP=1 -q)
[[ -n "${PGHOST:-}" ]] && PSQL_ARGS+=(-h "$PGHOST")
[[ -n "${PGPORT:-}" ]] && PSQL_ARGS+=(-p "$PGPORT")

# COPY ฝั่ง server อ่านไฟล์จากเครื่องฐานข้อมูล จึงต้องวางไฟล์ในที่ที่ server อ่านได้
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp "$ROOT"/data/products_master.csv "$ROOT"/data/vendor_prices.csv "$STAGE/"
chmod 755 "$STAGE"; chmod 644 "$STAGE"/*.csv

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; exit 1; }

echo "เตรียมฐานข้อมูลทดสอบ: $DB"
psql "${PSQL_ARGS[@]}" -d postgres -c "drop database if exists $DB;" -c "create database $DB;"

run() { psql "${PSQL_ARGS[@]}" -d "$DB" "$@"; }
scalar() { psql "${PSQL_ARGS[@]}" -d "$DB" -tAc "$1"; }

echo "1. สร้าง schema พื้นฐาน Phase 1 (ตัวจำลองสำหรับทดสอบ)"
run -f "$ROOT/tests/phase1_reference_schema.sql"
pass "phase1 fixture"

echo "2. รัน migration 007"
for migration in 007_pos_extensions 009_template_sample_confidence; do
    run -f "$ROOT/sql/$migration.sql" >/dev/null
done
pass "รันครั้งแรกผ่าน"
for migration in 007_pos_extensions 009_template_sample_confidence; do
    run -f "$ROOT/sql/$migration.sql" >/dev/null
done
pass "รันซ้ำผ่าน (idempotent)"

echo "3. นำเข้าข้อมูล"
seed() {
    run -v products_csv="$STAGE/products_master.csv" \
        -v vendor_csv="$STAGE/vendor_prices.csv" \
        -f "$ROOT/sql/008_seed_pos_catalog.sql" >/dev/null
}
seed
products=$(scalar "select count(*) from sinthai.products;")
vendors=$(scalar "select count(*) from sinthai.vendor_price_research;")
[[ "$products" == "141" ]] || fail "ควรมีสินค้า 141 รายการ แต่ได้ $products"
[[ "$vendors"  == "56"  ]] || fail "ควรมีราคาผู้ขาย 56 แถว แต่ได้ $vendors"
pass "นำเข้าสินค้า $products รายการ, ราคาผู้ขาย $vendors แถว"

echo "4. นำเข้าซ้ำต้องไม่เกิดข้อมูลซ้ำ"
seed
products2=$(scalar "select count(*) from sinthai.products;")
vendors2=$(scalar "select count(*) from sinthai.vendor_price_research;")
[[ "$products2" == "$products" ]] || fail "สินค้าซ้ำหลังนำเข้ารอบสอง: $products2"
[[ "$vendors2"  == "$vendors"  ]] || fail "ราคาผู้ขายซ้ำหลังนำเข้ารอบสอง: $vendors2"
pass "จำนวนแถวคงเดิม"

echo "5. บาร์โค้ดว่างต้องเป็น NULL"
empty=$(scalar "select count(*) from sinthai.products where barcode = '';")
[[ "$empty" == "0" ]] || fail "พบบาร์โค้ดเป็นสตริงว่าง $empty แถว (ต้องเป็น NULL)"
pass "ไม่มีบาร์โค้ดเป็นสตริงว่าง"

echo "6. SQL กับ Python ต้องรายงานตรงกัน"
sql_below=$(scalar "select count(*) from sinthai.product_margin_view where price_status = 'selling_below_cost';")
py_below=$(cd "$ROOT" && python3 - <<'PY'
import sys; sys.path.insert(0, "scripts")
from build_catalog import build
print(sum(1 for c in build() if "SELLING_BELOW_COST" in c["issues"]))
PY
)
[[ "$sql_below" == "$py_below" ]] \
    || fail "ไม่ตรงกัน: SQL บอก $sql_below รายการ, Python บอก $py_below รายการ"
pass "ทั้งสองทางบอกตรงกันว่ามีสินค้าขายต่ำกว่าทุน $sql_below รายการ"

echo ""
echo "ผ่านทั้งหมด"
