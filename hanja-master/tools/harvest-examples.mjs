// 한자어 사용례 수확 — 서당개 김백국
//
// 국립국어원 「우리말샘」 오픈 API 로 배정한자별 한자어 예시를 모아 examples.js 를
// 생성합니다. 앱은 오프라인 PWA 이므로 실행 중에 API 를 부르지 않습니다. 이 스크립트를
// 개발 PC 에서 미리 돌려 만든 정적 파일만 앱에 실립니다.
//
// !! 사용례는 절대 손으로 지어내지 마세요. 5,978자 x 2개 = 약 12,000 항목이라
//    검증되지 않은 내용이 섞이면 학습자가 틀린 걸 외웁니다. 반드시 이 스크립트로
//    출처 있는 데이터만 넣습니다.
//
// ─── 인증키 ──────────────────────────────────────────────────────────
// 우리말샘 오픈 API 신청: https://opendict.korean.go.kr/service/openApiInfo
// 발급받은 키를 환경변수나 인자로 넘깁니다.
//
// ─── 사용법 ──────────────────────────────────────────────────────────
//   # 1단계 - 응답 구조 확인 (키 받은 직후 반드시 먼저 실행)
//   node tools/harvest-examples.mjs --key=KEY --probe=校
//
//   # 2단계 - 8급 50자만 시험 수확 후 품질 검수
//   node tools/harvest-examples.mjs --key=KEY --levels=8 --out=examples.8.js
//
//   # 3단계 - 전체 (중단해도 --resume 으로 이어서)
//   node tools/harvest-examples.mjs --key=KEY --resume
//
// ─── 옵션 ────────────────────────────────────────────────────────────
//   --key=...        인증키 (또는 환경변수 OPENDICT_KEY)
//   --probe=한자     한 글자만 조회해 원시 JSON 출력 후 종료
//   --levels=8,7II   대상 급수 (LEVELS[].code, 쉼표 구분). 생략하면 전체
//                    지정한 급수의 "신습한자"만. 누적 아님
//   --per=2          한자당 채택할 예시 개수 (기본 2)
//   --out=파일       출력 경로 (기본 examples.js)
//   --resume         체크포인트에서 이어서 수확
//   --concurrency=2  동시 요청 수 (기본 2. 공공 API 이므로 낮게 유지)
//   --delay=120      요청 간 간격 ms

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const API = "https://opendict.korean.go.kr/api/search";

// ─── 인자 파싱 ────────────────────────────────────────────────────────
const argv = new Map(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);
const opt = (k, d) => (argv.has(k) ? argv.get(k) : d);

const KEY = opt("key", process.env.OPENDICT_KEY);
const PER = Number(opt("per", 2));
const OUT = path.resolve(ROOT, String(opt("out", "examples.js")));
const CONCURRENCY = Number(opt("concurrency", 2));
const DELAY = Number(opt("delay", 120));
// 한 글자당 조회할 최대 페이지 수 — 폭주 방지용 안전장치입니다.
// 2~3음절로 좁힌 뒤에는 표본 120자 기준 평균 4.5페이지, 최대 19페이지였습니다.
const MAX_PAGES = Number(opt("max-pages", 40));
const RESUME = argv.has("resume");
const PROBE = opt("probe", null);
const CKPT = path.join(HERE, ".harvest-progress.json");

const SELFTEST = argv.has("selftest");

if (!KEY && !SELFTEST) {
  console.error(
    "인증키가 없습니다. --key=... 또는 환경변수 OPENDICT_KEY 를 설정하세요.\n" +
      "신청: https://opendict.korean.go.kr/service/openApiInfo"
  );
  process.exit(1);
}

// ─── data.js 읽기 ─────────────────────────────────────────────────────
// data.js 는 export 가 없는 순수 스크립트라 텍스트로 읽어 평가합니다.
function loadData() {
  const src = fs.readFileSync(path.join(ROOT, "data.js"), "utf8");
  return new Function(`${src}\nreturn { LEVELS, HANJA };`)();
}
const { LEVELS, HANJA } = loadData();

// 호환용 한자(U+F900~FAFF) 대응: 조회는 정규화한 글자로, 출력 키는 원본 그대로.
const nfc = (s) => String(s).normalize("NFC");

// 급수 순서 — 낮은 급수(=쉬운 한자)일수록 작은 값
const codeRank = new Map();
LEVELS.forEach((lv, i) => lv.codes.forEach((c) => codeRank.set(c, i)));

