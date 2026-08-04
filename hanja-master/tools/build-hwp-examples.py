# -*- coding: utf-8 -*-
"""1급 한자어 용례 생성기 — 서당개 김백국

  ★1급 한자단어로훈음익히기(단어 뜻풀이포함).hwp  ->  examples-lv1.js

원본 hwp 는 어문회 1급 대비용으로 정리된 한자어 목록입니다. 문서는

    1級 漢字語 讀音 訓音 練習 (1~16)   <- 표. 한자어와 훈음만
    한자어 뜻풀이 (1~16)               <- 목록. 한 줄에 네 요소가 다 있음

두 부분으로 되어 있는데, 이 스크립트는 뜻풀이 목록만 읽습니다. 표는 2단 레이아웃이라
셀 경계가 텍스트로 안 남고 훈음이 줄바꿈으로 잘려서 붙이기가 불안정합니다. 뜻풀이 쪽은

    苛斂[가렴] [가혹할가/거둘렴] 조세 같은 것을 가혹하게 징수함.

한 줄이면 충분해서 정규식 하나로 끝납니다.

훈음(가혹할가/거둘렴)은 화면에 안 쓰므로 버리고, examples.js 와 같은 {w, r, d} 로 냅니다.

  실행:  python tools/build-hwp-examples.py
  준비:  pip install olefile
"""

import os
import re
import struct
import sys
import unicodedata
import zlib
from collections import OrderedDict
from datetime import date

import olefile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
HWP = os.path.join(ROOT, "★1급 한자단어로훈음익히기(단어 뜻풀이포함).hwp")
DATA = os.path.join(ROOT, "data.js")
OUT = os.path.join(ROOT, "examples-lv1.js")

# 이 자료가 담당하는 급수. data.js 의 lv 코드이고 LEVELS 에서 "1급" 에 해당합니다.
LEVEL_CODE = "10"


# ── hwp 5.0 본문 추출 ────────────────────────────────────────────────
# hwp 5.0 은 OLE 복합 문서입니다. 본문은 BodyText/Section0..N 스트림에 들어 있고
# FileHeader 의 속성 비트 0 이 서면 raw deflate(zlib, wbits=-15)로 압축돼 있습니다.
# 스트림은 [헤더 4바이트][데이터] 레코드가 이어진 형태이고, 헤더는
#   비트  0~9  : 태그 ID       (67 = HWPTAG_PARA_TEXT, 문단 글자들)
#   비트 10~19 : 트리 레벨      (안 씀)
#   비트 20~31 : 데이터 길이     (0xFFF 면 뒤에 4바이트 길이가 따로 옴)
# 입니다. 글자는 UTF-16LE 이고 코드값 31 이하는 제어문자라 자릿수가 다릅니다.

TAG_PARA_TEXT = 67

# 제어문자 분류 — 뒤따르는 바이트 수가 달라서 건너뛸 길이를 정하는 데 씁니다.
CTRL_CHAR = {0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31}          # 2바이트
CTRL_WIDE = {1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17,  # 16바이트
             18, 19, 20, 21, 22, 23}


def hwp_text(path):
    """hwp 5.0 파일에서 본문 텍스트를 뽑아 한 덩어리 문자열로 돌려줍니다."""
    ole = olefile.OleFileIO(path)
    try:
        compressed = bool(ole.openstream("FileHeader").read()[36] & 1)
        sections = sorted(
            (e for e in ole.listdir() if e[0] == "BodyText"),
            key=lambda e: int(re.sub(r"\D", "", e[1]) or 0),
        )
        out = []
        for entry in sections:
            data = ole.openstream(entry).read()
            if compressed:
                data = zlib.decompress(data, -15)
            out.append(_section_text(data))
        return "\n".join(out)
    finally:
        ole.close()


def _section_text(data):
    """섹션 스트림에서 문단 글자 레코드만 골라 이어 붙입니다."""
    chunks = []
    i = 0
    while i + 4 <= len(data):
        header = struct.unpack("<I", data[i:i + 4])[0]
        tag = header & 0x3FF
        size = (header >> 20) & 0xFFF
        i += 4
        if size == 0xFFF:                      # 길이가 넘치면 4바이트로 따로 붙습니다
            size = struct.unpack("<I", data[i:i + 4])[0]
            i += 4
        if tag == TAG_PARA_TEXT:
            chunks.append(_para_text(data[i:i + size]))
        i += size
    return "\n".join(chunks)


def _para_text(rec):
    """문단 글자 레코드(UTF-16LE + 제어문자)를 문자열로 풉니다."""
    buf = []
    j = 0
    while j + 2 <= len(rec):
        code = struct.unpack("<H", rec[j:j + 2])[0]
        if code in CTRL_CHAR:
            # 10(줄바꿈)·13(문단끝)만 줄바꿈으로 살리고 나머지는 버립니다
            buf.append("\n" if code in (10, 13) else "")
            j += 2
        elif code in CTRL_WIDE:
            # 표·그림·각주 같은 개체 자리. 낱말이 붙어버리지 않게 공백 하나로 둡니다
            buf.append(" ")
            j += 16
        else:
            buf.append(chr(code))
            j += 2
    return "".join(buf)


