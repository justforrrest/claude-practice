// ===== 서당개김백국 =====

const STORE_KEY = "hanja-master-v1";
let state = {
  level: "8",
  scope: "cumulative", // "cumulative" = 시험 범위(누적) | "new" = 신습한자만
  wrong: {},   // { "漢": count }  퀴즈 오답 횟수
  quizOk: {},  // { "漢": true }   퀴즈에서 맞힌 글자 (홈 학습율용)
  know: {},    // { "漢": "no" | "maybe" | "yes" }  읽기 자가평가
  knowW: {},   // 쓰기 자가평가 — 읽을 줄 알아도 쓸 줄은 모를 수 있어 따로 둡니다
  // 읽기 탭 학습 설정
  flash: {
    showReading: true,  // 뒷면에 훈·음 표시
    showStroke: true,   // 뒷면에 총획 표시
    showRadical: true,  // 뒷면에 부수 표시
    yes: true,          // 아는 글자 포함
    maybe: true,        // 헷갈리는 글자 포함
    no: true,           // 모르는 글자(미평가 포함) 포함
  },
  // 하루 학습량 목표. 자가평가를 누른 글자 수로 자동 집계합니다.
  daily: {
    read: 20,        // 하루 읽기 목표 자수 (0 = 목표 끔)
    write: 10,       // 하루 쓰기 목표 자수
    date: "",        // 집계 기준 날짜 "2026-07-30"
    readChars: [],   // 오늘 평가한 읽기 글자 — 같은 글자를 다시 평가해도 한 번만 셉니다
    writeChars: [],
    cheered: [],     // 오늘 축하 알림을 이미 띄운 모드 ["read", "write"]
  },
  // 마지막으로 보던 카드 (홈의 "이어서 학습하기"용)
  resume: null, // { level, scope, c }
};

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) state = Object.assign(state, JSON.parse(raw));
  } catch (e) {}
  // 예전 버전에 저장된 급수코드(준5, 준2 등)는 더 이상 없으므로 8급으로 되돌림
  if (!LEVELS.some(l => l.code === state.level)) state.level = "8";
  if (state.scope !== "new") state.scope = "cumulative";
  // 예전 저장본에는 flash 설정이 없으므로 기본값을 채워 넣음
  state.flash = Object.assign(
    { showReading: true, showStroke: true, showRadical: true, yes: true, maybe: true, no: true },
    state.flash || {}
  );
  // 쓰기 탭 설정 (fullRange=true 면 공식 쓰기 범위 대신 읽기 범위 전체를 씁니다)
  state.write = Object.assign(
    { yes: true, maybe: true, no: true, fullRange: false, speed: 1 },
    state.write || {}
  );
  if (![1, 2, 3].includes(state.write.speed)) state.write.speed = 1;
  // 하루 학습량 목표 (예전 저장본에는 없음)
  state.daily = Object.assign(
    { read: 20, write: 10, date: "", readChars: [], writeChars: [], cheered: [] },
    state.daily || {}
  );
  state.knowW = state.knowW || {};
  state.quizOk = state.quizOk || {}; // 예전 저장본에는 없음
  delete state.fav; // 즐겨찾기 기능은 제거됨
  rollDaily(); // 날짜가 넘어갔으면 오늘치 집계를 비웁니다
}
function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

// 어문회 급수는 누적식이므로, 한 급수의 시험 범위는 그 급수 이하 전부입니다.
// scope="cumulative" -> 8급~선택급수의 모든 신습코드 (실제 시험 범위)
// scope="new"        -> 선택급수의 신습한자만
function levelCodes(levelCode, scope) {
  const i = LEVELS.findIndex(l => l.code === levelCode);
  if (i < 0) return [];
  const picked = scope === "new" ? [LEVELS[i]] : LEVELS.slice(0, i + 1);
  return picked.flatMap(l => l.codes);
}

// 카드 뒷면에 보여줄 훈·음 문자열.
// 어문회 대표훈음 원문 그대로. 훈·음·장음 표기(:, (:))·복수 훈음 구분자(|)를
// 손대지 않고 한 줄에 같은 글꼴·크기로 보여줍니다.
//   韓 -> 한국/나라 한(:)
//   金 -> 쇠 금 | 성(姓) 김
//   北 -> 북녘 북 | 달아날 배:
function readingText(item) {
  return item.hs;
}

// 한자의 lv 코드("80","72"...)로 급수 이름을 찾습니다. 예: "72" -> "7급II"
function levelNameOf(lvCode) {
  const lv = LEVELS.find(l => l.codes.includes(lvCode));
  return lv ? lv.name : lvCode;
}

// 가나다순 — 음(s)이 먼저, 같으면 훈(h), 그래도 같으면 한자(c)로 갈라 세웁니다.
// 급수는 보지 않으므로 누적 범위에서도 사전처럼 8급·5급이 섞여 이어집니다.
// 데이터 5,978자 모두 s(음)가 채워져 있어 빈 값 처리는 필요 없습니다.
const KO_COLLATOR = new Intl.Collator("ko");
function byGanada(a, b) {
  return KO_COLLATOR.compare(a.s, b.s)
      || KO_COLLATOR.compare(a.h, b.h)
      || KO_COLLATOR.compare(a.c, b.c);
}

// 현재 급수의 한자 목록 (가나다순).
// 최대 5,978자를 매번 훑고 정렬하지 않도록 급수/범위 기준으로 캐시합니다.
let deckCache = { key: null, list: [] };
function deck() {
  const key = state.level + "|" + state.scope;
  if (deckCache.key !== key) {
    const codes = new Set(levelCodes(state.level, state.scope));
    deckCache = { key, list: HANJA.filter(h => codes.has(h.lv)).sort(byGanada) };
  }
  return deckCache.list;
}
// 자가평가 상태. 아직 평가하지 않은 글자는 "모르는 글자"로 봅니다.
function knowOf(c) {
  return state.know[c] === "yes" || state.know[c] === "maybe" ? state.know[c] : "no";
}

// 읽기 카드에 쓸 목록 = 현재 급수 범위 중 "포함할 글자"로 고른 것만
function flashDeck() {
  const f = state.flash;
  return deck().filter(h => f[knowOf(h.c)]);
}

// ---------- 쓰기 배정한자 ----------
// 어문회는 읽기와 쓰기 배정한자가 다릅니다(쓰기가 훨씬 좁음).
// 예) 6급 읽기 300자 / 쓰기 150자. 8급·7급II·7급은 쓰기 배정이 아예 없습니다.
function writeCodesCum(levelCode) {
  const lv = LEVELS.find(l => l.code === levelCode);
  if (!lv || !lv.writeUpto) return [];
  const all = LEVELS.flatMap(l => l.codes);
  return all.slice(0, all.indexOf(lv.writeUpto) + 1);
}

// scope="new" 면 그 급수에서 쓰기 범위에 새로 들어온 글자만
function writeRangeCodes(levelCode, scope, fullRange) {
  if (fullRange) return levelCodes(levelCode, scope); // 읽기 범위로 전환한 경우
  const cum = writeCodesCum(levelCode);
  if (scope !== "new") return cum;
  const i = LEVELS.findIndex(l => l.code === levelCode);
  const prev = i > 0 ? writeCodesCum(LEVELS[i - 1].code) : [];
  return cum.filter(c => !prev.includes(c));
}

// 쓰기 자가평가 (읽기와 별도로 쌓습니다)
function knowWOf(c) {
  return state.knowW[c] === "yes" || state.knowW[c] === "maybe" ? state.knowW[c] : "no";
}

