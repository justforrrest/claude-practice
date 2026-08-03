// 자원 풀이 번역 — 서당개 김백국
//
// makemeahanzi 의 영어 자원 풀이(회의·지사·상형)를 한국어로 옮깁니다.
// 형성자는 성분으로 문장을 직접 조합하므로 번역 대상이 아닙니다.
//
//   node tools/translate-origin.mjs            안 된 것만 이어서 번역
//   node tools/translate-origin.mjs --dry      요청 없이 대상만 세어 보기
//   node tools/translate-origin.mjs --limit 50 시험 삼아 50건만
//
// 결과는 tools/origin-ko.json 에 쌓입니다. **origin.js 를 직접 고치지 않습니다.**
// build-origin.mjs 가 이 파일을 읽어 x 필드로 합칩니다. 그래야 원본 데이터를
// 다시 받아 빌드해도 번역이 날아가지 않습니다.
//
// 한 배치가 끝날 때마다 저장하므로 중간에 끊겨도 그냥 다시 돌리면 이어집니다.
//
// 인증: 환경변수 ANTHROPIC_API_KEY 또는 tools/.anthropic-key 파일
//       (.opendict-key 와 같은 방식이고 gitignore 처리돼 있습니다)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const OUT = path.join(HERE, "origin-ko.json");
const KEY_FILE = path.join(HERE, ".anthropic-key");

const MODEL = "claude-opus-5";
const BATCH = 50;          // 한 번에 보낼 항목 수
const CONCURRENCY = 3;     // 동시에 띄울 요청 수

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const DRY = process.argv.includes("--dry");
const LIMIT = Number(arg("--limit", 0)) || 0;

// ─── 키 ───────────────────────────────────────────────────────────────
function readKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY.trim();
  if (fs.existsSync(KEY_FILE)) {
    const k = fs.readFileSync(KEY_FILE, "utf8").replace(/^﻿/, "").trim();
    if (k) return k;
  }
  throw new Error(
    `API 키를 찾지 못했습니다.\n` +
    `  환경변수 ANTHROPIC_API_KEY 를 설정하거나\n` +
    `  ${KEY_FILE} 에 키 한 줄을 넣어 주세요.`
  );
}

// ─── 번역 대상 모으기 ─────────────────────────────────────────────────
// origin.js 에서 en(영어 원문)이 있고 아직 번역 안 된 글자를 추립니다.
function collectTargets() {
  const src = fs.readFileSync(path.join(ROOT, "origin.js"), "utf8");
  const { ORIGIN } = new Function(src + "; return { ORIGIN };")();
  const done = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};

  const todo = [];
  for (const [c, o] of Object.entries(ORIGIN)) {
    if (!o.en || done[c]) continue;
    todo.push({ c, en: o.en, t: o.t ?? "" });
  }
  return { todo, done };
}