# ── 뜻풀이 줄 파싱 ───────────────────────────────────────────────────
# 苛斂[가렴] [가혹할가/거둘렴] 조세 같은 것을 가혹하게 징수함.
#  └단어  └읽기   └훈음(안 씀)  └뜻풀이
#
# 읽기에 슬래시가 들어가는 줄이 하나 있습니다 — 醵出[거출/갹출]. 그래서 [가-힣] 만으로는
# 모자라고 슬래시도 받아야 합니다.
#
# 한자 범위에 U+F900~FAFF(호환한자)를 넣은 건, 이 문서가 두음법칙으로 갈리는 글자를
# 호환한자 코드로 적어놨기 때문입니다. 落 은 U+843D 가 아니라 U+F915 로 들어 있습니다.
LINE = re.compile(
    r"^([㐀-鿿豈-﫿]{2,4})"   # 한자어
    r"\[([가-힣/]{2,9})\]"                     # 읽기
    r"\s*\[[^\]]*\]"                           # 훈음 — 자리만 맞추고 버립니다
    r"\s*(.+)$",                               # 뜻풀이
    re.M,
)


def parse_words(text):
    """(한자어, 읽기, 뜻풀이) 목록. 문서에 나온 순서를 지킵니다."""
    words = []
    seen = set()
    for w, r, d in LINE.findall(text):
        d = re.sub(r"\s+", " ", d).strip()
        if not d or w in seen:
            continue
        seen.add(w)
        words.append((w, r, d))
    return words


# ── data.js 의 1급 한자 ──────────────────────────────────────────────

ITEM = re.compile(r'\{ c: "(.)",.*?lv: "(\d\d)" \}')


def level_chars(path, code):
    """그 급수 신습한자의 { NFC 정규화 글자 -> data.js 원본 글자 } 표.

    data.js 에도 호환한자로 들어간 글자가 몇 개 있습니다. 그래서 맞춰볼 때는 정규화한
    글자로 보고, 내보내는 키는 반드시 원본 그대로 씁니다 — app.js 가 EXAMPLES[item.c]
    로 찾기 때문에 키가 한 글자라도 어긋나면 그 글자만 조용히 용례가 사라집니다.
    """
    src = open(path, encoding="utf-8").read()
    return {
        unicodedata.normalize("NFC", c): c
        for c, lv in ITEM.findall(src)
        if lv == code
    }


# ── 출력 ─────────────────────────────────────────────────────────────

def js_string(s):
    """JS 문자열 리터럴. 큰따옴표와 역슬래시만 막으면 되는 내용입니다."""
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


HEADER = """// 1급 한자어 용례 — 서당개 김백국
//
// !! 자동 생성 파일입니다. 손으로 고치지 마세요.
//    tools/build-hwp-examples.py 로 다시 생성합니다.
//
// 출처: ★1급 한자단어로훈음익히기(단어 뜻풀이포함).hwp
//       한국어문회 1급 대비용으로 정리된 한자어 목록입니다.
// 생성일: {today}
// 수록: {chars}자 / {words}항목
//
// 구조는 examples.js 와 같습니다. EXAMPLES_LV1[한자] = [{{ w, r, d }}, ...]
//   w : 한자어 표기. 예 "苛斂"
//   r : 한글 읽기.   예 "가렴"
//   d : 뜻풀이
//
// app.js 의 examplesOf() 가 이 표를 먼저 봅니다. 여기 있는 글자는 우리말샘에서 받아온
// examples.js 대신 이쪽 용례가 나갑니다. 1급 신습한자(data.js 의 lv "10")만 들어 있어서
// 급수를 따로 가릴 필요가 없습니다.
//
// 1급 {total}자 가운데 {chars}자를 덮습니다. 나머지 {missing}자는 원본 뜻풀이 목록에
// 없거나(蟷/螳 같은 이체자, 娑婆를 裟婆로 적은 오타) 해서 examples.js 의 우리말샘
// 용례를 그대로 씁니다.

const EXAMPLES_LV1 = {{
"""


def main():
    text = hwp_text(HWP)
    words = parse_words(text)
    lv1 = level_chars(DATA, LEVEL_CODE)

    table = OrderedDict()
    for w, r, d in words:
        for ch in w:
            key = lv1.get(unicodedata.normalize("NFC", ch))
            if key:
                table.setdefault(key, []).append((w, r, d))

    lines = []
    for key, entries in table.items():
        items = ",".join(
            "{w:%s,r:%s,d:%s}" % (js_string(w), js_string(r), js_string(d))
            for w, r, d in entries
        )
        lines.append("  %s: [%s]," % (js_string(key), items))

    body = HEADER.format(
        today=date.today().isoformat(),
        chars=len(table),
        words=len(words),
        total=len(lv1),
        missing=len(lv1) - len(table),
    ) + "\n".join(lines) + "\n};\n"

    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(body)

    sys.stdout.reconfigure(encoding="utf-8")
    print("단어 %d / 1급 커버 %d자 (1급 %d자 중, 미커버 %d자)"
          % (len(words), len(table), len(lv1), len(lv1) - len(table)))
    print("미커버: " + " ".join(sorted(set(lv1.values()) - set(table))))
    print("-> " + OUT)


if __name__ == "__main__":
    main()