// 쓰기 배정 범위 전체 (자가평가 필터 적용 전, 가나다순).
// 홈 통계와 쓰기 카드가 함께 쓰므로 deck() 과 같은 방식으로 캐시합니다.
let writeDeckCache = { key: null, list: [] };
function writeBase() {
  const key = state.level + "|" + state.scope + "|" + (state.write.fullRange ? "1" : "0");
  if (writeDeckCache.key !== key) {
    const codes = new Set(writeRangeCodes(state.level, state.scope, state.write.fullRange));
    writeDeckCache = { key, list: HANJA.filter(h => codes.has(h.lv)).sort(byGanada) };
  }
  return writeDeckCache.list;
}

// 쓰기 카드에 쓸 목록 = 쓰기 배정 범위 중 "포함할 글자"로 고른 것만
function writeDeck() {
  const w = state.write;
  return writeBase().filter(h => w[knowWOf(h.c)]);
}

function findByChar(c) {
  return HANJA.find(h => h.c === c);
}
function shuffleArr(a) {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

// ---------- 탭 전환 ----------
function switchTab(tab) {
  $$(".view").forEach(v => v.classList.remove("active"));
  $("#view-" + tab).classList.add("active");
  $$("nav.tabbar button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  if (tab === "home") renderHome();
  if (tab === "quiz") startQuiz();
  if (tab === "write") renderWrite();
  if (tab === "review") renderReview();
}
$$("nav.tabbar button").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));

// ---------- 확인 팝업 ----------
// 브라우저 기본 confirm() 은 화면을 멈춰 세우므로 직접 만든 팝업을 씁니다.
let confirmAction = null;

// onOk 를 주지 않으면 알림만 하는 창이 됩니다.
function openConfirm(title, body, onOk) {
  $("#confirm-title").textContent = title;
  $("#confirm-body").innerHTML = body;
  confirmAction = onOk || null;
  $("#confirm-ok").hidden = !onOk;
  $("#confirm-cancel").textContent = onOk ? "취소" : "확인";
  $("#confirm-backdrop").classList.add("open");
  $("#confirm-modal").classList.add("open");
}
function closeConfirm() {
  confirmAction = null;
  $("#confirm-backdrop").classList.remove("open");
  $("#confirm-modal").classList.remove("open");
}
$("#confirm-cancel").addEventListener("click", closeConfirm);
$("#confirm-backdrop").addEventListener("click", closeConfirm);
$("#confirm-ok").addEventListener("click", () => {
  const fn = confirmAction;
  closeConfirm();
  if (fn) fn();
});

// ---------- 하루 학습량 ----------
// 읽기·쓰기에서 자가평가를 누른 "서로 다른 글자" 수를 오늘치로 셉니다.
// 같은 글자를 다시 평가해도 두 번 세지 않습니다.
const GOAL_STEP = 5, GOAL_MAX = 100;

// 로컬 날짜 기준. toISOString() 은 UTC라 한국에서는 오전 9시에 날짜가 바뀝니다.
function todayKey() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// 날짜가 넘어갔으면 오늘치를 비웁니다 (목표 자수는 그대로 둡니다).
// 앱을 켜 둔 채 자정을 넘길 수 있어 집계·렌더 직전에도 부릅니다.
function rollDaily() {
  const t = todayKey();
  if (state.daily.date === t) return false;
  state.daily.date = t;
  state.daily.readChars = [];
  state.daily.writeChars = [];
  state.daily.cheered = [];
  return true;
}

// mode: "read" | "write"
function dailyProgress(mode) {
  const dl = state.daily;
  const chars = mode === "write" ? dl.writeChars : dl.readChars;
  const goal = mode === "write" ? dl.write : dl.read;
  return { done: chars.length, goal, met: goal > 0 && chars.length >= goal };
}

function countDaily(mode, char) {
  rollDaily();
  const dl = state.daily;
  const key = mode === "write" ? "writeChars" : "readChars";
  if (dl[key].includes(char)) return;
  dl[key].push(char);

  // 목표를 막 채운 순간 한 번만 축하합니다 (onOk 없이 = 알림 전용 팝업)
  const p = dailyProgress(mode);
  if (p.met && !dl.cheered.includes(mode)) {
    dl.cheered.push(mode);
    const name = mode === "write" ? "쓰기" : "읽기";
    openConfirm(
      `오늘의 ${name} 분량 완료! 🎉`,
      `${p.goal}자를 다 보셨어요. 계속 해도 좋고, 여기서 멈춰도 오늘 몫은 채웠습니다.`
    );
  }
}

// ---------- 홈 ----------
// 읽기 / 쓰기 / 퀴즈는 기록이 서로 다른 곳에 쌓이므로(know / knowW / wrong)
// 통계도 모드를 골라서 봅니다.
let statMode = "read"; // "read" | "write" | "quiz"

// 모드별 집계 대상. 읽기는 급수 범위 전체(deck), 쓰기는 쓰기 배정 범위(writeBase)입니다.
function countBy(list, gradeOf) {
  const cnt = { yes: 0, maybe: 0, no: 0 };
  list.forEach(h => cnt[gradeOf(h.c)]++);
  return cnt;
}
// 퀴즈 기록은 급수와 무관하게 쌓이므로 전체 기준으로 셉니다.
function wrongChars() {
  return Object.keys(state.wrong).filter(c => state.wrong[c] > 0);
}

function renderHome() {
  const d = deck();
  const lvName = (LEVELS.find(l => l.code === state.level) || {}).name || state.level;
  const scopeName = state.scope === "new" ? "신출한자만" : "시험 범위";

  // 급수 · 진도 (읽기 자가평가 기준)
  const cnt = countBy(d, knowOf);
  const pct = d.length ? Math.round((cnt.yes / d.length) * 100) : 0;
  $("#home-lv").textContent = lvName;
  $("#home-scope").textContent = `${scopeName} ${d.length}자`;
  $("#home-bar").style.width = pct + "%";
  $("#home-progress").textContent = `읽기 ${cnt.yes}자 익힘 · ${pct}%`;

  // 이어서 학습
  const r = state.resume;
  $("#home-resume-sub").textContent = r && r.c
    ? `${(LEVELS.find(l => l.code === r.level) || {}).name || r.level} · ${r.c} 부터`
    : "읽기 카드 시작";

  // 메뉴별 학습율 — 분모는 현재 급수·범위 기준 (위 급수 카드·학습 통계와 동일)
  const wBase = writeBase();
  const cW = countBy(wBase, knowWOf);
  const quizOk = d.filter(h => state.quizOk[h.c]).length;
  // 복습은 "할 일" 목록이라, 다른 셋과 방향을 맞추려고 복습 안 해도 되는 글자를 셉니다.
  const needReview = d.filter(h =>
    knowOf(h.c) !== "yes" || knowWOf(h.c) !== "yes" || state.wrong[h.c] > 0
  ).length;

  $("#home-n-flash").textContent = `${cnt.yes}/${d.length}자`;
  // 8급·7급II·7급은 쓰기 배정한자가 없어 0/0 이 되므로 안내로 대체합니다.
  $("#home-n-write").textContent = wBase.length ? `${cW.yes}/${wBase.length}자` : "쓰기 없음";
  $("#home-n-quiz").textContent = `${quizOk}/${d.length}자`;
  $("#home-n-review").textContent = `${d.length - needReview}/${d.length}자`;

  renderDaily();
  renderStats();
}

