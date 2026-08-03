// 구성원리(자원) 데이터 생성 — 서당개 김백국
//
// 배정한자 5,978자의 "이 글자가 왜 이렇게 생겼는지"를 origin.js 로 만듭니다.
// 앱 실행 중에는 이 스크립트를 부르지 않고 정적 origin.js 만 씁니다.
//
//   node tools/build-origin.mjs              원본을 받아서 origin.js 생성
//   node tools/build-origin.mjs --report     생성 없이 커버리지만 출력
//
// ─── 출처 ────────────────────────────────────────────────────────────
// cjkvi-ids   글자 분해(IDS)          CC BY-SA        github.com/cjkvi/cjkvi-ids
// makemeahanzi 육서 분류 + 성분 + 자원 LGPL / Arphic   github.com/skishore/makemeahanzi
// Unihan       한국 음(kHangul)        Unicode License unicode.org/Public/UCD
//
// !! 네이버 한자사전·e-hanja.kr 등 상업용 사전 콘텐츠는 쓰지 않았습니다.
//
// ─── 왜 유형별로 다르게 처리하는가 ───────────────────────────────────
// makemeahanzi 의 영어 hint 는 유형마다 품질이 완전히 다릅니다.
//   형성(pictophonetic) : hint 가 "wood" 수준으로 부실. 대신 semantic/phonetic
//                         성분이 97% 명시돼 있어 한국어 문장을 직접 조합합니다.
//   회의·지사·상형       : hint 가 이미 좋은 풀이 문장입니다.
//                         ("A woman 女 safe in a house 宀")
//                         -> 영어라서 번역이 필요하고, 그건 2단계입니다.
//                            여기서는 en 필드에 원문만 담아 둡니다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const CACHE = path.join(HERE, ".origin-cache");

const SOURCES = {
  ids: "https://raw.githubusercontent.com/cjkvi/cjkvi-ids/master/ids.txt",
  mmah: "https://raw.githubusercontent.com/skishore/makemeahanzi/master/dictionary.txt",
  unihan: "https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip",
};