// 글자 -> 신습 급수 순위. 예시 한자어가 "이미 배운 글자로만 되어 있는지" 판정에 씁니다.
const rankOf = new Map();
for (const h of HANJA) rankOf.set(nfc(h.c), codeRank.get(h.lv) ?? 99);

// ─── 대상 선정 ────────────────────────────────────────────────────────
let targets = HANJA;
if (argv.has("levels")) {
  const want = new Set(String(opt("levels")).split(",").map((s) => s.trim()));
  const bad = [...want].filter((w) => !LEVELS.some((lv) => lv.code === w));
  if (bad.length) {
    console.error(`알 수 없는 급수: ${bad.join(", ")}`);
    console.error(`가능한 값: ${LEVELS.map((l) => l.code).join(", ")}`);
    process.exit(1);
  }
  const codes = new Set(LEVELS.filter((lv) => want.has(lv.code)).flatMap((lv) => lv.codes));
  targets = HANJA.filter((h) => codes.has(h.lv));
}

// ─── API 호출 ─────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// start 는 오프셋이 아니라 "페이지 번호"입니다 (num=100 이면 start=2 가 101~200번째).
//
// advanced=y 가 핵심입니다. 이걸 빼면 letter_s/letter_e(음절수) 가 조용히 무시돼
// 4자 이상 낱말 — 대부분 학교명·마을명 — 까지 전부 딸려 옵니다. 校 를 예로 들면
// 9,174건(93페이지)이 오지만, advanced=y + 2~3음절이면 434건(5페이지)으로 줄고
// 그 안에 學校·母校 가 다 들어 있습니다. 덕분에 표본이 아니라 전수로 모을 수 있습니다.
// (method=include 는 advanced=y 에서 "앞에 오는 것 ∪ 뒤에 오는 것" 으로 동작합니다)
async function fetchPage(char, start = 1) {
  const url = new URL(API);
  // target=2 -> 원어(原語) 검색, lang=2 -> 한자. 즉 "원어에 이 한자가 들어간 어휘".
  url.search = new URLSearchParams({
    key: KEY,
    q: nfc(char),
    req_type: "json",
    target: "2",
    lang: "2",
    method: "include",
    type1: "word", // 단어만 (구·관용구·속담 제외)
    type2: "chinese", // 한자어만
    num: "100",
    start: String(start),
    advanced: "y", // 아래 음절수 조건을 실제로 적용시키는 스위치
    letter_s: "2",
    letter_e: "3", // 2~3음절. 4자 이상은 사용례로 쓰지 않습니다
  }).toString();

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
      return await res.json();
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(500 * 2 ** attempt); // 지수 백오프
    }
  }
}

// ─── 응답 정규화 ──────────────────────────────────────────────────────
// 우리말샘 응답의 sense/origin 위치가 항목마다 흔들려서 방어적으로 훑습니다.
const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

function normalizeItems(json) {
  return asArray(json?.channel?.item).map((it) => {
    const sense = asArray(it.sense)[0] ?? {};
    return {
      word: String(it.word ?? sense.word ?? "").replace(/[-^]/g, ""), // 표제어의 붙임표 제거
      origin: String(it.origin ?? sense.origin ?? it.original_language ?? ""),
      definition: String(sense.definition ?? it.definition ?? "").trim(),
      pos: String(it.pos ?? sense.pos ?? ""),
      type: String(it.type ?? sense.type ?? ""), // 일반어 / 지역어 / 북한어 / 옛말
      cat: String(it.cat ?? sense.cat ?? ""), // 전문 분야
      // 우리말샘은 "뜻 하나 = 항목 하나"로 내려줍니다. 001 이 그 낱말의 대표 뜻이라
      // 이걸 우선하지 않으면 學校 가 "죄수들의 은어" 같은 곁뜻으로 뽑힙니다.
      senseNo: String(it.sense_no ?? sense.sense_no ?? ""),
    };
  });
}

// origin 은 "學校" 처럼 순수 한자일 때도 있고 "學校/학교" 나 주석이 섞일 때도 있어
// 한자만 뽑아냅니다.
const HANJA_RE = /[一-鿿㐀-䶿豈-﫿]/g;
// 이표기가 여럿이면 "蹂躪/蹂躙/蹂蹸" 처럼 / 로 이어 오므로 첫 표기만 씁니다.
// (안 자르면 9자로 세어져 글자수 검사에서 낱말이 통째로 탈락합니다)
const hanjaOnly = (s) => (nfc(String(s).split("/")[0]).match(HANJA_RE) ?? []).join("");