// ---------- 홈: 오늘의 분량 ----------
function renderDaily() {
  rollDaily();
  // 쓰기 배정한자가 없는 급수(8급·7급II·7급)는 쓰기 목표를 숨깁니다.
  const rows = [
    { mode: "read",  el: $("#daily-read"),  icon: "📖", label: "읽기", show: true },
    { mode: "write", el: $("#daily-write"), icon: "✏️", label: "쓰기", show: writeBase().length > 0 },
  ];
  let visible = 0;
  rows.forEach(r => {
    const p = dailyProgress(r.mode);
    // 목표 0 = 그 모드는 목표를 끈 것
    const on = r.show && p.goal > 0;
    r.el.hidden = !on;
    if (!on) return;
    visible++;
    const pct = Math.min(100, Math.round((p.done / p.goal) * 100));
    r.el.classList.toggle("done", p.met);
    r.el.innerHTML =
      `<span class="d-lbl">${r.icon} ${r.label}</span>` +
      `<div class="bar"><i style="width:${pct}%"></i></div>` +
      `<span class="d-num">${p.done} / ${p.goal}${p.met ? " ✓" : ""}</span>`;
  });
  // 둘 다 꺼 두면 카드에 남는 게 없으므로 안내를 대신 보여줍니다.
  $("#daily-off").hidden = visible > 0;
}

// ---------- 홈 학습 통계 ----------
// 타일: {label, 값, 눌렀을 때 이동할 복습 목록}
function statTiles() {
  if (statMode === "quiz") {
    const chars = wrongChars();
    const often = chars.filter(c => state.wrong[c] >= 3).length;
    const total = chars.reduce((a, c) => a + state.wrong[c], 0);
    return [
      { cls: "no",    label: "오답 한자",    n: chars.length, seg: "wrong" },
      { cls: "maybe", label: "3회 이상",     n: often,        seg: "often" },
      { cls: "info",  label: "총 틀린 횟수", n: total },
    ];
  }
  const isW = statMode === "write";
  const c = countBy(isW ? writeBase() : deck(), isW ? knowWOf : knowOf);
  return [
    { cls: "yes",   label: isW ? "쓰는 글자" : "읽는 글자", n: c.yes,   seg: "yes" },
    { cls: "maybe", label: "헷갈리는",                      n: c.maybe, seg: "maybe" },
    { cls: "no",    label: isW ? "못 쓰는" : "모르는",       n: c.no,    seg: "no" },
  ];
}

function renderStats() {
  $$("#stat-mode button").forEach(b => b.classList.toggle("active", b.dataset.mode === statMode));

  const row = $("#stat-row");
  row.innerHTML = "";
  statTiles().forEach(t => {
    const el = document.createElement("button");
    el.className = "stat " + t.cls;
    // seg 가 없는 타일(총 틀린 횟수)은 이동할 목록이 없어 누를 수 없게 둡니다
    if (t.seg) el.dataset.seg = t.seg; else el.disabled = true;
    el.innerHTML = `<b>${t.n}</b><small>${t.label}</small>`;
    row.appendChild(el);
  });
}

$("#stat-mode").addEventListener("click", e => {
  const b = e.target.closest("button[data-mode]");
  if (!b) return;
  statMode = b.dataset.mode;
  renderStats();
});

$("#home-change-lv").addEventListener("click", openSheet);
$("#home-resume").addEventListener("click", () => {
  const r = state.resume;
  if (r && r.c) {
    state.level = r.level;
    state.scope = r.scope;
    save();
    resetFlash();
    const i = flashDeck().findIndex(h => h.c === r.c);
    if (i >= 0) { flashIdx = i; renderFlash(); }
  }
  switchTab("flash");
});
$$(".menu-card").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.go)));
// 통계 타일을 누르면 복습 탭의 같은 모드·같은 목록으로 바로 넘어갑니다.
// 타일은 모드가 바뀔 때마다 다시 만들므로 카드에 위임해서 듣습니다.
$("#stat-row").addEventListener("click", e => {
  const b = e.target.closest(".stat[data-seg]");
  if (!b) return;
  switchTab("review");
  setReview(statMode, b.dataset.seg);
});

// ---------- 플래시카드 ----------
// 순서는 항상 flashDeck() 의 가나다순 그대로입니다. 자가평가로 카드가 목록에서
// 빠지면 그 자리에 다음 글자가 오므로 위치(flashIdx)만 들고 있으면 됩니다.
let flashIdx = 0;

function resetFlash() {
  flashIdx = 0;
  renderFlash();
}
function currentFlashItem() {
  return flashDeck()[flashIdx];
}
// 카드를 앞면으로 되돌립니다. 새 카드로 넘어가는 길이므로 애니메이션 없이
// 즉시 앞면이 되게 합니다 — 안 그러면 새 카드의 뒷면이 잠깐 보입니다.
function resetFlashFace() {
  const el = $("#flash");
  if (!el.classList.contains("flipped")) return;
  el.classList.add("no-flip-anim");
  el.classList.remove("flipped");
  void el.offsetWidth; // 리플로우를 강제해 transition:none 상태로 확정시킴
  el.classList.remove("no-flip-anim");
}
function renderFlash() {
  const d = flashDeck();
  updateStudySummary();
  // 포함할 글자를 다 끄면 카드가 없을 수 있으므로 안내로 대체
  $("#flash-empty").hidden = d.length > 0;
  $(".flash-wrap").hidden = d.length === 0;
  $("#flash-nav").hidden = d.length === 0;
  $("#flash-grade").hidden = d.length === 0;
  $(".progress-row").hidden = d.length === 0;
  if (!d.length) return;
  if (flashIdx >= d.length) flashIdx = 0;
  const item = currentFlashItem();
  resetFlashFace();
  $("#flash-hanzi").textContent = item.c;
  $("#flash-lv").textContent = levelNameOf(item.lv);
  $("#flash-hanzi-sm").textContent = item.c;
  // 뒷면 표시 항목은 학습 설정에 따라 켜고 끕니다
  const f = state.flash;
  $("#flash-reading").textContent = readingText(item);
  $("#flash-reading").hidden = !f.showReading;
  $("#flash-tc").textContent = "총획 " + item.tc + "획";
  $("#flash-tc").hidden = !f.showStroke;
  $("#flash-bu").textContent = "부수 " + item.bu;
  $("#flash-bu").hidden = !f.showRadical;
  $(".face.back .chips").hidden = !f.showStroke && !f.showRadical;
  $("#flash-count").textContent = `${flashIdx + 1} / ${d.length}`;
  $("#flash-bar").style.width = Math.round(((flashIdx + 1) / d.length) * 100) + "%";
  updateFlashControls();
  // 어디까지 봤는지 기억 (홈에서 이어서 학습)
  state.resume = { level: state.level, scope: state.scope, c: item.c };
  save();
}
// 앞면이면 이동 버튼, 뒷면(뜻을 본 뒤)이면 자가평가 버튼을 보여줍니다.
function updateFlashControls() {
  const flipped = $("#flash").classList.contains("flipped");
  $("#flash-nav").classList.toggle("hidden", flipped);
  $("#flash-grade").classList.toggle("hidden", !flipped);
  if (flipped) {
    const cur = state.know[currentFlashItem().c];
    $$("#flash-grade .grade").forEach(b => b.classList.toggle("sel", b.dataset.grade === cur));
  }
}

$("#flash").addEventListener("click", () => {
  $("#flash").classList.toggle("flipped");
  updateFlashControls();
});

