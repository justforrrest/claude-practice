"""
migrate_to_json.py
inventory.db (SQLite) → herb_data.json 변환 스크립트

사용법:
  python migrate_to_json.py [DB 경로]
  기본값: inventory.db (현재 디렉토리)

출력: herb_data.json
→ 약재관리.html 설정 탭 > "JSON 가져오기"로 임포트
"""

import sqlite3, json, sys, os
from datetime import date

DB_PATH = sys.argv[1] if len(sys.argv) > 1 else "inventory.db"

if not os.path.exists(DB_PATH):
    print(f"[오류] 파일을 찾을 수 없습니다: {DB_PATH}")
    sys.exit(1)

con = sqlite3.connect(DB_PATH)
con.row_factory = sqlite3.Row
cur = con.cursor()

# ── 테이블 목록 확인 ──────────────────────────────────────
cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = {r["name"] for r in cur.fetchall()}
print("[정보] 테이블:", tables)

inbound_list  = []
outbound_list = []
prices_map    = {}
min_stock_map = {}

# ── 입고 이력 ─────────────────────────────────────────────
# 예상 컬럼: id, herb, qty, date, supplier, note
if "inbound" in tables:
    cur.execute("SELECT * FROM inbound ORDER BY date")
    for i, row in enumerate(cur.fetchall(), 1):
        d = dict(row)
        inbound_list.append({
            "id":       f"m_{i}",
            "herb":     str(d.get("herb") or d.get("herb_name") or ""),
            "qty":      float(d.get("qty") or d.get("quantity") or 0),
            "date":     str(d.get("date") or date.today()),
            "supplier": str(d.get("supplier") or ""),
            "note":     str(d.get("note") or d.get("memo") or ""),
        })

# ── 출고 이력 ─────────────────────────────────────────────
# 예상 컬럼: id, herb, qty, date, purpose, note
if "outbound" in tables:
    cur.execute("SELECT * FROM outbound ORDER BY date")
    for i, row in enumerate(cur.fetchall(), 1):
        d = dict(row)
        outbound_list.append({
            "id":      f"m_{i}",
            "herb":    str(d.get("herb") or d.get("herb_name") or ""),
            "qty":     float(d.get("qty") or d.get("quantity") or 0),
            "date":    str(d.get("date") or date.today()),
            "purpose": str(d.get("purpose") or d.get("use") or ""),
            "note":    str(d.get("note") or d.get("memo") or ""),
        })

# ── 약재 마스터 (가격 / 최소재고) ──────────────────────────
# 예상 테이블: herbs  컬럼: name, price, min_stock
for tbl in ("herbs", "herb", "herb_master", "items"):
    if tbl in tables:
        cur.execute(f"SELECT * FROM {tbl}")
        for row in cur.fetchall():
            d = dict(row)
            name = str(d.get("name") or d.get("herb") or d.get("herb_name") or "")
            if not name:
                continue
            price = d.get("price") or d.get("unit_price") or 0
            minstk = d.get("min_stock") or d.get("min_qty") or d.get("minimum") or 0
            if price:
                prices_map[name] = float(price)
            if minstk:
                min_stock_map[name] = float(minstk)
        break  # 첫 번째 매칭 테이블만 사용

con.close()

result = {
    "inbound":  inbound_list,
    "outbound": outbound_list,
    "settings": {
        "prices":   prices_map,
        "minStock": min_stock_map,
    },
}

out_path = "herb_data.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

print(f"[완료] {out_path} 저장됨")
print(f"  입고 {len(inbound_list)}건 / 출고 {len(outbound_list)}건")
print(f"  약재 단가 {len(prices_map)}종 / 최소재고 {len(min_stock_map)}종")
print()
print("다음 단계: 약재관리.html > 설정 탭 > 'JSON 가져오기' 버튼으로 임포트")