// ─── 프롬프트 ─────────────────────────────────────────────────────────
const SYSTEM = `당신은 한자 학습 앱의 자원(字源) 풀이를 우리말로 옮기는 번역자입니다.
이 앱은 한국 어문회 한자능력검정시험을 준비하는 학습자가 씁니다.

번역 규칙:
- 원문에 있는 한자(女, 宀, 日 …)는 그대로 두고 영어 부분만 우리말로 옮깁니다.
- 그 한자의 우리말 훈음을 괄호로 덧붙이면 이해가 쉬워집니다.
  예: "A woman 女 safe in a house 宀"
   -> "집 宀 안에 여자 女 가 편안히 있는 모습"
- 한 문장, 40자 안팎으로 짧게. 학습자가 글자를 외울 때 떠올릴 그림이 목표입니다.
- "~를 나타낸다", "~를 의미한다" 같은 상투적인 맺음말은 빼고 장면을 묘사하세요.
- 원문의 "compare 川", "see 竹" 같은 참조는 "川 과 비교", "竹 참고" 로 짧게 옮깁니다.
- 원문이 성분의 뜻만 나열한 부실한 것이면(예: "wood") 억지로 늘리지 말고
  그 성분이 뜻을 담당한다는 사실만 간결히 적습니다.
- 존댓말·설명체 말고 명사형이나 평서형으로 끝내세요.`;

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          c: { type: "string", description: "한자 한 글자. 입력받은 것 그대로." },
          ko: { type: "string", description: "우리말 자원 풀이 한 문장." },
        },
        required: ["c", "ko"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

async function translateBatch(client, batch) {
  const lines = batch.map(b => `${b.c}\t[${b.t}]\t${b.en}`).join("\n");
  // 긴 출력에서 HTTP 타임아웃을 피하려고 스트리밍으로 받습니다
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    system: SYSTEM,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: SCHEMA },
    },
    messages: [{
      role: "user",
      content:
        "아래는 '한자\\t유형\\t영어 자원 풀이' 목록입니다. 각 줄을 우리말로 옮겨 주세요.\n" +
        "입력한 한자를 하나도 빠뜨리지 말고, c 에는 입력받은 한자를 그대로 넣으세요.\n\n" +
        lines,
    }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("모델이 응답을 거절했습니다");
  const text = msg.content.find(b => b.type === "text")?.text ?? "";
  const parsed = JSON.parse(text);
  return parsed.items ?? [];
}

// ─── 본체 ─────────────────────────────────────────────────────────────
async function main() {
  const { todo, done } = collectTargets();
  const already = Object.keys(done).length;

  console.log(`이미 번역됨 : ${already}건`);
  console.log(`남은 대상   : ${todo.length}건`);
  if (DRY) {
    console.log("\n예시 3건:");
    todo.slice(0, 3).forEach(t => console.log(`  ${t.c} [${t.t}] ${t.en}`));
    return;
  }
  if (!todo.length) { console.log("할 일이 없습니다."); return; }

  const work = LIMIT ? todo.slice(0, LIMIT) : todo;
  const batches = [];
  for (let i = 0; i < work.length; i += BATCH) batches.push(work.slice(i, i + BATCH));
  console.log(`${batches.length}개 배치 (배치당 최대 ${BATCH}건, 동시 ${CONCURRENCY}개)\n`);

  const client = new Anthropic({ apiKey: readKey() });
  const result = { ...done };
  let finished = 0, failed = 0;

  // 배치가 끝날 때마다 저장합니다. 중간에 끊겨도 다시 돌리면 이어집니다.
  const save = () => fs.writeFileSync(
    OUT, JSON.stringify(result, Object.keys(result).sort(), 1) + "\n", "utf8");

  const queue = batches.map((b, i) => ({ b, i }));
  const worker = async () => {
    while (queue.length) {
      const { b, i } = queue.shift();
      try {
        const items = await translateBatch(client, b);
        const want = new Set(b.map(x => x.c));
        let got = 0;
        for (const { c, ko } of items) {
          if (!want.has(c) || !ko) continue;      // 엉뚱한 글자는 버립니다
          result[c] = ko.trim();
          got++;
        }
        finished++;
        save();
        console.log(`  [${finished}/${batches.length}] 배치 ${i + 1}: ${got}/${b.length}건`);
        if (got < b.length) {
          console.log(`    (${b.length - got}건 누락 — 다시 돌리면 이어서 시도합니다)`);
        }
      } catch (e) {
        failed++;
        console.error(`  [배치 ${i + 1}] 실패: ${e.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  save();
  console.log(`\n번역 누적 : ${Object.keys(result).length}건 -> ${path.relative(ROOT, OUT)}`);
  if (failed) console.log(`실패 배치 : ${failed}개 — 다시 돌리면 이어서 시도합니다`);
  console.log(`\n다음: node tools/build-origin.mjs  (번역을 origin.js 에 합칩니다)`);
}

main().catch(e => { console.error("\n실패:", e.message); process.exit(1); });