// 자가평가: 기록하고 다음 카드로. "알아요"만 기록에서 지우지 않고 그대로 남깁니다.
$("#flash-grade").addEventListener("click", e => {
  const b = e.target.closest("button[data-grade]");
  if (!b) return;
  const c = currentFlashItem().c;
  state.know[c] = b.dataset.grade;
  countDaily("read", c); // 오늘의 읽기 분량에 반영
  save();
  // 평가한 글자가 필터에서 빠지면 그 자리에 다음 글자가 오므로 위치를 유지합니다.
  const n = flashDeck().length;
  if (!n) { flashIdx = 0; }
  else if (flashDeck()[flashIdx] && flashDeck()[flashIdx].c === c) flashIdx = (flashIdx + 1) % n;
  else if (flashIdx >= n) flashIdx = 0;
  renderFlash();
  renderHome();
});
$("#flash-next").addEventListener("click", () => {
  flashIdx = (flashIdx + 1) % flashDeck().length;
  renderFlash();
});
$("#flash-prev").addEventListener("click", () => {
  const n = flashDeck().length;
  flashIdx = (flashIdx - 1 + n) % n;
  renderFlash();
});

// 읽기 초기화: 첫 글자로 되돌립니다. 자가평가 기록은 지우지 않습니다.
$("#flash-reset").addEventListener("click", resetFlash);

// ---------- 퀴즈 ----------
let quizPool = [];
let quizPos = 0;
let quizScore = 0;
let quizTotal = 0;
let quizAnswer = null; // 현재 문제의 정답 (모르겠어요 버튼에서 사용)
let quizType = 0;

function startQuiz() {
  const d = deck();
  quizPos = 0; quizScore = 0; quizTotal = 0; quizAnswer = null;
  if (d.length < 4) {
    quizPool = [];
    $("#quiz-options").innerHTML = "<p class='empty'>퀴즈에는 최소 4자가 필요합니다.</p>";
    $("#quiz-dunno").disabled = true;
    updateQuizScore();
    return;
  }
  quizPool = shuffleArr(d);
  nextQuestion();
}
// 보기에 표시될 문자열. 이 값이 겹치면 정답이 두 개가 되어버립니다.
// (예: 年·秊 둘 다 "해 년", 萬·万 둘 다 "일만 만" — 상위 급수에 300쌍 존재)
function optionText(item, type) {
  return type === 0 ? `${item.h} ${item.s}` : item.c;
}

// 오답 보기 고르기. 정답과 표시 문자열이 같은 항목은 제외합니다.
// 전체를 셔플하면 급수가 클수록 낭비라 랜덤 추출로 뽑습니다.
function pickDistractors(d, answer, type, n) {
  const answerText = optionText(answer, type);
  const used = new Set([answerText]);
  const picked = [];
  const limit = Math.min(d.length * 4, 200); // 후보가 부족해도 무한루프 방지
  for (let tries = 0; tries < limit && picked.length < n; tries++) {
    const cand = d[Math.floor(Math.random() * d.length)];
    const text = optionText(cand, type);
    if (used.has(text)) continue;
    used.add(text);
    picked.push(cand);
  }
  return picked;
}

function nextQuestion() {
  const d = deck();
  // 한 바퀴 다 풀면 다시 섞어서 처음부터 (진행도도 함께 되돌림)
  if (quizPos >= quizPool.length) { quizPool = shuffleArr(d); quizPos = 0; }
  const answer = quizPool[quizPos];
  quizPos++;

  // 문제 유형: 0=한자→훈음, 1=훈음→한자
  const type = Math.random() < 0.5 ? 0 : 1;
  quizAnswer = answer;
  quizType = type;
  $("#quiz-dunno").disabled = false;
  const labelEl = $("#quiz-label");
  const promptEl = $("#quiz-prompt");

  const distractors = pickDistractors(d, answer, type, 3);
  const opts = shuffleArr([answer, ...distractors]);

  if (type === 0) {
    labelEl.textContent = "이 한자의 훈·음은?";
    promptEl.className = "prompt";
    promptEl.textContent = answer.c;
  } else {
    labelEl.textContent = "이 뜻·음의 한자는?";
    promptEl.className = "prompt text";
    promptEl.textContent = `${answer.h} ${answer.s}`;
  }

  const box = $("#quiz-options");
  box.innerHTML = "";
  opts.forEach(o => {
    const b = document.createElement("button");
    b.className = "opt";
    b.textContent = optionText(o, type);
    b._item = o; // 표시 문자열이 아니라 이 참조로 정답을 판정합니다
    if (type === 1) b.style.fontSize = "34px", b.style.fontFamily = "Batang, serif";
    b.addEventListener("click", () => answerQuiz(b, o, answer, type));
    box.appendChild(b);
  });
  updateQuizScore();
}
function answerQuiz(btn, chosen, answer, type) {
  if (btn.classList.contains("disabled")) return; // 채점 대기 중 중복 클릭 방지
  quizTotal++;
  const correct = chosen === answer;
  revealAnswer(answer);
  if (correct) {
    quizScore++;
    state.quizOk[answer.c] = true; // 홈 학습율용 정답 기록
    save();
  } else {
    btn.classList.add("wrong");
    markWrong(answer);
  }
  updateQuizScore();
  setTimeout(nextQuestion, correct ? 650 : 1300);
}

// 정답 공개 + 보기 잠금
function revealAnswer(answer) {
  $("#quiz-dunno").disabled = true;
  $$("#quiz-options .opt").forEach(el => {
    el.classList.add("disabled");
    if (el._item === answer) el.classList.add("correct");
  });
}

// 오답노트에 기록
function markWrong(answer) {
  state.wrong[answer.c] = (state.wrong[answer.c] || 0) + 1;
  delete state.quizOk[answer.c]; // 다시 틀렸으면 맞힌 기록도 취소
  save();
}

// "모르겠어요" — 오답으로 치고 정답을 보여준 뒤 다음 문제로
$("#quiz-dunno").addEventListener("click", () => {
  if (!quizAnswer || $("#quiz-dunno").disabled) return;
  quizTotal++;
  revealAnswer(quizAnswer);
  markWrong(quizAnswer);
  updateQuizScore();
  setTimeout(nextQuestion, 1300);
});

function updateQuizScore() {
  $("#quiz-score").textContent = `점수 ${quizScore} / ${quizTotal}`;
  const total = quizPool.length;
  $("#quiz-count").textContent = `${Math.min(quizPos, total)} / ${total}`;
  $("#quiz-bar").style.width = total ? Math.round((quizPos / total) * 100) + "%" : "0%";
}
$("#quiz-reset").addEventListener("click", startQuiz);

// ---------- 쓰기 연습 ----------
let writeIdx = 0;
let writeOrder = [];   // 표시 순서 (한자 문자) — 항상 writeDeck() 의 가나다순입니다.
let writerInstance = null;

// 대상 한자가 바뀌어도(설정 변경, 자가평가로 필터에서 빠짐) 순서는 늘 가나다순이므로
// 목록을 그대로 다시 받아옵니다. 위치(writeIdx)는 부르는 쪽에서 챙깁니다.
function syncWriteOrder() {
  writeOrder = writeDeck().map(h => h.c);
  return writeOrder;
}

// 첫 글자로 되돌리고 처음부터
function resetWrite() {
  writeIdx = 0;
  renderWrite();
}

function currentWriteItem() {
  return findByChar(writeOrder[writeIdx]);
}