// ─── 부수 변형체 훈음 ──────────────────────────────────────────────────
// 성분으로 등장하는 글자 1,755자 중 1,075자는 배정한자에 훈음이 있지만,
// 나머지는 대부분 부수 변형체(氵 艹 亻 …)라 data.js 에서 찾을 수 없습니다.
// 빈도순으로 자주 나오는 것들을 표준 부수 명칭으로 적어 둡니다.
// 괄호 안은 우리말 부수 이름입니다.
const PART_NAMES = {
  "氵": "물 수(삼수변)",        "艹": "풀 초(초두머리)",
  "亻": "사람 인(사람인변)",    "扌": "손 수(재방변)",
  "糹": "실 사(실사변)",        "纟": "실 사(실사변)",
  "忄": "마음 심(심방변)",      "辶": "쉬엄쉬엄 갈 착(책받침)",
  "辵": "쉬엄쉬엄 갈 착",       "阝": "언덕 부/고을 읍",
  "疒": "병들 녁(병질엄)",      "宀": "집 면(갓머리)",
  "𧾷": "발 족(발족변)",        "丿": "삐침 별",
  "广": "집 엄(엄호)",          "亠": "돼지해머리",
  "彳": "조금 걸을 척(두인변)", "冖": "덮을 멱(민갓머리)",
  "犭": "개 견(개사슴록변)",    "衤": "옷 의(옷의변)",
  "刂": "칼 도(선칼도방)",      "攵": "칠 복(등글월문)",
  "飠": "밥 식(밥식변)",        "钅": "쇠 금(쇠금변)",
  "釒": "쇠 금(쇠금변)",        "灬": "불 화(연화발)",
  "礻": "보일 시(보일시변)",    "罒": "그물 망",
  "⺮": "대 죽(대죽머리)",      "訁": "말씀 언(말씀언변)",
  "讠": "말씀 언(말씀언변)",    "爫": "손톱 조(손톱조머리)",
  "耂": "늙을 로(늙을로엄)",    "虍": "범 호(범호엄)",
  "牜": "소 우(소우변)",        "𤣩": "구슬 옥(구슬옥변)",
  "王": "구슬 옥(구슬옥변)",    "𠂉": "사람 인",
  "卩": "병부 절",              "厶": "사사 사",
  "廴": "길게 걸을 인(민책받침)", "匚": "상자 방(터진입구몸)",
  "匸": "감출 혜",              "勹": "쌀 포(쌀포몸)",
  "冫": "얼음 빙(이수변)",      "凵": "입 벌릴 감(위튼입구몸)",
  "几": "안석 궤",              "廾": "받들 공(스물입발)",
  "弋": "주살 익",              "彐": "돼지머리 계(튼가로왈)",
  "彑": "돼지머리 계",          "彡": "터럭 삼",
  "夂": "뒤져올 치",            "夊": "천천히 걸을 쇠",
  "尢": "절름발이 왕",          "巛": "내 천",
  "幺": "작을 요",              "廿": "스물 입",
  "爻": "점괘 효",              "疋": "짝 필",
  "癶": "걸을 발(필발머리)",    "肀": "붓 율",
  "舛": "어그러질 천",          "艮": "괘 이름 간",
  "襾": "덮을 아",              "覀": "덮을 아",
  "釆": "분별할 변",            "镸": "길 장",
  "鬥": "싸울 투",              "鬯": "울창주 창",
  "鬲": "솥 력",                "禸": "짐승 발자국 유",
  "歺": "부서진 뼈 알",         "歹": "부서진 뼈 알",
  "屮": "싹날 철",              "巜": "도랑 괴",
  "丬": "조각 장",              "爿": "조각 장",
  "旡": "목멜 기",              "殳": "몽둥이 수",
  "毋": "말 무",                "氏": "각시 씨",
  "牙": "어금니 아",            "瓦": "기와 와",
  "甘": "달 감",                "生": "날 생",
  "用": "쓸 용",                "皮": "가죽 피",
  "皿": "그릇 명",              "矛": "창 모",
  "禾": "벼 화",                "穴": "구멍 혈",
  "丨": "뚫을 곤",              "丶": "점 주",
  "儿": "어진사람 인(어진사람인발)", "囗": "에워쌀 위(큰입구몸)",
  "厂": "기슭 엄(민엄호)",      "丷": "여덟 팔",
  "乚": "새 을",                "户": "지게 호",
  "戶": "지게 호",              "亍": "자축거릴 촉",
  "髟": "터럭 발(터럭발머리)",  "靑": "푸를 청",
  "青": "푸를 청",              "隹": "새 추",
  "⺼": "고기 육(육달월)",       "吅": "부르짖을 훤",
  "亼": "삼합 집",              "𦍌": "양 양",
  "巠": "물줄기 경",            "夋": "천천히 걸을 준",
  "翏": "높이 날 료",           "睪": "엿볼 역",
  "叚": "빌 가",                "咅": "침 뱉을 부",
  "戔": "쌓일 전",              "禺": "원숭이 우",
  "雚": "황새 관",              "𤇾": "등불 형",
  // Unihan 이체자 표에 안 걸리는 일본 신자체 자형
  "尚": "오히려 상",            "温": "따뜻할 온",
  "収": "거둘 수",              "𠂊": "쌀 포",
  "𩙿": "밥 식(밥식변)",         "丂": "공교할 교",
  "龶": "예쁠 봉",              "円": "둥글 원",
};

// cjkvi-ids 는 인코딩되지 않은 모양을 ①②③ 이나 가타카나(コ) 같은 기호로 대신
// 적어 둡니다. 그런 것이 성분으로 새어 들어가지 않게 한자 영역만 통과시킵니다.
function isHanja(ch) {
  const cp = ch.codePointAt(0);
  return (cp >= 0x4e00 && cp <= 0x9fff)    // CJK 통합한자
      || (cp >= 0x3400 && cp <= 0x4dbf)    // 확장 A
      || (cp >= 0x20000 && cp <= 0x3ffff)  // 확장 B 이상
      || (cp >= 0x2e80 && cp <= 0x2ef3)    // 부수 보충 (⺮ ⺼ …)
      || (cp >= 0x2f00 && cp <= 0x2fd5)    // 강희 부수
      || (cp >= 0xf900 && cp <= 0xfaff);   // 호환용 한자
}

// ─── 유틸 ─────────────────────────────────────────────────────────────
const nfc = s => s.normalize("NFC");
const log = (...a) => console.log(...a);