// 배정한자와 우리말샘이 쓰는 자형이 다른 글자들 (왼쪽이 data.js 의 자형).
// 각 쌍은 "그 자형으로 조회해 나온 낱말의 한글 읽기가 배정한자의 음과 맞는가"로
// 검증했습니다. 甦→蘇, 糢→模, 驩→歡 는 음만 비슷하고 실제로는 다른 글자라
// 넣지 않았습니다 — 넣으면 엉뚱한 낱말이 붙습니다.
// 자형을 바꿔치기하지 않고 조회할 때만 함께 봅니다. 열세 쌍 중 여덟은 오른쪽
// 자형도 배정한자여서, 치환하면 그 글자의 예시를 덮어쓰기 때문입니다.
const VARIANTS = new Map(Object.entries({
  絶: "絕", 豊: "豐", 姉: "姊", 獎: "奬", 隣: "鄰", 熔: "鎔", 煕: "熙",
  癎: "癇", 麪: "麵", 艶: "艷", 篡: "簒", 塚: "冢", 悧: "俐",
}));

// ─── 하드 제외 규칙 ───────────────────────────────────────────────────
// 우리말샘은 사용자 참여형이라 학교명·마을명이 대량 등록돼 있고, 그것이 검색
// 앞쪽을 채웁니다. 이건 난이도 문제가 아니라 "사용례로서 쓸모없음"이므로
// 완화 단계와 무관하게 항상 버립니다.
const PROPER_CAT = new Set(["지명", "인명", "책명", "작품명", "고유명 일반"]);
// cat 태깅이 빠진 항목 대비 — 뜻풀이 자체가 행정구역/학교 설명인 경우
const PLACE_DEF = /(에 있는|에 있던) (이|동|면|리|군|구|읍)\./;
const SCHOOL_DEF = /에 있는 (공립|사립|국립|시립|도립)?\s*[가-힣]*(초등학교|중학교|고등학교|대학교)/;
// 곁뜻 중에서도 학습에 부적절한 것
const SLANG_DEF = /은어로/;
// 인터넷 신조어 — 한자음과 읽기가 어긋납니다 (最高 를 "쵝오"로 싣는 항목이 있었음)
const NET_DEF = /인터넷|누리꾼|통신 언어/;
// 낱말 쓰임이 아니라 한자 자체를 설명하는 항목
const RADICAL_DEF = /한자 부수의 하나/;

// 분야·뜻풀이만 보고 판정합니다. 체크포인트에서 이어받은 낱말에도 그대로
// 적용할 수 있어야 해서, 수확 때와 선정 때 양쪽에서 부릅니다.
// (규칙을 추가하면 --resume 만으로 재수확 없이 다시 걸러집니다)
function badWord(cat, definition) {
  if (!definition) return true;
  if (PROPER_CAT.has(cat)) return true;
  return (
    PLACE_DEF.test(definition) || SCHOOL_DEF.test(definition) ||
    SLANG_DEF.test(definition) || NET_DEF.test(definition) ||
    RADICAL_DEF.test(definition)
  );
}

function rejected(it) {
  if (it.type && it.type !== "일반어") return true; // 북한어·옛말·지역어 제외
  return badWord(it.cat, it.definition);
}

// ─── 빈도 지표 ────────────────────────────────────────────────────────
// API 는 낱말의 사용 빈도를 알려주지 않습니다. 대신 "그 2자어를 품은 3자어가
// 사전에 몇 개나 있는가"를 씁니다. 흔한 낱말일수록 파생어가 많기 때문입니다.
// (敎育 62, 學生 50, 父母 32 vs 九軍 0, 女國 0, 木外 0 — 잘 갈립니다)
// 풀에 이미 3자어가 들어 있어 추가 요청이 전혀 들지 않습니다.
const derivCount = new Map();
function buildDerivCount(words) {
  derivCount.clear();
  for (const w of words) {
    if (w.hanja.length !== 3) continue;
    for (const sub of [w.hanja.slice(0, 2), w.hanja.slice(1, 3)]) {
      derivCount.set(sub, (derivCount.get(sub) ?? 0) + 1);
    }
  }
}