function renderWrite() {
  const order = syncWriteOrder();
  updateWriteSummary();

  // 8급·7급II·7급은 쓰기 배정한자가 없고, 필터를 다 끄면 대상이 0일 수 있습니다.
  const lv = LEVELS.find(l => l.code === state.level) || {};
  const noWriteLevel = !state.write.fullRange && !lv.writeUpto;
  $("#write-empty").hidden = order.length > 0;
  $("#write-box").hidden = order.length === 0;
  $("#write-grade").hidden = order.length === 0;
  $$("#view-write .nav-row:not(.grade-row)").forEach(el => { el.hidden = order.length === 0; });
  $("#view-write .progress-row").hidden = order.length === 0;
  if (!order.length) {
    $("#write-empty").innerHTML = noWriteLevel
      ? `${lv.name}은 <b>쓰기 배정한자가 없습니다.</b><br>학습 설정에서 "읽기 범위 전체"를 켜면 연습할 수 있어요.`
      : `조건에 맞는 한자가 없어요.<br>학습 설정에서 포함할 글자를 늘려보세요.`;
    return;
  }

  if (writeIdx >= order.length) writeIdx = 0;
  const item = currentWriteItem();
  $("#write-count").textContent = `${writeIdx + 1} / ${order.length}`;
  $("#write-bar").style.width = Math.round(((writeIdx + 1) / order.length) * 100) + "%";
  // 한자는 보여주지 않습니다 — 훈음·급수·획수만 보고 직접 씁니다.
  $("#write-reading").textContent = readingText(item);
  $("#write-lv").textContent = levelNameOf(item.lv);
  $("#write-tc").textContent = "총획 " + item.tc + "획";
  // 이미 매긴 평가 표시
  const cur = state.knowW[item.c];
  $$("#write-grade .grade").forEach(b => b.classList.toggle("sel", b.dataset.grade === cur));
  renderSpeedTag();
  buildWriter(item.c);
}
// 한국 정자체 ↔ hanzi-writer(중국 자형 기반) 데이터 매핑
// 데이터셋에 없는 한국식 코드포인트를 획순이 동일한 대응 글자로 연결
const STROKE_ALT = {
  "敎": "教",  // 가르칠 교
  "靑": "青",  // 푸를 청
  "曺": "曹",
  "眞": "真",
};

function plainGlyph(char, size) {
  return `<div style="font-size:${Math.round(size*0.62)}px;font-family:Batang,'Noto Serif KR',serif;line-height:1">${char}</div>`;
}

// 획순판에 쓸 수 있는 세로 높이. 아래 버튼(획순·지우기 + 자가평가)까지
// 한 화면에 들어오도록, 실제 배치를 재서 위/아래 요소가 쓰는 높이를 뺍니다.
// 다른 탭에서 renderWrite 가 불려 쓰기 화면이 아직 안 보이면 잴 수 없으므로
// 추정치를 쓰고, 쓰기 탭에 들어올 때 switchTab 이 다시 렌더해 정확히 맞춥니다.
const STAGE_MIN = 150, STAGE_MAX = 280;
const STAGE_RESERVED_EST = 530; // 잴 수 없을 때의 어림값 (헤더 52 + 위 218 + 아래 167 + 아래여백 90)

function stageBudget() {
  const stage = $("#write-stage");
  const sr = stage.getBoundingClientRect();
  if (!sr.width && !sr.height) return window.innerHeight - STAGE_RESERVED_EST;
  const main = $("main");
  const above = sr.top - main.getBoundingClientRect().top;      // 획순판 위 요소들
  const below = $("#write-grade").getBoundingClientRect().bottom - sr.bottom; // 아래 버튼들
  const padB = parseFloat(getComputedStyle(main).paddingBottom) || 0;
  return main.clientHeight - above - below - padB;
}

// 획순 데이터는 비동기로 받아옵니다. 빠르게 넘기면 이전 글자의 실패 콜백이
// 뒤늦게 도착해 현재 글자에 엉뚱한 안내문을 남기므로, 세대 번호로 걸러냅니다.
let writerGen = 0;

function buildWriter(char) {
  const gen = ++writerGen;
  // 획순판 크기 — 가로는 화면 너비, 세로는 stageBudget() 이 잰 "남은 높이"에 맞춥니다.
  // 큰 화면에서는 그대로 280px, 작은 화면에서만 알아서 줄어듭니다.
  // ※ stageBudget() 은 지금 배치를 재므로 판을 비우기 전에 계산해야 합니다.
  const size = Math.max(STAGE_MIN, Math.min(
    STAGE_MAX,
    Math.floor(window.innerWidth * 0.72),
    Math.floor(stageBudget())
  ));
  const target = $("#writer-target");
  target.innerHTML = "";
  $("#write-note").textContent = "";
  // 어느 경로로 끝나든(오프라인·획순데이터 없음 포함) 캔버스는 새 크기로 비웁니다.
  resetCanvas(size);
  // 어문회 원본은 金(U+F90A), 車(U+F902), 樂(U+F95C) 등 9자를 "호환용 한자"
  // (U+F900~FAFF)로 인코딩해 두었습니다. 겉보기는 같지만 코드포인트가 달라
  // 획순 데이터셋 조회가 실패하므로, NFC 정규화로 일반 한자로 바꿔 찾습니다.
  const normChar = char.normalize("NFC");
  const drawChar = STROKE_ALT[normChar] || normChar;

  // 획순 글자만 담는 격자 배경 박스
  const pane = document.createElement("div");
  pane.style.width = size + "px";
  pane.style.height = size + "px";
  pane.style.backgroundSize = `${size/2}px ${size/2}px`;
  pane.classList.add("grid-bg");
  target.appendChild(pane);

  if (typeof HanziWriter === "undefined") {
    pane.innerHTML = plainGlyph(char, size);
    pane.style.display = "flex";
    pane.style.alignItems = "center";
    pane.style.justifyContent = "center";
    $("#write-note").textContent = "※ 획순 애니메이션은 인터넷 연결 시 표시됩니다.";
    writerInstance = null;
    return;
  }
  try {
    writerInstance = HanziWriter.create(pane, drawChar, {
      width: size, height: size, padding: 8,
      // 한자를 보여주지 않습니다. 훈음만 보고 직접 써야 하니까요.
      // 채점은 하지 않습니다 — 획순 재생(획순 보기)에만 씁니다.
      showCharacter: false,
      showOutline: false,
      strokeColor: "#2b2b2b",
      radicalColor: "#b5432f",
      strokeAnimationSpeed: state.write.speed,
      delayBetweenStrokes: Math.round(180 / state.write.speed),
      onLoadCharDataError: () => {
        if (gen !== writerGen) return; // 이미 다른 글자로 넘어갔으면 무시
        pane.innerHTML = plainGlyph(char, size);
        pane.style.display = "flex";
        pane.style.alignItems = "center";
        pane.style.justifyContent = "center";
        $("#write-note").textContent = "※ 이 한자는 획순 데이터가 없어 글자만 표시합니다.";
        writerInstance = null;
      },
    });
    $("#write-note").textContent = "훈·음을 보고 손가락으로 써보세요";
  } catch (e) {
    pane.innerHTML = plainGlyph(char, size);
    writerInstance = null;
  }
}

// ---------- 자유 필기 캔버스 ----------
// 획 인식으로 채점하면 제대로 썼는데도 위치 차이로 오판정되는 일이 잦습니다.
// 그래서 앱은 채점하지 않고, 자유롭게 쓴 뒤 사용자가 직접 평가하도록 합니다.
let canvasReady = false;

