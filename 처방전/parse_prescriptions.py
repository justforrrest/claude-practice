"""
처방전 xlsx 파일들을 읽어 처방관리.html이 사용하는 JSON 형식으로 변환합니다.
출력: import_data.json
"""
import openpyxl, json, re, sys
from pathlib import Path
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

FOLDER = Path(__file__).parent
OUTPUT  = FOLDER / 'import_data.json'

# 파일명에서 번호 추출 (정렬용)
def file_sort_key(p):
    m = re.match(r'^(\d+)\.', p.stem)
    return int(m.group(1)) if m else 9999

def make_id(seed):
    import hashlib
    return hashlib.sha1(seed.encode('utf-8')).hexdigest()[:16]

def parse_date(val):
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.strftime('%Y-%m-%d')
    s = str(val).strip()
    # "24.05.03", "2024-05-03", "24.3.25" 등
    m = re.match(r'(\d{2,4})[.\-/](\d{1,2})[.\-/](\d{1,2})', s)
    if m:
        y, mo, d = m.groups()
        if len(y) == 2:
            y = '20' + y
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    return None

# 건너뛸 파일
SKIP_STEMS = {'##처방전샘플', '약재관리', '처방구성', '처방구성(백업용)', 'import_data'}

patients_map = {}   # name -> patient dict
prescriptions = []
errors = []

xlsx_files = sorted(FOLDER.glob('*.xlsx'), key=file_sort_key)

for fp in xlsx_files:
    if fp.stem in SKIP_STEMS or fp.stem.startswith('^'):
        continue

    # 파일명에서 환자명·처방명 추출 ("19. 오명옥-청상보하탕")
    fname_match = re.match(r'^\d+\.\s*(.+?)-(.+)$', fp.stem)
    if not fname_match:
        errors.append(f'이름 파싱 실패: {fp.name}')
        continue

    fname_patient = fname_match.group(1).strip()
    fname_rx      = fname_match.group(2).strip()

    try:
        wb = openpyxl.load_workbook(fp, data_only=True)
    except Exception as e:
        errors.append(f'파일 오류 [{fp.name}]: {e}')
        continue

    for ws in wb.worksheets:
        if ws.title.strip() == '약재관리':
            continue

        rows = list(ws.iter_rows(values_only=True))

        # 사이드 패널에서 처방 정보 읽기
        side = {}
        for row in rows:
            if len(row) > 11 and row[10] is not None:
                side[str(row[10]).strip()] = row[11]

        patient_name = str(side.get('이름', '')).strip() or fname_patient
        rx_name      = str(side.get('처방명', '')).strip() or fname_rx
        date         = parse_date(side.get('날짜')) or '2024-01-01'
        memo         = str(side.get('메모', '') or '').strip()
        packs_raw    = side.get('첩수')
        days_raw     = side.get('총 일수')
        packs = int(packs_raw) if packs_raw and str(packs_raw).isdigit() else 20
        days  = int(days_raw)  if days_raw  and str(days_raw).isdigit()  else 15

        # 약재 행 추출: col[1]=No(숫자), col[2]=약재명(문자), col[4]=첩당g(숫자)
        herbs = []
        for row in rows[1:]:   # 0행은 헤더
            if len(row) < 5:
                continue
            no        = row[1]
            herb_name = row[2]
            qty_per   = row[4]
            if (isinstance(no, (int, float)) and
                    isinstance(herb_name, str) and herb_name.strip() and
                    isinstance(qty_per, (int, float)) and qty_per > 0):
                herbs.append({'herb': herb_name.strip(), 'qtyPerPack': float(qty_per)})

        if not herbs:
            errors.append(f'약재 없음: {fp.name} / {ws.title}')
            continue

        # 환자 등록
        if patient_name not in patients_map:
            patients_map[patient_name] = {
                'id':   make_id(f'patient:{patient_name}'),
                'name': patient_name,
                'memo': '',
            }
        patient = patients_map[patient_name]

        prescriptions.append({
            'id':          make_id(f'rx:{fp.stem}:{ws.title}'),
            'patientId':   patient['id'],
            'patientName': patient_name,
            'date':        date,
            'diagnosis':   rx_name,
            'dosage':      '',
            'packs':       packs,
            'days':        days,
            'herbs':       herbs,
            'totalPrice':  0,   # 단가 정보 없으므로 0 (앱에서 재계산 가능)
            'note':        memo,
            'outboundAt':  None,
        })

result = {
    'patients':      list(patients_map.values()),
    'prescriptions': prescriptions,
}

with open(OUTPUT, 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

print(f"✓ 완료: 처방 {len(prescriptions)}건, 환자 {len(patients_map)}명")
if errors:
    print(f"⚠ 오류/건너뜀 {len(errors)}건:")
    for e in errors:
        print(f"  - {e}")
print(f"→ 저장: {OUTPUT}")