// ─── 후보 채점 ────────────────────────────────────────────────────────
function score(cand, selfRank) {
  let s = 0;

  // 파생어가 많은 = 실제로 자주 쓰이는 낱말을 우선합니다.
  s += Math.min(45, (derivCount.get(cand.hanja) ?? 0) * 2.5);

  // 2자 한자어가 시험에 가장 많이 나옵니다.
  if (cand.hanja.length === 2) s += 30;
  else if (cand.hanja.length === 3) s += 8;

  // 대표 뜻(001)이 그 낱말의 가장 흔한 의미입니다. 곁뜻은 크게 후순위로.
  if (cand.senseNo === "001") s += 40;
  else if (cand.senseNo === "002") s += 10;
  else if (cand.senseNo) s -= 10;

  // 핵심: 예시에 쓰인 다른 글자도 학습자가 이미 아는(같거나 낮은 급수) 글자인지.
  // 8급 배우는 사람에게 특급 한자가 섞인 예시를 주면 읽지도 못합니다.
  if (cand.others.length) {
    const worst = cand.worst;
    if (worst >= 99) s -= 40; // 배정한자 밖의 글자
    else if (worst <= selfRank) s += 45; // 전부 이미 배운 글자
    else if (worst <= selfRank + 2) s += 20; // 조금 위
    else s -= (worst - selfRank) * 3;
    // 같은 조건이면 더 흔한(낮은 급수) 글자로 된 낱말을 뽑습니다
    if (worst < 99) s += Math.max(0, 12 - worst);
  }

  if (cand.pos === "명사") s += 10;
  if (cand.cat) s -= 25; // 전문 분야 용어는 후순위

  // "‘빈빈하다’의 어근" 같은 항목은 뜻을 알려 주지 못합니다. 다만 벽자 중에는
  // 이런 것밖에 없는 글자도 있어, 제외하지 않고 크게 낮춰 최후 수단으로 둡니다.
  if (/의 어근\.?$/.test(cand.definition)) s -= 60;

  // 옛 용법·역사 용어는 지금 안 쓰는 말이라 사용례로 부적절합니다.
  const d = cand.definition;
  if (/예전에|옛말|달리 이르던 말/.test(d)) s -= 30;
  if (/중국.{0,4}나라|고려 시대|조선 시대|신라|고구려|백제/.test(d)) s -= 20;
  if (/달리 이르는 말|줄여 이르는 말/.test(d)) s -= 8;

  // 뜻풀이가 너무 길면 카드에 안 들어갑니다.
  if (d.length <= 40) s += 8;
  else if (d.length > 90) s -= 10;

  return s;
}

// 항목 하나를 "낱말"로 변환합니다. 기준 미달이면 null.
// 특정 한자에 매이지 않은 형태라, 한 번 찾은 낱말을 그 안에 든 모든 한자의
// 후보로 재사용할 수 있습니다 (敎室 은 敎 를 찾을 때도 室 을 찾을 때도 나옴).
function toWord(it) {
  if (rejected(it)) return null;
  const hanja = hanjaOnly(it.origin);
  if (hanja.length < 2 || hanja.length > 3) return null;
  const read = it.word.replace(/\s/g, "");
  if (!/^[가-힣]+$/.test(read)) return null; // 한글 표기만
  if (read.length !== hanja.length) return null; // 표기와 원어 글자수 일치
  return {
    hanja,
    read,
    definition: it.definition,
    senseNo: it.senseNo,
    pos: it.pos,
    cat: it.cat,
  };
}

// 같은 낱말이 뜻마다 따로 내려오므로 대표 뜻(001)을 우선해 하나만 남깁니다.
function betterWord(a, b) {
  if (!a) return b;
  const rank = (x) => (x.senseNo === "001" ? 0 : x.senseNo === "002" ? 1 : 2);
  if (rank(a) !== rank(b)) return rank(a) < rank(b) ? a : b;
  if (!!a.cat !== !!b.cat) return a.cat ? b : a;
  return a.definition.length <= b.definition.length ? a : b;
}

// 낱말 하나를 특정 한자의 후보로 평가합니다.
// tier = 완화 단계. 1이 가장 엄격하고, 낮은 단계로 못 채운 글자만 위 단계를 씁니다.
//   1) 2자 한자어 + 구성 글자가 전부 배정한자
//   2) 3자까지 허용 (구성 글자는 여전히 전부 배정한자)
//   3) 배정한자 밖 글자가 섞인 것까지 허용
function evaluate(word, c, selfRank) {
  // 사전이 다른 자형을 쓰는 글자는 그 자형도 "이 글자"로 인정합니다.
  const alias = VARIANTS.get(c);
  const isSelf = (x) => x === c || x === alias;
  if (![...word.hanja].some(isSelf)) return null;
  if (badWord(word.cat, word.definition)) return null; // 예전 규칙으로 담긴 풀 대비
  const others = [...word.hanja].filter((x) => !isSelf(x));
  const worst = others.length ? Math.max(...others.map((x) => rankOf.get(x) ?? 99)) : 0;
  const allAssigned = worst < 99;

  let tier;
  if (word.hanja.length === 2 && allAssigned) tier = 1;
  else if (allAssigned) tier = 2;
  else tier = 3;

  const cand = { ...word, others, worst, tier };
  return { ...cand, _s: score(cand, selfRank) };
}