async function fetchCached(name, url) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, name);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  log(`  내려받는 중: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
  return buf;
}

// Unihan.zip 안의 Unihan_Readings.txt 만 꺼냅니다 (zip 라이브러리 없이 직접 파싱).
function unzipEntry(zipBuf, wantName) {
  // End of central directory 를 뒤에서부터 찾습니다
  let eocd = -1;
  for (let i = zipBuf.length - 22; i >= 0; i--) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("zip: EOCD 를 찾지 못했습니다");
  let off = zipBuf.readUInt32LE(eocd + 16);
  const count = zipBuf.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    if (zipBuf.readUInt32LE(off) !== 0x02014b50) throw new Error("zip: 중앙 디렉터리 손상");
    const method = zipBuf.readUInt16LE(off + 10);
    const compSize = zipBuf.readUInt32LE(off + 20);
    const nameLen = zipBuf.readUInt16LE(off + 28);
    const extraLen = zipBuf.readUInt16LE(off + 30);
    const commentLen = zipBuf.readUInt16LE(off + 32);
    const localOff = zipBuf.readUInt32LE(off + 42);
    const name = zipBuf.subarray(off + 46, off + 46 + nameLen).toString("utf8");
    if (name === wantName) {
      // 로컬 헤더의 가변 길이는 중앙 디렉터리 값과 다를 수 있어 다시 읽습니다
      const lNameLen = zipBuf.readUInt16LE(localOff + 26);
      const lExtraLen = zipBuf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const raw = zipBuf.subarray(start, start + compSize);
      return method === 0 ? raw : zlib.inflateRawSync(raw);
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`zip: ${wantName} 이 없습니다`);
}

// ─── 원본 파싱 ────────────────────────────────────────────────────────
function loadHanja() {
  const src = fs.readFileSync(path.join(ROOT, "data.js"), "utf8");
  return new Function(src + "; return HANJA;")();
}

// cjkvi-ids: "U+6821<TAB>校<TAB>⿰木交[GTKV]" — 지역 마커 [GTKV] 를 반드시 걷어냅니다.
// 안 걷으면 '[' ']' 'G' 'T' 'K' 'J' 'V' 가 성분으로 잡혀 빈도 1~3위를 차지합니다.
const IDC = /[⿰-⿻]/;             // ⿰⿱⿲… 구성 기호
const REGION = /\[[A-Z]*\]/g;              // [GTKV] 같은 지역 표기
function loadIds(text) {
  const map = new Map();
  for (const line of text.split("\n")) {
    if (!line || line[0] === "#") continue;
    const cols = line.split("\t");
    if (cols.length < 3) continue;
    const ch = nfc(cols[1]);
    // 한 글자에 자형별 IDS 가 여러 줄 붙습니다.
    //   U+9751  靑  ⿱龶円[GT]  ⿱龶丹[JK]
    // 우리는 한국 자형을 쓰므로 [K] 가 붙은 것을 가장 먼저 고릅니다.
    // 그 다음이 지역 표기가 없는(공통) 것, 마지막이 아무거나입니다.
    const cand = cols.slice(2).map(s => s.trim()).filter(Boolean);
    const pick = cand.find(s => /\[[A-Z]*K[A-Z]*\]/.test(s))
              ?? cand.find(s => !s.includes("["))
              ?? cand[0];
    if (!pick) continue;
    map.set(ch, pick.replace(REGION, ""));
  }
  return map;
}
function componentsOf(idsMap, ch) {
  const ids = idsMap.get(ch);
  if (!ids) return [];
  const out = [];
  for (const c of ids) {
    if (IDC.test(c) || !isHanja(c)) continue;   // 구성 기호·？·①·コ 등 제외
    const n = nfc(c);
    if (n === ch) continue;                     // 자기 자신은 분해가 아님
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

function loadMmah(text) {
  const map = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    map.set(nfc(o.character), o);
  }
  return map;
}

// 배정한자는 정자체(尙 內 靑)를, cjkvi-ids 는 신자체(尚 内 青)를 쓰는 경우가 있어
// 같은 글자인데도 훈음 조회가 빗나갑니다. Unihan 의 이체자 정보로 이어 줍니다.
function loadVariants(text) {
  const map = new Map();
  const WANT = new Set([
    "kZVariant", "kSemanticVariant", "kSpecializedSemanticVariant",
    "kSimplifiedVariant", "kTraditionalVariant",
  ]);
  for (const line of text.split("\n")) {
    if (!line || line[0] === "#") continue;
    const [cp, field, val] = line.split("\t");
    if (!WANT.has(field) || !val) continue;
    const from = String.fromCodePoint(parseInt(cp.slice(2), 16));
    // "U+5C19<kSemanticVariant U+5C1A" 처럼 뒤에 출처가 붙기도 합니다
    for (const tok of val.split(" ")) {
      const m = /^U\+([0-9A-F]+)/.exec(tok);
      if (!m) continue;
      const to = String.fromCodePoint(parseInt(m[1], 16));
      if (to === from) continue;
      // 양방향으로 넣습니다. Unihan 은 한쪽에만 적어 두는 경우가 많아
      // (尙 -> 尚 은 있는데 尚 -> 尙 은 없는 식) 한 방향만 보면 놓칩니다.
      for (const [a, b] of [[from, to], [to, from]]) {
        if (!map.has(a)) map.set(a, []);
        if (!map.get(a).includes(b)) map.get(a).push(b);
      }
    }
  }
  return map;
}

function loadHangul(text) {
  const map = new Map();
  for (const line of text.split("\n")) {
    if (!line || line[0] === "#") continue;
    const [cp, field, val] = line.split("\t");
    if (field !== "kHangul" || !val) continue;
    // "교:0E" 형태 -> 첫 음절만
    map.set(String.fromCodePoint(parseInt(cp.slice(2), 16)), val.split(" ")[0].split(":")[0]);
  }
  return map;
}

// ─── 본체 ─────────────────────────────────────────────────────────────
const TYPE_KO = { pictophonetic: "형성", ideographic: "회의", pictographic: "상형" };

async function main() {
  const reportOnly = process.argv.includes("--report");

  log("원본 준비...");
  const [idsBuf, mmahBuf, unihanBuf] = await Promise.all([
    fetchCached("ids.txt", SOURCES.ids),
    fetchCached("dictionary.txt", SOURCES.mmah),
    fetchCached("Unihan.zip", SOURCES.unihan),
  ]);
  const idsMap = loadIds(idsBuf.toString("utf8"));
  const mmah = loadMmah(mmahBuf.toString("utf8"));
  const hangul = loadHangul(unzipEntry(unihanBuf, "Unihan_Readings.txt").toString("utf8"));
  const variants = loadVariants(unzipEntry(unihanBuf, "Unihan_Variants.txt").toString("utf8"));

  const HANJA = loadHanja();
  const byChar = new Map(HANJA.map(h => [nfc(h.c), h]));
  log(`  배정한자 ${HANJA.length}자 / IDS ${idsMap.size} / makemeahanzi ${mmah.size} / kHangul ${hangul.size}`);

  // 성분 훈음: 배정한자 > 부수 테이블 > Unihan 음만
  const parts = {};
  const partName = ch => {
    const h = byChar.get(ch);
    if (h) return `${h.h} ${h.s}`;
    if (PART_NAMES[ch]) return PART_NAMES[ch];
    // 이체자로 한 번 더 (尚 -> 尙, 内 -> 內, 青 -> 靑 …)
    for (const v of variants.get(ch) ?? []) {
      const hv = byChar.get(nfc(v));
      if (hv) return `${hv.h} ${hv.s}`;
      if (PART_NAMES[v]) return PART_NAMES[v];
    }
    const eum = hangul.get(ch) ?? (variants.get(ch) ?? []).map(v => hangul.get(v)).find(Boolean);
    return eum ? eum : null;              // 음만이라도 있으면 표시
  };

  const ORIGIN = {};
  const stat = { 형성: 0, 회의: 0, 상형: 0, 분해만: 0, 없음: 0, 훈음없는성분: new Map() };

  // 배정한자는 정자체(敎 U+654E)를 쓰는데 원본은 신자체(教 U+6559)로 수록한
  // 경우가 있습니다. 자원(육서·성분)은 글자 단위 사실이라 이체자로 이어 붙여도
  // 맞지만, **분해는 이어 붙이면 안 됩니다** — 분해는 그 자형의 획 구성이라
  // 다른 자형의 것을 가져오면 靑 -> 龶+円, 門 -> 𠁣+𠃛 처럼 엉뚱해집니다.
  const variantsOf = c => (variants.get(c) ?? []).map(nfc);
  let bridged = 0;

  for (const h of HANJA) {
    const c = nfc(h.c);
    let ety = mmah.get(c)?.etymology;
    if (!ety) {
      for (const v of variantsOf(c)) {
        ety = mmah.get(v)?.etymology;
        if (ety) { bridged++; break; }
      }
    }
    let comps = componentsOf(idsMap, c);   // 본 글자의 분해만 씁니다
    // 성분이 전부 훈음 없는 획 조각이면(𠁣 𠃛 龶 …) 보여줘도 도움이 안 되므로 버립니다
    if (comps.length && !comps.some(p => partName(p))) comps = [];
    const rec = {};

    if (ety) {
      rec.t = TYPE_KO[ety.type] ?? null;
      if (ety.type === "pictophonetic" && ety.semantic && ety.phonetic) {
        rec.s = nfc(ety.semantic);
        rec.p = nfc(ety.phonetic);
      } else if (ety.hint) {
        // 회의·지사·상형의 영어 풀이. 2단계에서 x(한국어)로 옮깁니다.
        rec.en = ety.hint;
      }
    }
    if (comps.length) rec.d = comps;

    // 화면에 실제로 그릴 게 있어야 넣습니다. 유형만 있고 성분도 풀이도 없으면
    // "회의" 라는 딱지 하나만 뜨는 꼴이라 도움이 안 됩니다.
    if (!(rec.s && rec.p) && !rec.d && !rec.en) { stat.없음++; continue; }

    ORIGIN[c] = rec;
    if (rec.t === "형성") stat.형성++;
    else if (rec.t === "회의") stat.회의++;
    else if (rec.t === "상형") stat.상형++;
    else stat.분해만++;

    // 화면에 띄울 성분의 훈음을 모읍니다
    for (const p of [...(rec.d ?? []), rec.s, rec.p].filter(Boolean)) {
      if (parts[p] !== undefined) continue;
      const name = partName(p);
      if (name) parts[p] = name;
      else stat.훈음없는성분.set(p, (stat.훈음없는성분.get(p) ?? 0) + 1);
    }
  }

  // ─── 리포트 ───
  const tot = HANJA.length, pc = n => `${n} (${(n / tot * 100).toFixed(1)}%)`;
  log("");
  log("  형성 (성분으로 문장 조합)  :", pc(stat.형성));
  log("  회의 (영어 풀이 -> 2단계)  :", pc(stat.회의));
  log("  상형 (영어 풀이 -> 2단계)  :", pc(stat.상형));
  log("  분해만                     :", pc(stat.분해만));
  log("  ──────────────────────────────");
  log("  origin.js 수록             :", pc(Object.keys(ORIGIN).length));
  log("  정보 없음                  :", pc(stat.없음));
  log(`  (이체자로 이어 붙인 글자   : ${bridged}자 — 敎/教 처럼 자형이 다른 경우)`);
  log("");
  log(`  성분 훈음 확보 : ${Object.keys(parts).length}개`);
  log(`  훈음 못 찾음   : ${stat.훈음없는성분.size}개 (글자만 표시됩니다)`);
  if (stat.훈음없는성분.size) {
    const top = [...stat.훈음없는성분.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    log(`    자주 나오는 것: ${top.map(([c, n]) => `${c}(${n})`).join(" ")}`);
  }
  const needTrans = stat.회의 + stat.상형;
  log("");
  log(`  2단계 번역 대상 : ${needTrans}건`);

  if (reportOnly) return;

  // ─── origin.js 쓰기 ───
  const today = new Date().toISOString().slice(0, 10);
  const head = `// 한자 구성원리(자원) — 서당개 김백국
//
// !! 자동 생성 파일입니다. 손으로 고치지 마세요.
//    tools/build-origin.mjs 로 다시 생성합니다.
//
// 출처: cjkvi-ids (CHISE, CC BY-SA)          — 글자 분해
//       makemeahanzi (LGPL / Arphic)          — 육서 분류·성분·자원
//       Unihan Database (Unicode)             — 성분의 한국 음
// 생성일: ${today}
// 수록: ${Object.keys(ORIGIN).length}자 / 성분 훈음 ${Object.keys(parts).length}개
//
// !! 기계 판정이라 어문회 시험의 육서 분류와 항상 일치하지는 않습니다.
//    학습 보조용 참고 자료로만 쓰세요.
//
// 구조: ORIGIN[한자] = { t, d, s, p, en, x }
//   t  : 유형 "형성" | "회의" | "상형" (없으면 미상)
//   d  : 분해 성분. 예 ["木","交"]
//   s  : 뜻을 담당하는 성분 (형성자)
//   p  : 음을 담당하는 성분 (형성자)
//   en : 영어 자원 풀이 원문 (회의·상형)
//   x  : 한국어 자원 풀이. tools/translate-origin.mjs 로 채웁니다
//
//       PARTS[성분] = "훈음"   예 PARTS["氵"] = "물 수(삼수변)"
`;

  const body =
    "const ORIGIN = " + JSON.stringify(ORIGIN) + ";\n" +
    "const PARTS = " + JSON.stringify(parts) + ";\n";

  const out = path.join(ROOT, "origin.js");
  fs.writeFileSync(out, head + "\n" + body, "utf8");
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  log("");
  log(`  -> origin.js 생성 완료 (${kb} KB)`);
}

main().catch(e => { console.error("실패:", e.message); process.exit(1); });