function resetCanvas(size) {
  const cv = $("#write-canvas");
  const dpr = window.devicePixelRatio || 1;
  cv.style.width = size + "px";
  cv.style.height = size + "px";
  cv.width = Math.round(size * dpr);
  cv.height = Math.round(size * dpr);
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.lineWidth = Math.max(5, Math.round(size / 26));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#2f6db5";
  if (canvasReady) return;
  canvasReady = true;

  let drawing = false;
  const pos = e => {
    const r = cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  cv.addEventListener("pointerdown", e => {
    drawing = true;
    cv.setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    const c = cv.getContext("2d");
    c.beginPath();
    c.moveTo(x, y);
    // 점 하나만 찍어도 보이도록
    c.lineTo(x + 0.01, y);
    c.stroke();
  });
  cv.addEventListener("pointermove", e => {
    if (!drawing) return;
    e.preventDefault();
    const [x, y] = pos(e);
    const c = cv.getContext("2d");
    c.lineTo(x, y);
    c.stroke();
  });
  const end = () => { drawing = false; };
  cv.addEventListener("pointerup", end);
  cv.addEventListener("pointercancel", end);
  cv.addEventListener("pointerleave", end);
}

function clearCanvas() {
  const cv = $("#write-canvas");
  const ctx = cv.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, cv.width / dpr, cv.height / dpr);
}

// 획순 보기 — 쓰던 화면 위에 겹쳐서 재생하고, 끝나면 다시 따라쓰기로 돌아갑니다.
let animating = false;
let animTimer = null;

// 재생을 끝내고 따라쓰기로 되돌립니다. onComplete 와 안전장치 양쪽에서 부르므로
// 한 번만 실행되도록 animating 으로 막습니다.
function finishAnimate(gen) {
  if (!animating) return;
  animating = false;
  clearTimeout(animTimer);
  $("#write-animate").disabled = false;
  if (gen !== writerGen || !writerInstance) return; // 그새 글자가 바뀌었으면 중단
  writerInstance.hideCharacter();
  writerInstance.hideOutline();
  $("#write-note").textContent = "훈·음을 보고 손가락으로 써보세요";
}

$("#write-animate").addEventListener("click", e => {
  // 버튼 안 배속 배지를 누르면 재생 대신 배속만 1× → 2× → 3× 로 순환합니다.
  // hanzi-writer 는 생성 시 속도가 정해지므로 현재 글자를 다시 만듭니다.
  if (e.target.closest("#write-speed")) {
    if (animating) return;
    state.write.speed = state.write.speed >= 3 ? 1 : state.write.speed + 1;
    save();
    renderSpeedTag();
    const cur = currentWriteItem();
    if (cur) buildWriter(cur.c);
    return;
  }
  if (!writerInstance || animating) return;
  const item = currentWriteItem();
  animating = true;
  const gen = writerGen;
  $("#write-animate").disabled = true;
  writerInstance.showOutline();
  $("#write-note").textContent = `획순 재생 중… (${state.write.speed}배속)`;
  writerInstance.animateCharacter({ onComplete: () => finishAnimate(gen) });
  // 안전장치: 화면이 가려지면 requestAnimationFrame 이 멈춰 onComplete 가 영영
  // 안 옵니다. 그대로 두면 버튼이 죽으므로 예상 재생 시간이 지나면 되돌립니다.
  clearTimeout(animTimer);
  const expected = ((item && item.tc) || 12) * (700 / state.write.speed) + 3000;
  animTimer = setTimeout(() => finishAnimate(gen), expected);
});

// 재생 속도 (1 / 2 / 3배속) — 획순 버튼 안 배지로 표시합니다.
function renderSpeedTag() {
  $("#write-speed").textContent = state.write.speed + "×";
}

// 화면이 가려지면 requestAnimationFrame 이 멈춰 애니메이션의 onComplete 가
// 영영 안 옵니다. 그대로 두면 animating 이 true 로 굳어 버튼이 죽으므로,
// 화면이 숨겨질 때 상태를 되돌려 놓습니다.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && animating) finishAnimate(writerGen);
});

// 지우기 — 내가 쓴 필기만 지웁니다
$("#write-again").addEventListener("click", () => {
  clearCanvas();
  if (!animating) $("#write-note").textContent = "훈·음을 보고 손가락으로 써보세요";
});

// 쓰기 자가평가 — 기록하고 다음 한자로 (이전/다음 버튼을 대신합니다)
$("#write-grade").addEventListener("click", e => {
  const b = e.target.closest("button[data-grade]");
  if (!b) return;
  const item = currentWriteItem();
  if (!item) return;
  state.knowW[item.c] = b.dataset.grade;
  countDaily("write", item.c); // 오늘의 쓰기 분량에 반영
  save();
  // 평가한 글자가 필터에서 빠지면 그 자리에 다음 글자가 오므로 위치를 유지합니다.
  const order = syncWriteOrder();
  if (!order.length) writeIdx = 0;
  else if (order.includes(item.c)) writeIdx = (writeIdx + 1) % order.length;
  else if (writeIdx >= order.length) writeIdx = 0;
  renderWrite();
  renderHome();
});

// 처음부터 — 첫 글자로 되돌립니다 (자가평가 기록은 그대로)
$("#write-reset").addEventListener("click", resetWrite);

// ---------- 복습 ----------
// 읽기 / 쓰기 / 퀴즈를 항목별로 나눠서 봅니다. 기록이 서로 다른 곳에 쌓이므로
// (know / knowW / wrong) 하위 필터도 모드마다 다릅니다.
//   읽기·쓰기 → 자가평가 상태별 (모르는 / 헷갈리는 / 아는)
//   퀴즈      → 오답 전체 / 3회 이상 자주 틀린 것
let reviewMode = "read"; // "read" | "write" | "quiz"
// 모드를 오가도 보던 필터를 기억합니다. 복습은 "모르는" 것부터 보는 게 기본.
let reviewSegBy = { read: "no", write: "no", quiz: "wrong" };
const REVIEW_SEGS = { read: ["no", "maybe", "yes"], write: ["no", "maybe", "yes"], quiz: ["wrong", "often"] };

const REVIEW_EMPTY = {
  read: {
    yes:   "읽을 수 있는 글자가 없어요.<br>읽기 카드에서 <b>알아요</b>를 눌러보세요.",
    maybe: "헷갈리는 글자가 없어요.<br>읽기 카드에서 <b>헷갈려요</b>를 눌러보세요.",
    no:    "모르는 글자가 없어요.<br>이 급수 읽기는 다 익히셨네요! 👏",
  },
  write: {
    yes:   "쓸 수 있는 글자가 없어요.<br>쓰기 연습에서 <b>알아요</b>를 눌러보세요.",
    maybe: "헷갈리는 글자가 없어요.<br>쓰기 연습에서 <b>헷갈려요</b>를 눌러보세요.",
    no:    "못 쓰는 글자가 없어요.<br>이 급수 쓰기는 다 익히셨네요! 👏",
  },
  quiz: {
    wrong: "오답이 없어요! 👏<br>퀴즈를 풀면 틀린 한자가 여기 모입니다.",
    often: "3회 이상 틀린 한자가 없어요. 👏",
  },
};

// 하위 필터 버튼에 붙일 이름.
// 읽기·쓰기는 평가 버튼(.grade-row)과 같은 말을 써서 어떤 기록을 보는지 바로 알게 합니다.
function reviewSegLabel(mode, seg) {
  if (mode === "quiz") return seg === "wrong" ? "! 오답 전체" : "🔥 자주 틀림";
  if (seg === "yes")   return "✓ 알아요";
  if (seg === "maybe") return "? 헷갈려요";
  return "✕ 몰라요";
}

// 현재 모드·필터에 해당하는 한자 목록
function reviewChars() {
  if (reviewMode === "quiz") {
    const min = reviewSegBy.quiz === "often" ? 3 : 1;
    return wrongChars().filter(c => state.wrong[c] >= min)
      .sort((a, b) => state.wrong[b] - state.wrong[a]);
  }
  const isW = reviewMode === "write";
  const gradeOf = isW ? knowWOf : knowOf;
  const seg = reviewSegBy[reviewMode];
  return (isW ? writeBase() : deck()).filter(h => gradeOf(h.c) === seg).map(h => h.c);
}