// 모아 둔 후보에서 최종 PER 개를 고릅니다. 엄격한 단계를 먼저 소진하고,
// 모자랄 때만 다음 단계에서 채웁니다.
function pickFrom(cands) {
  const out = [];
  for (const tier of [1, 2, 3]) {
    if (out.length >= PER) break;
    const pool = cands
      .filter((c) => c.tier === tier && !out.some((o) => o.hanja === c.hanja))
      .sort((a, b) => b._s - a._s);
    out.push(...pool.slice(0, PER - out.length));
  }
  return out.map((c) => ({ w: c.hanja, r: c.read, d: c.definition, t: c.tier }));
}

// 찾은 낱말을 공용 풀에 모읍니다. 어떤 한자를 조회하다 나왔든, 그 낱말은
// 안에 든 모든 한자의 후보가 됩니다 — 요청을 더 쓰지 않고 후보만 크게 늘립니다.
function accumulate(pool, items) {
  for (const it of items) {
    const w = toWord(it);
    if (!w) continue;
    pool.set(w.hanja, betterWord(pool.get(w.hanja), w));
  }
}

// 풀에서 한 한자의 예시를 고릅니다.
function pickForChar(words, char) {
  const c = nfc(char);
  const selfRank = rankOf.get(c) ?? 99;
  const cands = [];
  for (const w of words) {
    const e = evaluate(w, c, selfRank);
    if (e) cands.push(e);
  }
  return pickFrom(cands);
}

// 항목 배열에서 바로 고릅니다 (selftest·probe 용 — 페이지 순회 없음).
function pick(items, char) {
  const pool = new Map();
  accumulate(pool, items);
  const words = [...pool.values()];
  buildDerivCount(words);
  return pickForChar(words, char);
}

// 한 글자를 조회해 나온 낱말을 공용 풀에 넣습니다. 2~3음절로 좁혀 두어 페이지가
// 적으므로(표본 평균 4.5페이지, 최대 19) 표본이 아니라 전 페이지를 훑습니다.
// 결과가 가나다순이라 일부만 보면 특정 자음에 쏠리는데, 전수로 받으면 그 편향이
// 아예 없어집니다. MAX_PAGES 는 예외적으로 긴 글자에 대한 안전장치입니다.
async function collectInto(pool, char) {
  let reqs = 0;
  const first = await fetchPage(char, 1);
  reqs++;
  accumulate(pool, normalizeItems(first));
  const pages = Math.max(1, Math.ceil((first?.channel?.total ?? 0) / 100));

  for (let p = 2; p <= Math.min(pages, MAX_PAGES); p++) {
    await sleep(DELAY);
    accumulate(pool, normalizeItems(await fetchPage(char, p)));
    reqs++;
  }
  return reqs;
}

// ─── 체크포인트 ───────────────────────────────────────────────────────
// 낱말 풀 전체를 저장합니다. 예시 선정은 수확이 다 끝난 뒤 한 번에 하므로,
// 중단됐다 이어받아도 그때까지 모은 낱말이 그대로 쓰입니다.
const pool = new Map();
let done = new Set();
if (RESUME && fs.existsSync(CKPT)) {
  const saved = JSON.parse(fs.readFileSync(CKPT, "utf8"));
  for (const w of saved.pool ?? []) pool.set(w.hanja, w);
  done = new Set(saved.done ?? []);
  console.log(`체크포인트에서 이어감: ${done.size}자 완료, 낱말 ${pool.size}개`);
}
const saveCkpt = () =>
  fs.writeFileSync(CKPT, JSON.stringify({ pool: [...pool.values()], done: [...done] }), "utf8");

