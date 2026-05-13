# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

모든 결과값, 설명, 응답은 반드시 한국어로 작성한다.

## Project Overview

이 프로젝트는 순수 HTML/CSS/JavaScript로 만든 정적 웹 페이지 모음입니다. 별도의 빌드 도구, 패키지 매니저, 서버가 없으며 브라우저에서 파일을 직접 열어 실행합니다.

## Running the Project

파일을 브라우저에서 직접 열거나, 간단한 로컬 서버로 실행:

```powershell
# PowerShell - 특정 파일 바로 열기
Start-Process "C:\Users\feelw\OneDrive\문서\★HOME PC★\claude-practice\calculator.html"

# Python이 설치된 경우 로컬 서버
python -m http.server 8080
```

## Architecture

- **단일 파일 구조**: 각 페이지는 HTML 1개 파일에 `<style>`과 `<script>`가 인라인으로 포함된 자급자족(self-contained) 구조입니다.
- **외부 의존성**: Google Fonts (Inter)만 CDN으로 로드하며, JS 라이브러리는 사용하지 않습니다.

## Git & GitHub

`일정관리/주간관리플래너.html` 또는 `CLAUDE.md` 파일을 수정할 때는 반드시 수정 완료 후 GitHub에 push한다:

```powershell
cd "C:\Users\feelw\OneDrive\문서\★HOME PC★\claude-practice"
git add 일정관리/주간관리플래너.html CLAUDE.md
git commit -m "커밋 메시지"
git push origin master
```

## Design System (Linear Style)

프로젝트는 Linear(linear.app) 디자인 언어를 따릅니다 (밝은 테마 기본):

- **배경**: `#ffffff` / `#f7f7f8` (흰색/밝은 회색)
- **카드/컴포넌트**: `#ffffff`, 테두리 `rgba(0,0,0,0.08)`
- **강조색**: 퍼플 계열 `#5b21b6` / `#7c3aed`
- **텍스트**: `#0f0f10` (기본), 보조 `#6b7280`
- **폰트**: Inter (Google Fonts), weight 300–600
- **그림자**: 다층 box-shadow로 깊이감 표현
- **인터랙션**: hover는 `opacity: 0.04` dark overlay, active는 `scale(0.96)`