function setReview(mode, seg) {
  if (mode) reviewMode = mode;
  if (seg && REVIEW_SEGS[reviewMode].includes(seg)) reviewSegBy[reviewMode] = seg;
  renderReview();
}
$("#review-mode").addEventListener("click", e => {
  const b = e.target.closest("button[data-mode]");
  if (b) setReview(b.dataset.mode);
});
$("#review-sub").addEventListener("click", e => {
  const b = e.target.closest("button[data-seg]");
  if (b) setReview(null, b.dataset.seg);
});

function renderReview() {
  const segs = REVIEW_SEGS[reviewMode];
  const seg = reviewSegBy[reviewMode];

  // 모드 / 하위 필터 버튼 상태. 하위 필터는 모드에 맞는 것만 보여줍니다.
  $$("#review-mode button").forEach(b => b.classList.toggle("active", b.dataset.mode === reviewMode));
  $$("#review-sub button").forEach(b => {
    const on = segs.includes(b.dataset.seg);
    b.hidden = !on;
    if (on) b.textContent = reviewSegLabel(reviewMode, b.dataset.seg);
    b.classList.toggle("active", b.dataset.seg === seg);
  });
  // 초기화 버튼도 지금 보고 있는 항목의 것만 노출합니다.
  $("#reset-know").hidden = reviewMode !== "read";
  $("#reset-knowW").hidden = reviewMode !== "write";
  $("#reset-wrong").hidden = reviewMode !== "quiz";

  const chars = reviewChars();
  const list = $("#review-list");
  list.innerHTML = "";

  if (!chars.length) {
    list.innerHTML = `<div class="empty">${REVIEW_EMPTY[reviewMode][seg]}</div>`;
    return;
  }

  const tip = document.createElement("p");
  tip.className = "hint";
  tip.style.cssText = "position:static;text-align:center;margin:0 0 12px";
  tip.textContent = reviewMode === "quiz"
    ? `${chars.length}자 · 탭하면 오답노트에서 지웁니다`
    : `${chars.length}자 · 탭하면 평가를 지워 "몰라요"로 되돌립니다`;

  const grid = document.createElement("div");
  grid.className = "chip-grid";
  chars.forEach(c => {
    const item = findByChar(c);
    if (!item) return;
    const el = document.createElement("div");
    el.className = "chip";
    const cnt = reviewMode === "quiz"
      ? `<div class="mn" style="color:var(--bad)">✕${state.wrong[c]}</div>` : "";
    el.innerHTML = `<div class="ch">${item.c}</div><div class="mn">${item.h} ${item.s}</div>${cnt}`;
    el.addEventListener("click", () => {
      if (reviewMode === "quiz") delete state.wrong[c];
      else if (reviewMode === "write") delete state.knowW[c];
      else delete state.know[c];
      save();
      renderReview();
      renderHome();
    });
    grid.appendChild(el);
  });
  list.appendChild(tip);
  list.appendChild(grid);
}

// ---------- 기록 초기화 ----------
// 읽기(know) · 쓰기(knowW) · 퀴즈(wrong)를 각각 따로 지웁니다.
// 급수·학습 설정은 건드리지 않고, 서로의 기록에도 영향을 주지 않습니다.
$("#reset-know").addEventListener("click", () => {
  const n = Object.keys(state.know).length;
  if (!n) return openConfirm("읽기 기록 초기화", "지울 읽기 기록이 없습니다.");
  const cnt = countBy(deck(), knowOf);
  openConfirm(
    "읽기 기록을 초기화할까요?",
    `읽기 카드의 <b>자가평가 기록 ${n}자</b>가 모두 지워집니다.<br>` +
    `(현재 급수 기준 읽는 ${cnt.yes} · 헷갈리는 ${cnt.maybe})<br><br>` +
    `쓰기·퀴즈 기록은 그대로 남고, <b>되돌릴 수 없습니다.</b>`,
    () => {
      state.know = {};
      state.resume = null;
      save();
      resetFlash();
      renderReview();
      renderHome();
    }
  );
});

$("#reset-knowW").addEventListener("click", () => {
  const n = Object.keys(state.knowW).length;
  if (!n) return openConfirm("쓰기 기록 초기화", "지울 쓰기 기록이 없습니다.");
  const cnt = countBy(writeBase(), knowWOf);
  openConfirm(
    "쓰기 기록을 초기화할까요?",
    `쓰기 연습의 <b>자가평가 기록 ${n}자</b>가 모두 지워집니다.<br>` +
    `(현재 급수 기준 쓰는 ${cnt.yes} · 헷갈리는 ${cnt.maybe})<br><br>` +
    `읽기·퀴즈 기록은 그대로 남고, <b>되돌릴 수 없습니다.</b>`,
    () => {
      state.knowW = {};
      save();
      resetWrite();
      renderReview();
      renderHome();
    }
  );
});

$("#reset-wrong").addEventListener("click", () => {
  const n = wrongChars().length;
  const ok = Object.keys(state.quizOk).length;
  if (!n && !ok) return openConfirm("퀴즈 기록 초기화", "지울 퀴즈 기록이 없습니다.");
  openConfirm(
    "퀴즈 기록을 초기화할까요?",
    `퀴즈 <b>오답노트 ${n}자</b>와 <b>맞힌 글자 ${ok}자</b> 기록이 모두 지워집니다.<br>` +
    `(홈의 퀴즈 학습율도 0부터 다시 시작합니다)<br><br>` +
    `읽기·쓰기 자가평가 기록은 그대로 남고, <b>되돌릴 수 없습니다.</b>`,
    () => {
      state.wrong = {};
      state.quizOk = {};
      save();
      renderReview();
      renderHome();
    }
  );
});

// ---------- 학습 설정 ----------
// 시트를 여는 버튼에 현재 조건을 요약해 보여줍니다.
// 이 시트는 읽기 탭과 쓰기 탭이 같이 씁니다. studyMode 로 구분합니다.
let studyMode = "flash"; // "flash" | "write"
const studyOpts = () => (studyMode === "write" ? state.write : state.flash);

function updateStudySummary() {
  const lvName = (LEVELS.find(l => l.code === state.level) || {}).name || state.level;
  const scope = state.scope === "new" ? "신출한자만" : "시험 범위";
  $("#study-summary").textContent = `${lvName} · ${scope} · ${flashDeck().length}자`;
}

function updateWriteSummary() {
  const lvName = (LEVELS.find(l => l.code === state.level) || {}).name || state.level;
  const range = state.write.fullRange ? "읽기 범위" : "쓰기 범위";
  const scope = state.scope === "new" ? " · 신출" : "";
  $("#study-summary-write").textContent = `${lvName} · ${range}${scope} · ${writeDeck().length}자`;
}