// ─── selftest 모드 ────────────────────────────────────────────────────
// 인증키 없이 선별·채점 로직만 모의 데이터로 검증합니다. API 호출을 낭비하기 전에
// 필터가 제대로 걸리는지 확인하는 용도입니다.
if (SELFTEST) {
  const mock = {
    channel: {
      item: [
        // 정상 - 8급 글자로만 된 2자어. 최우선으로 뽑혀야 함
        { word: "학교", origin: "學校", pos: "명사", type: "일반어", sense: { definition: "학생에게 교육을 실시하는 기관." } },
        // 표제어에 붙임표가 섞인 경우
        { word: "교-실", origin: "校室", pos: "명사", type: "일반어", sense: { definition: "수업에 쓰는 방." } },
        // 북한어 - 제외되어야 함
        { word: "교사", origin: "校舍", pos: "명사", type: "북한어", sense: { definition: "북한에서 쓰는 말." } },
        // 뜻풀이 없음 - 제외
        { word: "교문", origin: "校門", pos: "명사", type: "일반어", sense: { definition: "" } },
        // 원어에 대상 한자가 없음 - 제외
        { word: "학생", origin: "學生", pos: "명사", type: "일반어", sense: { definition: "배우는 사람." } },
        // 표기와 원어 글자수 불일치 - 제외
        { word: "교", origin: "校長", pos: "명사", type: "일반어", sense: { definition: "글자수 안 맞음." } },
        // 전문용어 + 긴 뜻풀이 - 후순위
        { word: "교정쇄", origin: "校正刷", pos: "명사", type: "일반어", cat: "출판",
          sense: { definition: "인쇄물의 교정을 보기 위하여 임시로 조판한 것을 찍어 낸 종이로서 편집자가 오류를 확인하는 데 쓰는 것을 이른다." } },
        // 지명 (cat 태깅) - 제외되어야 함
        { word: "교동", origin: "校洞", pos: "명사", type: "일반어", cat: "지명",
          sense: { definition: "경상북도 경주시에 있는 이. 남쪽에 남천이 흐른다." } },
        // 지명 (cat 없음, 뜻풀이로만 판별) - 제외되어야 함
        { word: "교북", origin: "校北", pos: "명사", type: "일반어",
          sense: { definition: "서울특별시 종로구에 있는 동. 1914년에 이름이 바뀌었다." } },
        // 학교 고유명사 - 제외되어야 함
        { word: "한산초등학교", origin: "漢山初等學校", pos: "명사", type: "일반어",
          sense: { definition: "충청남도 서천군에 있는 공립 초등학교. 1922년에 개교하였다." } },
        // 은어 곁뜻 - 제외되어야 함
        { word: "교도", origin: "校道", pos: "명사", type: "일반어",
          sense: { definition: "죄수들의 은어로, ‘교도소’를 이르는 말." } },
      ],
    },
  };

  const items = normalizeItems(mock);
  const picked = pick(items, "校");

  // 대표 뜻(001) 우선 확인 — 같은 낱말의 곁뜻이 대표 뜻을 이기면 안 됩니다
  const senseMock = normalizeItems({
    channel: {
      item: [
        { word: "학교", origin: "學校", pos: "명사", type: "일반어", sense_no: "005",
          sense: { definition: "짧은 곁뜻." } },
        { word: "학교", origin: "學校", pos: "명사", type: "일반어", sense_no: "001",
          sense: { definition: "일정한 목적·교과 과정·설비·제도 및 법규에 의하여 계속적으로 학생에게 교육을 실시하는 기관." } },
      ],
    },
  });
  const senseBest = pick(senseMock, "校");

  // 폴백 단계 확인 — 2자로는 못 만들고 3자만 있는 글자
  const tierMock = normalizeItems({
    channel: {
      item: [
        { word: "교육열", origin: "校育熱", pos: "명사", type: "일반어", sense_no: "001",
          sense: { definition: "가르치려는 열의." } },
      ],
    },
  });
  const tierPick = pick(tierMock, "校");

  const checks = [
    ["정규화 11건", items.length === 11],
    ["붙임표 제거", items.some((i) => i.word === "교실")],
    ["채택 2건", picked.length === 2],
    ["1순위 學校", picked[0]?.w === "學校"],
    ["북한어 제외", !picked.some((p) => p.w === "校舍")],
    ["뜻풀이 없음 제외", !picked.some((p) => p.w === "校門")],
    ["대상 한자 없는 것 제외", !picked.some((p) => p.w === "學生")],
    ["글자수 불일치 제외", !picked.some((p) => p.r === "교")],
    ["읽기 채워짐", picked.every((p) => /^[가-힣]+$/.test(p.r))],
    ["지명 제외 (cat)", !picked.some((p) => p.w === "校洞")],
    ["지명 제외 (뜻풀이)", !picked.some((p) => p.w === "校北")],
    ["학교 고유명사 제외", !picked.some((p) => p.w === "漢山初等學校")],
    ["은어 곁뜻 제외", !picked.some((p) => p.w === "校道")],
    ["대표 뜻(001) 우선", senseBest[0]?.d.includes("교육을 실시하는 기관")],
    ["2자 우선 (1단계)", picked.every((p) => p.t === 1)],
    ["3자 폴백 (2단계)", tierPick[0]?.w === "校育熱" && tierPick[0]?.t === 2],
  ];

  // 호환용 한자 처리 확인 - 원본 金(U+F90A)이 데이터에 있으면 정규화로 순위를 찾아야 함
  const compat = HANJA.find((h) => h.c !== nfc(h.c));
  checks.push([
    `호환용 한자 정규화 (${compat ? compat.c : "없음"})`,
    !compat || rankOf.has(nfc(compat.c)),
  ]);

  let bad = 0;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? "OK  " : "FAIL"}  ${name}`);
    if (!ok) bad++;
  }
  console.log(`\n채택 결과:`);
  console.log(picked);
  console.log(`\n데이터: 한자 ${HANJA.length} / 급수 ${LEVELS.length}`);
  console.log(bad ? `\n${bad}건 실패` : `\n전부 통과`);
  process.exit(bad ? 1 : 0);
}

// ─── probe 모드 ───────────────────────────────────────────────────────
if (PROBE) {
  const raw = await fetchPage(PROBE, 1);
  console.log("─── 원시 응답 (앞부분) ───");
  console.log(JSON.stringify(raw, null, 2).slice(0, 3000));
  const items = normalizeItems(raw);
  console.log(`\n─── 정규화 결과 ${items.length}건 (앞 5건) ───`);
  console.log(items.slice(0, 5));
  console.log(`\n─── 1페이지만으로 채택 ───`);
  console.log(pick(items, PROBE));
  // 실제 수확과 같은 경로(페이지 고르게 뽑기 + 폴백)로도 한 번 뽑아 비교합니다
  const probePool = new Map();
  const reqs = await collectInto(probePool, PROBE);
  console.log(`\n─── 실제 수확 경로 (${reqs}페이지 조회, 낱말 ${probePool.size}개) ───`);
  console.log(pickForChar([...probePool.values()], PROBE));
  process.exit(0);
}

// ─── 본 수확 ──────────────────────────────────────────────────────────
// 사전 자형이 따로 있는 글자는 그 자형으로도 한 번 조회해야 낱말이 들어옵니다.
// (絕·姊·奬·熙·癇 은 배정한자가 아니라 대상 목록에 없습니다. 나머지 여덟 쌍은
//  오른쪽 자형도 배정한자라 어차피 조회되므로 중복은 아래에서 걸러집니다)
const assigned = new Set(HANJA.map((h) => nfc(h.c)));
const extra = [];
for (const h of targets) {
  const v = VARIANTS.get(nfc(h.c));
  if (v && !assigned.has(v) && !extra.some((e) => e.c === v)) extra.push({ c: v, lv: h.lv });
}

const todo = [...targets, ...extra].filter((h) => !done.has(h.c));
console.log(
  `대상 ${targets.length}자${extra.length ? ` (+이체자 ${extra.length}자)` : ""}` +
    ` / 남은 ${todo.length}자 / 동시 ${CONCURRENCY}`
);

let processed = 0;
let failed = [];
let totalReqs = 0; // 하루 5만 건 한도가 있어 실제 요청량을 지켜봅니다
const t0 = Date.now();

async function worker(queue) {
  while (queue.length) {
    const h = queue.shift();
    try {
      // await 앞뒤로 나눠야 합니다. `totalReqs += await ...` 는 await 이전 값을
      // 읽어 두므로 동시 실행 시 갱신이 유실됩니다.
      const reqs = await collectInto(pool, h.c);
      totalReqs += reqs;
      done.add(h.c);
    } catch (e) {
      failed.push({ c: h.c, err: String(e.message ?? e) });
    }
    processed++;
    if (processed % 50 === 0) {
      const rate = processed / ((Date.now() - t0) / 1000);
      const left = Math.round((todo.length - processed) / rate);
      console.log(
        `  ${processed}/${todo.length}  낱말 ${pool.size}개  실패 ${failed.length}  ` +
          `요청 ${totalReqs}건  남은시간 ~${Math.floor(left / 60)}분`
      );
      // 풀이 커서 저장이 무거우므로 200자마다만 기록합니다
      if (processed % 200 === 0) saveCkpt();
    }
    await sleep(DELAY);
  }
}

const queue = [...todo];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
saveCkpt();

// ─── 예시 선정 ────────────────────────────────────────────────────────
// 수확이 끝난 뒤 공용 풀에서 글자별로 고릅니다. 한자별 후보를 빨리 찾도록
// 글자 -> 낱말 색인을 먼저 만듭니다 (풀이 수십만 개라 전수 탐색은 느립니다).
console.log(`\n낱말 ${pool.size}개에서 예시 선정 중...`);
buildDerivCount(pool.values());
const byChar = new Map();
for (const w of pool.values()) {
  for (const ch of new Set(w.hanja)) {
    let arr = byChar.get(ch);
    if (!arr) byChar.set(ch, (arr = []));
    arr.push(w);
  }
}

const result = {};
for (const h of targets) {
  const c = nfc(h.c);
  const alias = VARIANTS.get(c);
  const cands = [...(byChar.get(c) ?? []), ...(alias ? byChar.get(alias) ?? [] : [])];
  const picked = pickForChar(cands, h.c);
  if (picked.length) result[h.c] = picked;
}

// ─── 출력 ─────────────────────────────────────────────────────────────
// 데이터 순서를 data.js 와 맞춰 diff 를 읽기 쉽게 합니다.
const ordered = HANJA.filter((h) => result[h.c]);
const lines = ordered.map((h) => {
  const arr = result[h.c]
    .map((e) => `{w:${JSON.stringify(e.w)},r:${JSON.stringify(e.r)},d:${JSON.stringify(e.d)}}`)
    .join(",");
  return `  ${JSON.stringify(h.c)}: [${arr}],`;
});

const header = `// 한자어 사용례 — 서당개 김백국
//
// !! 자동 생성 파일입니다. 손으로 고치지 마세요.
//    tools/harvest-examples.mjs 로 다시 생성합니다.
//
// 출처: 국립국어원 「우리말샘」 (https://opendict.korean.go.kr)
//       오픈 API /api/search — target=2(원어) lang=2(한자) type2=chinese
// 수확일: ${new Date().toISOString().slice(0, 10)}
// 수록: ${ordered.length}자 / ${ordered.reduce((n, h) => n + result[h.c].length, 0)}항목
//
// 구조: EXAMPLES[한자] = [{ w, r, d }, ...]
//   w : 한자어 표기. 예 "學校"
//   r : 한글 읽기.   예 "학교"
//   d : 뜻풀이 (우리말샘 원문)
//
// 키는 data.js 의 HANJA[].c 와 같은 문자열입니다. 원본이 호환용 한자
// (U+F900~FAFF)로 인코딩한 9자가 있어 정규화하면 키가 어긋납니다.
// 조회는 EXAMPLES[h.c] 로 하세요.
//
// 우리말샘은 사용자 참여형 사전이라 표준국어대사전에 없는 어휘도 있습니다.
// 급수별 검수 후 반영하는 것을 권장합니다.

const EXAMPLES = {
`;

fs.writeFileSync(OUT, header + lines.join("\n") + "\n};\n", "utf8");

const total = ordered.reduce((n, h) => n + result[h.c].length, 0);
console.log(`\n완료 — ${path.relative(ROOT, OUT)}`);
console.log(`  수록 ${ordered.length}자 / ${total}항목`);
console.log(`  예시 없음 ${targets.length - ordered.length}자`);
if (totalReqs) console.log(`  API 요청 ${totalReqs.toLocaleString()}건`);

// 완화 단계 분포 — 2단계·3단계가 많으면 그 급수는 눈으로 더 봐야 합니다.
const tiers = [0, 0, 0, 0];
for (const h of ordered) for (const e of result[h.c]) tiers[e.t ?? 1]++;
console.log(
  `  단계별: 1단계(2자·배정한자) ${tiers[1]} / 2단계(3자) ${tiers[2]} / 3단계(배정한자 밖) ${tiers[3]}`
);
if (failed.length) {
  console.log(`  실패 ${failed.length}자 — --resume 으로 재시도하세요`);
  console.log(`  ${failed.slice(0, 10).map((f) => f.c).join(" ")}`);
}
