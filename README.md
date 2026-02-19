# 🤖 CRD Autobot

> **CoinRandomDefense 밸런스 체크 QA 자동화 머신**

Puppeteer 기반 자동화 도구로, 게임을 반복 플레이하며 **유닛 밸런스, 경제 곡선, DPS 요구량, 시너지 효과** 등을 검증합니다.

---

## 📦 설치

```bash
cd CRDtest
npm install
```

> 의존성: `puppeteer`, `vite`, `typescript`

---

## 🚀 사용법

### 0. 게임 서버 실행 (필수)

```bash
npm run dev
# → http://localhost:5173
```

---

### 1. AI 밸런스 테스트 — `npm run ai`

N판 자동 플레이→ 라운드별 DPS/경제/HP 데이터 수집 → 밸런스 리포트 생성

```bash
npm run ai
```

**수집 데이터:**
- 라운드별 골드/HP/DPS/레벨/보드 크기
- DPS vs requiredDPS 달성률
- 시너지 활성 빈도
- 합성(★) 달성 타이밍
- 게임 간 전략 조정 로그

**출력:**

| 파일 | 설명 |
|------|------|
| `ai-screenshots/g{N}_{round}.png` | 라운드별 캡처 |
| `ai-records.json` | 전 게임 상세 로그 |

---

### 2. DOM 디버그 — `npm run debug`

게임 DOM 구조를 분석하고 한 라운드를 step-by-step 추적합니다.

```bash
npm run debug
```

---

### 3. QA 테스트 — `npm run qa`

게임 기능 통합 QA 테스트를 실행합니다.

```bash
npm run qa
```

---

### 4. QA 스크린샷 — `npm run qa:screenshot`

```bash
npm run qa:screenshot
```

---

### 5. 스테이지 진행 테스트 — `npm run test:stage`

```bash
npm run test:stage
```

---

## 🏗️ 아키텍처

```
CRDtest/
├── ai-player.mjs          ← 밸런스 테스트 AI (메인)
├── debug-dom.mjs           ← DOM 디버깅
├── qa-test.mjs             ← QA 통합 테스트
├── qa-screenshot.mjs       ← QA 스크린샷
├── test-beyond-2-7.mjs     ← 스테이지 진행 테스트
├── ai-records.json         ← 밸런스 데이터
├── ai-screenshots/         ← 게임 캡처
└── qa-screenshots/         ← QA 캡처
```

### AI 모듈 구조

```
ai-player.mjs
├── UNIT_DB              46개 유닛 DB
├── GameStateReader       DOM → 게임 상태 추출
├── StrategyEngine        경제/구매/배치 판단
├── ActionExecutor        Puppeteer 클릭 실행
├── GameRunner            게임 루프 관리
└── LearningMemory        전략 조정
```

---

## ⚙️ 설정

```js
const TOTAL_GAMES = 5;  // 테스트 판 수

const defaultStrategy = {
  interestFloor: 10,       // 이자 보존 최소 골드
  earlyRerollLimit: 0,     // 초반 리롤 횟수
  midRerollBudget: 6,      // 중반 리롤 예산
  lateRerollBudget: 20,    // 후반 리롤 예산
  xpBuyStartRound: 4,      // XP 구매 시작 라운드
  xpBuyGoldThreshold: 30,  // XP 구매 골드 기준
  originWeights: { ... },  // 시너지 가중치
};
```

---

## 📋 참고

- **싱글 모드**: 7-7까지 진행 (49라운드)
- **4인 경쟁 모드**: 7-7까지 진행 (서버 필요)
- 스크린샷/로그는 실행마다 새로 생성