function renderStudySheet() {
  const o = studyOpts();
  const isWrite = studyMode === "write";
  $("#study-sheet h3").textContent = isWrite ? "쓰기 연습 설정" : "읽기 학습 설정";
  $(".sheet-sub").textContent = isWrite
    ? "쓰기 범위와 포함할 글자를 고르세요"
    : "카드 뒷면에 보여줄 정보와 포함할 글자를 고르세요";

  // 모드에 맞는 항목만 노출
  $$("#study-sheet [data-only]").forEach(el => {
    el.hidden = el.dataset.only !== studyMode;
  });

  // 켜짐/꺼짐 스위치
  $$("#study-sheet [data-toggle]").forEach(b => {
    const key = b.dataset.toggle;
    const on = key === "newOnly" ? state.scope === "new" : !!o[key];
    b.classList.toggle("on", on);
  });

  // 자가평가 상태별 글자 수 (해당 탭의 범위·평가 기준)
  const cnt = countBy(isWrite ? writeBase() : deck(), isWrite ? knowWOf : knowOf);
  ["yes", "maybe", "no"].forEach(k => {
    $("#cnt-" + k).textContent = cnt[k] + "자";
    $(`#study-sheet .know-row[data-know="${k}"]`).classList.toggle("on", !!o[k]);
  });
  const target = ["yes", "maybe", "no"].reduce((a, k) => a + (o[k] ? cnt[k] : 0), 0);
  $("#cnt-target").textContent = target + "자";
  $("#study-start").disabled = target === 0;
  $("#study-start").textContent = isWrite ? "쓰기 시작" : "읽기 시작";
}

function openStudySheet(mode) {
  studyMode = mode === "write" ? "write" : "flash";
  renderStudySheet();
  $("#study-backdrop").classList.add("open");
  $("#study-sheet").classList.add("open");
}
function closeStudySheet() {
  $("#study-backdrop").classList.remove("open");
  $("#study-sheet").classList.remove("open");
}

$("#open-study").addEventListener("click", () => openStudySheet("flash"));
$("#open-study-write").addEventListener("click", () => openStudySheet("write"));
$("#study-backdrop").addEventListener("click", closeStudySheet);
$("#study-cancel").addEventListener("click", closeStudySheet);
$("#study-start").addEventListener("click", () => {
  closeStudySheet();
  if (studyMode === "write") resetWrite();
  else resetFlash();
});

$("#study-sheet").addEventListener("click", e => {
  const t = e.target.closest("[data-toggle]");
  if (t) {
    const key = t.dataset.toggle;
    if (key === "newOnly") state.scope = state.scope === "new" ? "cumulative" : "new";
    else studyOpts()[key] = !studyOpts()[key];
    save();
    renderStudySheet();
    return;
  }
  const k = e.target.closest(".know-row");
  if (k) {
    studyOpts()[k.dataset.know] = !studyOpts()[k.dataset.know];
    save();
    renderStudySheet();
  }
});

// ---------- 급수 선택 ----------
function applyLevelChange() {
  save();
  resetFlash();
  const active = document.querySelector("nav.tabbar button.active").dataset.tab;
  switchTab(active);
}

function renderLevelSheet() {
  const box = $("#level-list");
  box.innerHTML = "";

  // 학습 범위 전환: 시험 범위(누적) / 신습한자만
  const seg = document.createElement("div");
  seg.className = "seg scope-seg";
  seg.innerHTML =
    `<button data-scope="cumulative"${state.scope !== "new" ? ' class="active"' : ""}>시험 범위</button>` +
    `<button data-scope="new"${state.scope === "new" ? ' class="active"' : ""}>신습한자만</button>`;
  seg.addEventListener("click", e => {
    const b = e.target.closest("button[data-scope]");
    if (!b) return;
    state.scope = b.dataset.scope;
    renderLevelSheet();
    applyLevelChange();
  });
  box.appendChild(seg);

  LEVELS.forEach(lv => {
    const codes = levelCodes(lv.code, state.scope);
    const count = HANJA.filter(h => codes.includes(h.lv)).length;
    const el = document.createElement("div");
    el.className = "level-item" + (lv.code === state.level ? " sel" : "");
    el.innerHTML = `<div><b>${lv.name}</b> <span>${count}자</span></div>` +
      (lv.code === state.level ? "<span>✓ 선택됨</span>" : "");
    el.addEventListener("click", () => {
      state.level = lv.code;
      closeSheet();
      applyLevelChange();
    });
    box.appendChild(el);
  });
}
function openSheet() { renderLevelSheet(); $("#sheet-backdrop").classList.add("open"); $("#sheet").classList.add("open"); }
function closeSheet() { $("#sheet-backdrop").classList.remove("open"); $("#sheet").classList.remove("open"); }
$("#sheet-backdrop").addEventListener("click", closeSheet);

// ---------- 하루 목표 설정 시트 ----------
// 숫자 입력창 대신 ± 버튼을 씁니다 — 폰에서 키보드가 올라오지 않고 오입력이 없습니다.
function renderGoalSheet() {
  ["read", "write"].forEach(mode => {
    const v = state.daily[mode];
    const row = $(`#goal-${mode}`);
    row.querySelector(".g-val").textContent = v > 0 ? `${v}자` : "끔";
    row.querySelector('[data-step="-1"]').disabled = v <= 0;
    row.querySelector('[data-step="1"]').disabled = v >= GOAL_MAX;
  });
  // 쓰기 배정한자가 없는 급수에서는 쓰기 목표를 설정할 일이 없습니다.
  $("#goal-write").hidden = writeBase().length === 0;
}
$("#daily-sheet").addEventListener("click", e => {
  const b = e.target.closest("button[data-step]");
  if (!b) return;
  const mode = b.closest("[data-goal]").dataset.goal;
  const next = state.daily[mode] + Number(b.dataset.step) * GOAL_STEP;
  state.daily[mode] = Math.max(0, Math.min(GOAL_MAX, next));
  save();
  renderGoalSheet();
  renderDaily();
});
function openGoalSheet() {
  renderGoalSheet();
  $("#daily-backdrop").classList.add("open");
  $("#daily-sheet").classList.add("open");
}
function closeGoalSheet() {
  $("#daily-backdrop").classList.remove("open");
  $("#daily-sheet").classList.remove("open");
}
$("#daily-edit").addEventListener("click", openGoalSheet);
$("#daily-off").addEventListener("click", openGoalSheet);
$("#daily-close").addEventListener("click", closeGoalSheet);
$("#daily-backdrop").addEventListener("click", closeGoalSheet);

// ---------- 초기화 ----------
load();
resetFlash();
renderHome();

// ---------- PWA 서비스워커 등록 + 새 버전 자동 반영 ----------
// sw.js 는 cache-first 라서 그냥 두면 앱을 두 번 열어야 새 화면이 나옵니다
// (첫 열기에 캐시로 그리고, 새 파일 내려받기는 그 뒤에 끝나므로).
// 새 워커가 제어권을 잡는 순간 한 번 새로고침해서 바로 반영합니다.
const SW_RELOAD_KEY = "hanja-sw-reloaded";

// 업데이트 알림 — 알리기만 하면 되므로 잠깐 떴다 스스로 사라집니다.
function showUpdatedToast() {
  const el = document.createElement("div");
  el.className = "update-toast";
  el.textContent = "새 버전으로 업데이트되었습니다";
  document.body.appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
  }, 3500);
}

if ("serviceWorker" in navigator) {
  // 최초 설치 때도 controllerchange 가 옵니다. 그때 새로고침하면 앱을 처음 열
  // 때마다 한 번씩 새로고침되므로, 원래 제어자가 있었는지 기억해 둡니다.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js").catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;                        // 최초 설치는 갱신이 아님
    if (sessionStorage.getItem(SW_RELOAD_KEY)) return; // 이미 했으면 반복 금지
    sessionStorage.setItem(SW_RELOAD_KEY, "1");
    location.reload();
  });
}

// 방금 위 새로고침으로 돌아왔으면 알려줍니다.
// "shown" 으로 바꿔 두어 알림도 한 번, 새로고침도 한 번만 일어나게 합니다.
if (sessionStorage.getItem(SW_RELOAD_KEY) === "1") {
  sessionStorage.setItem(SW_RELOAD_KEY, "shown");
  showUpdatedToast();
}
