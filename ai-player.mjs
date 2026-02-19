/**
 * CoinRandomDefense v3.5 — AI Game Player v2
 * 
 * 챌린저급 성장 자동화 시스템
 * Fixed: bench/board card selectors, combat detection, placement logic
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { postGameAnalysis, suggestPatches, improveStrategy } from './llm-advisor.mjs';

const SCREENSHOT_DIR = path.resolve('ai-screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR);
const RECORDS_FILE = path.resolve('ai-records.json');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ============================================================
// UNIT DATABASE (from GAME_INFO.md / config.ts)
// ============================================================

const UNIT_DB = {
    // 1코 (8종)
    'PC방 채굴자': { cost: 1, origin: 'Bitcoin', dmgType: 'physical', dps: 6 },
    '메타마스크 유저': { cost: 1, origin: 'DeFi', dmgType: 'magic', dps: 7 },
    '스캠 개발자': { cost: 1, origin: 'Social', dmgType: 'magic', dps: 7 },
    'PerpDEX': { cost: 1, origin: 'Exchange', dmgType: 'physical', dps: 8 },
    'HODLer': { cost: 1, origin: 'VC', dmgType: 'physical', dps: 8 },
    'FUD 유포자': { cost: 1, origin: 'FUD', dmgType: 'magic', dps: 8 },
    'PI User': { cost: 1, origin: 'Rugpull', dmgType: 'physical', dps: 8 },
    'Gareth Soloway': { cost: 1, origin: 'Bear', dmgType: 'magic', dps: 7 },
    // 2코 (8종)
    'Jack Dorsey': { cost: 2, origin: 'Bitcoin', dmgType: 'physical', dps: 14 },
    'Jesse Pollak': { cost: 2, origin: 'DeFi', dmgType: 'magic', dps: 15 },
    '워뇨띠': { cost: 2, origin: 'Social', dmgType: 'magic', dps: 16 },
    'Jesse Powell': { cost: 2, origin: 'Exchange', dmgType: 'physical', dps: 15 },
    'OpenSea': { cost: 2, origin: 'VC', dmgType: 'physical', dps: 15 },
    'Craig Wright': { cost: 2, origin: 'FUD', dmgType: 'magic', dps: 14 },
    'Daniele Sesta': { cost: 2, origin: 'Rugpull', dmgType: 'physical', dps: 14 },
    'Hsaka': { cost: 2, origin: 'Bear', dmgType: 'magic', dps: 15 },
    // 3코 (8종)
    'Roger Ver': { cost: 3, origin: 'Bitcoin', dmgType: 'physical', dps: 21 },
    'Andre Cronje': { cost: 3, origin: 'DeFi', dmgType: 'magic', dps: 24 },
    'Rekt': { cost: 3, origin: 'Social', dmgType: 'magic', dps: 27 },
    'Wintermute': { cost: 3, origin: 'Exchange', dmgType: 'physical', dps: 23 },
    'Simon': { cost: 3, origin: 'VC', dmgType: 'physical', dps: 25 },
    'Peter Schiff': { cost: 3, origin: 'FUD', dmgType: 'magic', dps: 23 },
    'GCR': { cost: 3, origin: 'Rugpull', dmgType: 'physical', dps: 26 },
    'Andrew Kang': { cost: 3, origin: 'Bear', dmgType: 'magic', dps: 18 },
    // 4코 (8종)
    'Stani Kulechov': { cost: 4, origin: 'Bitcoin', dmgType: 'physical', dps: 58 },
    'Gavin Wood': { cost: 4, origin: 'DeFi', dmgType: 'magic', dps: 71 },
    'Hayden Adams': { cost: 4, origin: 'Social', dmgType: 'magic', dps: 60 },
    'Marc Andreessen': { cost: 4, origin: 'Exchange', dmgType: 'physical', dps: 54 },
    'Balaji': { cost: 4, origin: 'VC', dmgType: 'physical', dps: 63 },
    'Lazarus': { cost: 4, origin: 'FUD', dmgType: 'magic', dps: 76 },
    'Zhu Su': { cost: 4, origin: 'Rugpull', dmgType: 'physical', dps: 77 },
    'Anatoly': { cost: 4, origin: 'Bear', dmgType: 'magic', dps: 66 },
    // 5코 (8종)
    'Saylor': { cost: 5, origin: 'Bitcoin', dmgType: 'physical', dps: 112 },
    'Shayne Coplan': { cost: 5, origin: 'DeFi', dmgType: 'magic', dps: 147 },
    'Armstrong': { cost: 5, origin: 'Social', dmgType: 'magic', dps: 121 },
    'Arthur Hayes': { cost: 5, origin: 'Exchange', dmgType: 'physical', dps: 140 },
    'Jeff': { cost: 5, origin: 'VC', dmgType: 'physical', dps: 130 },
    'Do Kwon': { cost: 5, origin: 'FUD', dmgType: 'magic', dps: 117 },
    'SBF': { cost: 5, origin: 'Rugpull', dmgType: 'physical', dps: 130 },
    'Justin Sun': { cost: 5, origin: 'Bear', dmgType: 'magic', dps: 112 },
    // 7코 히든 (5종)
    'Vitalik': { cost: 7, origin: 'DeFi', dmgType: 'magic', dps: 326 },
    'CZ': { cost: 7, origin: 'Exchange', dmgType: 'physical', dps: 272 },
    'Elon': { cost: 7, origin: 'Social', dmgType: 'magic', dps: 294 },
    'Donald Trump': { cost: 7, origin: 'Bitcoin', dmgType: 'physical', dps: 277 },
    'Gensler': { cost: 7, origin: 'FUD', dmgType: 'magic', dps: 282 },
    // 10코 궁극
    '나카모토 사토시': { cost: 10, origin: 'Bitcoin', dmgType: 'physical', dps: 848 },
};

function lookupUnit(name) {
    if (!name) return null;
    const trimmed = name.trim();
    if (UNIT_DB[trimmed]) return { name: trimmed, ...UNIT_DB[trimmed] };
    for (const [key, val] of Object.entries(UNIT_DB)) {
        if (trimmed.includes(key) || key.includes(trimmed)) return { name: key, ...val };
    }
    return null;
}

// ============================================================
// STRATEGY PARAMETERS (adjusted by learning)
// ============================================================

const defaultStrategy = {
    interestFloor: 10,       // 낮춰서 초반에 더 많이 투자
    earlyRerollLimit: 4,     // 초반에도 리롤 O
    midRerollBudget: 10,     // 중반 리롤 예산 ↑
    lateRerollBudget: 30,    // 후반 리롤 예산 ↑
    xpBuyStartRound: 2,      // XP 구매 2라운드부터
    xpBuyGoldThreshold: 20,  // XP 구매 골드 기준 ↓
    originWeights: {
        Bitcoin: 1.0, DeFi: 1.0, Social: 1.0, Exchange: 1.0,
        VC: 1.0, FUD: 1.2, Rugpull: 1.0, Bear: 1.0,
    },
    // 몬스터 경로 = 테두리 반시계방향. 중앙 셀이 사거리 커버 최대
    preferredPositions: [
        // Tier 1: 중앙 코어 (모든 테두리와 가까움)
        { x: 3, y: 1 }, { x: 3, y: 2 },
        { x: 2, y: 1 }, { x: 4, y: 1 },
        { x: 2, y: 2 }, { x: 4, y: 2 },
        // Tier 2: 중앙 확장
        { x: 1, y: 1 }, { x: 5, y: 1 },
        { x: 1, y: 2 }, { x: 5, y: 2 },
        // Tier 3: 테두리 (경로 위 = DPS 좋지만 단면만 커버)
        { x: 3, y: 0 }, { x: 3, y: 3 },
        { x: 2, y: 0 }, { x: 4, y: 0 },
        { x: 2, y: 3 }, { x: 4, y: 3 },
        // Tier 4: 코너 (최악)
        { x: 0, y: 1 }, { x: 6, y: 1 },
        { x: 0, y: 2 }, { x: 6, y: 2 },
        { x: 1, y: 0 }, { x: 5, y: 0 },
        { x: 1, y: 3 }, { x: 5, y: 3 },
        { x: 0, y: 0 }, { x: 6, y: 0 },
        { x: 0, y: 3 }, { x: 6, y: 3 },
    ],
};

// ============================================================
// MODULE 1: GAME STATE READER (fixed selectors!)
// ============================================================

async function readGameState(page) {
    return page.evaluate(() => {
        const getText = (id) => document.getElementById(id)?.innerText?.trim() || '';
        const gold = parseInt(getText('hud-gold')) || 0;
        const hp = parseInt(getText('hud-hp')) || 0;
        const round = getText('hud-round');
        const level = parseInt(getText('hud-level')) || 1;
        const dps = parseInt(getText('hud-dps')) || 0;

        // Shop units — uses .unit-name, .unit-cost, .unit-origin, .merge-badge
        const shopSlots = document.getElementById('shop-slots');
        const shop = [];
        if (shopSlots) {
            for (const slot of shopSlots.children) {
                if (slot.classList.contains('empty')) {
                    shop.push(null);
                } else {
                    const nameEl = slot.querySelector('.unit-name');
                    const costEl = slot.querySelector('.unit-cost');
                    const originEl = slot.querySelector('.unit-origin');
                    const hasMerge = slot.querySelector('.merge-badge');
                    const mergeLevel = hasMerge ? hasMerge.textContent.trim() : '';
                    shop.push({
                        name: nameEl?.textContent?.trim() || '',
                        cost: parseInt(costEl?.textContent?.replace(/[^0-9]/g, '')) || 0,
                        origin: originEl?.textContent?.trim() || '',
                        canAfford: !slot.style.opacity || parseFloat(slot.style.opacity) > 0.5,
                        mergeReady: mergeLevel.includes('★★★') ? 3 : mergeLevel.includes('★★') ? 2 : 0,
                    });
                }
            }
        }

        // Bench units — card uses .name (NOT .unit-name!), .star, .cost-badge
        const benchSlotsEl = document.getElementById('bench-slots');
        const bench = [];
        if (benchSlotsEl) {
            for (let i = 0; i < benchSlotsEl.children.length; i++) {
                const slot = benchSlotsEl.children[i];
                const card = slot.querySelector('.unit-card');
                if (card) {
                    const name = card.querySelector('.name')?.textContent?.trim() || '';
                    const starText = card.querySelector('.star')?.textContent || '';
                    const stars = (starText.match(/⭐/g) || []).length || 1;
                    bench.push({ index: i, name, stars });
                }
            }
        }

        // Board units — same card structure
        const boardGrid = document.getElementById('board-grid');
        const board = [];
        const emptyBoardCells = [];
        if (boardGrid) {
            for (const cell of boardGrid.children) {
                const x = parseInt(cell.dataset.x);
                const y = parseInt(cell.dataset.y);
                if (cell.classList.contains('occupied')) {
                    const card = cell.querySelector('.unit-card');
                    const name = card?.querySelector('.name')?.textContent?.trim() || '';
                    const starText = card?.querySelector('.star')?.textContent || '';
                    const stars = (starText.match(/⭐/g) || []).length || 1;
                    board.push({ x, y, name, stars });
                } else {
                    emptyBoardCells.push({ x, y });
                }
            }
        }

        // Board count
        const boardCountText = document.getElementById('board-count')?.textContent || '0/1';
        const [boardCurrent, boardMax] = boardCountText.split('/').map(s => parseInt(s) || 0);

        // Synergies
        const synergyList = document.getElementById('synergy-list');
        const synergies = [];
        if (synergyList) {
            for (const row of synergyList.children) {
                const count = parseInt(row.querySelector('.synergy-count')?.textContent) || 0;
                const name = row.querySelector('.synergy-name')?.textContent?.trim() || '';
                const isActive = row.classList.contains('active');
                synergies.push({ name, count, isActive });
            }
        }

        // DPS info
        const dpsRequired = document.querySelector('.dps-required span:last-child');
        const requiredDPS = dpsRequired ? parseInt(dpsRequired.textContent) || 0 : 0;
        const dpsDeficit = document.querySelector('.dps-deficit');
        const deficit = dpsDeficit ? parseInt(dpsDeficit.textContent.replace(/[^0-9]/g, '')) || 0 : 0;

        // Combat state — ONLY use button text (disabled can be true when board empty!)
        const combatBtn = document.getElementById('btn-next-round');
        const btnText = combatBtn?.textContent?.trim() || '';
        const inCombat = btnText.includes('전투 중') || btnText.includes('대기 중');

        // Game over — check if app is hidden or result screen visible
        const appHidden = document.getElementById('app')?.classList.contains('hidden') ?? false;
        const resultVisible = (() => {
            const rv = document.getElementById('result-view');
            return rv ? !rv.classList.contains('hidden') : false;
        })();
        const isGameOver = appHidden || resultVisible;

        return {
            gold, hp, round, level, dps,
            shop, bench, board, emptyBoardCells,
            boardCurrent, boardMax,
            synergies, requiredDPS, deficit,
            inCombat, isGameOver,
        };
    });
}

// ============================================================
// MODULE 2: STRATEGY ENGINE  
// ============================================================

function evaluateUnit(shopUnit, gameState, strategy) {
    if (!shopUnit || !shopUnit.canAfford) return -999;

    const info = lookupUnit(shopUnit.name);
    if (!info) return 1;

    let score = 0;
    const stage = parseInt(gameState.round?.split('-')[0]) || 1;
    const subRound = parseInt(gameState.round?.split('-')[1]) || 1;
    const deficit = gameState.deficit || 0;

    // ============================================
    // 1. DPS/골드 효율 (핵심 지표)
    // ============================================
    const dpsPerGold = info.dps / info.cost;
    score += dpsPerGold * 5;

    // 보드 슬롯 여유 있으면 바로 전력 보강
    if (gameState.boardCurrent < gameState.boardMax) {
        score += 30;  // 빈 슬롯이면 아무 유닛이든 가치 높음
    }

    // DPS 부족할수록 구매 가치 급상승
    if (deficit > 0) {
        score += Math.min(100, deficit * 3);
    }

    // ============================================
    // 2. 합성 우선순위 (최고 가성비)
    // ============================================
    const ownedCount = [...gameState.bench, ...gameState.board]
        .filter(u => u && u.name === shopUnit.name).length;
    if (ownedCount >= 2) score += 500;  // ★2 확정 = 무조건 삼
    else if (ownedCount === 1) score += 80;  // 2장째 = 준비

    // mergeReady 감지 (게임 UI에서 제공)
    if (shopUnit.mergeReady === 3) score += 600;
    else if (shopUnit.mergeReady === 2) score += 300;

    // ============================================
    // 3. 시너지 연계
    // ============================================
    const existingOrigins = {};
    for (const u of gameState.board) {
        const uInfo = lookupUnit(u.name);
        if (uInfo) existingOrigins[uInfo.origin] = (existingOrigins[uInfo.origin] || 0) + 1;
    }
    const originCount = existingOrigins[info.origin] || 0;
    // 시너지 임계점(1→2, 3→4, 5→6)에 가까울수록 보너스
    if (originCount === 1) score += 60;   // 2개 달성 직전
    else if (originCount === 3) score += 80;  // 4개 달성 직전
    else if (originCount === 5) score += 100; // 6개 달성 직전
    else if (originCount >= 1) score += 25;

    // Origin weight from learning
    score *= (strategy.originWeights[info.origin] || 1.0);

    // ============================================
    // 4. 스테이지별 코스트 제한
    // ============================================
    if (stage <= 1 && info.cost >= 4) score -= 100;  // 초반 고코 유닛 비효율
    if (stage >= 3 && info.cost >= 3) score += 20;   // 중반 이후 고코 선호
    if (stage >= 4 && info.cost >= 4) score += 40;   // 후반 4-5코 적극 픽

    // ============================================
    // 5. 초반 공격적 구매 (골드 아끼지 않기)
    // ============================================
    if (stage === 1) {
        score += 15;  // 스테이지 1에선 뭐든 사는 게 이득
        if (info.cost === 1) score += 10;  // 1코 유닛 최우선
    }

    return score;
}

function shouldReroll(gameState, strategy, goldSpentThisTurn) {
    const { gold, round, bench, boardCurrent, boardMax, deficit } = gameState;
    const stage = parseInt(round?.split('-')[0]) || 1;
    const subRound = parseInt(round?.split('-')[1]) || 1;

    if (bench.length >= 9) return false;
    if (gold < 4) return false;

    // 스테이지별 리롤 예산
    const budget = stage <= 1 ? strategy.earlyRerollLimit
        : stage <= 3 ? strategy.midRerollBudget
            : strategy.lateRerollBudget;
    if (goldSpentThisTurn >= budget) return false;

    // 보드가 비어있으면 무조건 리롤 (유닛이 필요)
    if (boardCurrent < boardMax && gold >= 4) return true;

    // DPS 부족하면 리롤하여 더 강한 유닛 탐색
    if (deficit > 10 && gold >= 6) return true;

    // 합성 가능한 유닛이 있으면 리롤 금지 (이미 상점에 있으니 사기)
    const hasGoodShop = gameState.shop.some(s => s && (s.mergeReady >= 2));
    if (hasGoodShop) return false;

    // 벤치에 합성 대기(2장)인 유닛이 있으면 리롤해서 3장째 찾기
    const pairNames = {};
    for (const u of [...bench, ...gameState.board]) {
        if (u?.name) pairNames[u.name] = (pairNames[u.name] || 0) + 1;
    }
    const hasPair = Object.values(pairNames).some(c => c === 2);
    if (hasPair && gold >= 6) return true;

    // 골드 50 이상이면 그냥 리롤
    if (gold > 50) return true;

    // 이자 걱정 없으면 리롤
    if (gold - 2 >= strategy.interestFloor + 5) return true;

    return false;
}

function shouldBuyXP(gameState, strategy) {
    const { gold, level, round, boardCurrent, boardMax } = gameState;
    const roundNum = parseRoundNumber(round);
    const subRound = parseInt(round?.split('-')[1]) || 1;

    if (level >= 10) return false;
    if (gold < 4) return false;

    // 보드가 꽉 차면 레벨업으로 슬롯 확보 (최우선)
    if (boardCurrent >= boardMax && gold >= 4) return true;

    // 라운드 2부터 XP 구매 허용
    if (roundNum < strategy.xpBuyStartRound) return false;

    // 골드 여유 있으면 XP 구매
    if (gold >= strategy.xpBuyGoldThreshold) return true;

    // 보스전 직전(x-5, x-6)에 레벨업 준비
    if (subRound >= 5 && gold >= 8) return true;

    // 이자 기준 이상이면 XP 구매
    if (gold - 4 >= strategy.interestFloor) return true;

    return false;
}

function parseRoundNumber(roundStr) {
    if (!roundStr) return 1;
    const parts = roundStr.split('-').map(Number);
    if (parts.length < 2) return parts[0] || 1;
    const [s, r] = parts;
    if (s === 1) return r;
    return 3 + (s - 2) * 7 + (r || 1);
}

function chooseBestPlacement(gameState, strategy) {
    const occupied = new Set(gameState.board.map(u => `${u.x},${u.y}`));
    for (const pos of strategy.preferredPositions) {
        if (!occupied.has(`${pos.x},${pos.y}`)) return pos;
    }
    return gameState.emptyBoardCells[0] || null;
}

// ============================================================
// MODULE 3: ACTION EXECUTOR
// ============================================================

async function clickReroll(page) {
    await page.evaluate(() => document.getElementById('btn-reroll')?.click());
    await sleep(350);
}

async function clickBuyXP(page) {
    await page.evaluate(() => document.getElementById('btn-buy-xp')?.click());
    await sleep(350);
}

async function clickShopSlot(page, index) {
    await page.evaluate((i) => {
        const slots = document.getElementById('shop-slots');
        if (slots?.children[i]) slots.children[i].click();
    }, index);
    await sleep(400);
}

async function clickBenchSlot(page, index) {
    await page.evaluate((i) => {
        const slots = document.getElementById('bench-slots');
        if (slots?.children[i]) slots.children[i].click();
    }, index);
    await sleep(350);
}

async function clickBoardCell(page, x, y) {
    await page.evaluate((tx, ty) => {
        const grid = document.getElementById('board-grid');
        if (!grid) return;
        for (const cell of grid.children) {
            if (parseInt(cell.dataset.x) === tx && parseInt(cell.dataset.y) === ty) {
                cell.click();
                break;
            }
        }
    }, x, y);
    await sleep(350);
}

async function clickStartCombat(page) {
    await page.evaluate(() => document.getElementById('btn-next-round')?.click());
    await sleep(500);
}

async function waitCombatEnd(page, timeout = 180000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const check = await page.evaluate(() => {
            const btn = document.getElementById('btn-next-round');
            const text = btn?.textContent?.trim() || '';
            const disabled = btn?.disabled;
            // Game over — app hidden or result view visible
            const appHidden = document.getElementById('app')?.classList.contains('hidden') ?? false;
            const resultVisible = (() => {
                const rv = document.getElementById('result-view');
                return rv ? !rv.classList.contains('hidden') : false;
            })();
            const isOver = appHidden || resultVisible;

            return {
                text, disabled, isOver,
                round: document.getElementById('hud-round')?.innerText?.trim(),
                hp: parseInt(document.getElementById('hud-hp')?.innerText) || 0,
            };
        });

        if (check.isOver || check.hp <= 0) return { ...check, isGameOver: true };

        // Combat ended when button says 전투 시작 AND is not disabled
        if (check.text.includes('전투 시작') && !check.disabled) {
            return { ...check, isGameOver: false };
        }

        await sleep(2000);
    }
    console.log('  ⏰ 전투 타임아웃 — 다음 라운드로 진행');
    // On timeout, try to continue anyway
    return { isGameOver: false, text: '', round: '' };
}

async function takeGameScreenshot(page, name) {
    try {
        await page.evaluate(() => {
            const wr = document.getElementById('game-scale-wrapper');
            if (wr) { wr.dataset.origTransform = wr.style.transform; wr.style.transform = 'none'; wr.style.left = '0'; wr.style.top = '0'; wr.style.position = 'relative'; }
            const lobby = document.getElementById('lobby-screen');
            if (lobby) lobby.style.display = 'none';
        });
        await sleep(100);
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, name), fullPage: true });
        await page.evaluate(() => {
            const wr = document.getElementById('game-scale-wrapper');
            if (wr && wr.dataset.origTransform) { wr.style.transform = wr.dataset.origTransform; delete wr.dataset.origTransform; }
        });
    } catch (e) {
        console.log(`  ⚠️ 스크린샷 실패: ${e.message}`);
    }
}

// ============================================================
// MODULE 4: GAME RUNNER
// ============================================================

async function enterNormalGame(page) {
    console.log('  🎮 일반전 진입...');
    // 1. 일반전 버튼 클릭
    await page.evaluate(() => document.getElementById('btn-normal')?.click());
    await sleep(1500);

    // 2. 솔로 모드 클릭
    await page.evaluate(() => document.getElementById('btn-solo')?.click());
    await sleep(3000);

    // 3. 게임 로드 대기
    for (let attempt = 0; attempt < 15; attempt++) {
        const hasGame = await page.evaluate(() =>
            !!(document.getElementById('hud-gold') && document.getElementById('btn-reroll'))
        );
        if (hasGame) {
            console.log('  ✅ 게임 로드됨');
            return true;
        }
        await sleep(1000);
    }
    console.log('  ❌ 게임 미로드');
    return false;
}

async function playPrepPhase(page, gameState, strategy, gameLog) {
    const round = gameState.round;
    const stage = parseInt(round?.split('-')[0]) || 1;
    let goldSpentReroll = 0;
    let goldSpentUnits = 0;
    let goldSpentXP = 0;
    let unitsBought = [];
    let actions = [];

    console.log(`\n  ── ${round} ── 💰${gameState.gold}G ❤️${gameState.hp} Lv.${gameState.level} [${gameState.boardCurrent}/${gameState.boardMax}]`);

    // === Step 1: Buy good units from current shop ===
    let state = gameState;

    for (let pass = 0; pass < 3; pass++) {
        state = await readGameState(page);

        const scored = state.shop.map((u, i) => ({
            unit: u, index: i, score: evaluateUnit(u, state, strategy)
        }))
            .filter(s => s.score > 0 && s.unit?.canAfford)
            .sort((a, b) => b.score - a.score);

        let boughtThisPass = false;
        for (const item of scored) {
            // Don't overfill bench
            if (state.bench.length >= 8 && state.boardCurrent >= state.boardMax) break;
            if (state.gold < item.unit.cost) continue;

            const mergeTag = item.unit.mergeReady >= 2 ? ' ★합성!' : '';
            console.log(`    💰 ${item.unit.name} (${item.unit.cost}G, S:${item.score.toFixed(0)}${mergeTag})`);
            await clickShopSlot(page, item.index);
            goldSpentUnits += item.unit.cost;
            unitsBought.push({ name: item.unit.name, cost: item.unit.cost, merged: item.unit.mergeReady >= 2 });
            actions.push({ type: 'buy', name: item.unit.name, cost: item.unit.cost });
            boughtThisPass = true;
            state = await readGameState(page);
        }

        // Reroll if beneficial (only on pass 0 or 1)
        if (pass < 2 && shouldReroll(state, strategy, goldSpentReroll)) {
            console.log(`    🔄 리롤 (${state.gold}G → ${state.gold - 2}G)`);
            await clickReroll(page);
            goldSpentReroll += 2;
            actions.push({ type: 'reroll' });
            state = await readGameState(page);
        } else if (!boughtThisPass) {
            break; // Nothing more to do
        }
    }

    // === Step 2: Additional merge-hunting rerolls ===
    let extraRerolls = 0;
    while (shouldReroll(state, strategy, goldSpentReroll) && extraRerolls < 3) {
        await clickReroll(page);
        goldSpentReroll += 2;
        extraRerolls++;
        state = await readGameState(page);

        const scored = state.shop.map((u, i) => ({
            unit: u, index: i, score: evaluateUnit(u, state, strategy)
        }))
            .filter(s => s.score > 50 && s.unit?.canAfford)
            .sort((a, b) => b.score - a.score);

        for (const item of scored) {
            if (state.bench.length >= 8 && state.boardCurrent >= state.boardMax) break;
            if (state.gold < item.unit.cost) continue;
            console.log(`    💰 [리롤] ${item.unit.name} (${item.unit.cost}G)`);
            await clickShopSlot(page, item.index);
            state = await readGameState(page);
        }
    }

    // === Step 3: Buy XP ===
    let xpBought = 0;
    state = await readGameState(page);
    while (shouldBuyXP(state, strategy)) {
        await clickBuyXP(page);
        xpBought++;
        goldSpentXP += 4;
        state = await readGameState(page);
        if (xpBought >= 3) break; // Cap per round
    }
    if (xpBought > 0) {
        console.log(`    📈 XP ×${xpBought} → Lv.${state.level}`);
        actions.push({ type: 'xp', count: xpBought });
    }

    // === Step 4: Place bench units on board ===
    state = await readGameState(page);
    let placed = 0;
    while (state.boardCurrent < state.boardMax && state.bench.length > 0) {
        const benchUnit = state.bench[0];
        if (!benchUnit) break;

        const pos = chooseBestPlacement(state, strategy);
        if (!pos) break;

        // Select bench unit, then click target board cell
        await clickBenchSlot(page, benchUnit.index);
        await sleep(200);
        await clickBoardCell(page, pos.x, pos.y);
        await sleep(200);

        console.log(`    📌 ${benchUnit.name || '?'} → (${pos.x},${pos.y})`);
        actions.push({ type: 'place', name: benchUnit.name, x: pos.x, y: pos.y });
        placed++;

        state = await readGameState(page);
        if (placed > 10) break;
    }

    // Final summary
    state = await readGameState(page);
    const dpsStatus = state.deficit > 0 ? `⚠️-${state.deficit}` : '✅';
    console.log(`  → 💰${state.gold}G [${state.boardCurrent}/${state.boardMax}] DPS:${state.dps}/${state.requiredDPS} ${dpsStatus}`);

    gameLog.push({
        round, gold: state.gold, hp: state.hp, level: state.level,
        boardSize: state.boardCurrent, dps: state.dps, requiredDPS: state.requiredDPS,
        actionsCount: actions.length,
        // v2: enriched data for balance report
        unitsBought,
        unitsOnBoard: state.board.map(u => ({ name: u.name, star: u.star || 1 })),
        synergySnapshot: state.synergies.filter(s => s.isActive).map(s => ({ name: s.name, count: s.count })),
        goldEconomy: {
            remaining: state.gold,
            spentUnits: goldSpentUnits,
            spentReroll: goldSpentReroll,
            spentXP: goldSpentXP,
        },
        dpsCoverage: state.requiredDPS > 0 ? +(state.dps / state.requiredDPS).toFixed(3) : 1,
    });

    return state;
}

async function playOneGame(page, gameNumber, strategy) {
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`🎮 게임 #${gameNumber}`);
    console.log(`${'═'.repeat(50)}`);

    try {
        await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 30000 });
    } catch (e) {
        console.log(`  ⚠️ 페이지 로드 재시도...`);
        await sleep(3000);
        await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
    await sleep(3000);

    const entered = await enterNormalGame(page);
    if (!entered) {
        console.log('  ❌ 진입 실패');
        return null;
    }

    await takeGameScreenshot(page, `g${gameNumber}_start.png`);

    const gameLog = [];
    let maxRound = '1-1';
    let finalHP = 20;
    let roundCount = 0;

    for (let turn = 0; turn < 70; turn++) {
        let state = await readGameState(page);

        if (state.isGameOver || state.hp <= 0) {
            console.log(`\n  💀 게임 오버! ${maxRound}`);
            break;
        }

        // If in combat, wait for it to end
        if (state.inCombat) {
            const result = await waitCombatEnd(page);
            if (result.isGameOver) {
                console.log(`\n  💀 전투 중 게임 오버`);
                break;
            }
            continue;
        }

        maxRound = state.round || maxRound;
        finalHP = state.hp;

        // Play prep phase
        state = await playPrepPhase(page, state, strategy, gameLog);
        roundCount++;

        // Screenshot at stage transitions
        const roundStr = state.round || '';
        if (roundStr.endsWith('-1')) {
            await takeGameScreenshot(page, `g${gameNumber}_${roundStr.replace('-', '_')}.png`);
        }

        // Start combat
        console.log(`  ⚔️ 전투 [${state.round}]`);
        await clickStartCombat(page);

        // Wait for combat to end
        const combatResult = await waitCombatEnd(page);

        if (combatResult.isGameOver) {
            console.log(`\n  💀 게임 오버 [${maxRound}]`);
            finalHP = combatResult.hp || 0;
            break;
        }

        // Update state after combat
        state = await readGameState(page);
        maxRound = state.round || maxRound;
        finalHP = state.hp;

        if (state.hp <= 0) break;
    }

    await takeGameScreenshot(page, `g${gameNumber}_end.png`);

    const finalState = await readGameState(page);
    const result = {
        gameNumber,
        maxRound,
        finalHP,
        finalDPS: finalState.dps,
        level: finalState.level,
        boardSize: finalState.boardCurrent,
        synergies: finalState.synergies.filter(s => s.isActive).map(s => `${s.name}(${s.count})`),
        roundsPlayed: roundCount,
        log: gameLog,
    };

    console.log(`\n  📊 #${gameNumber}: ${maxRound} | HP:${finalHP} | DPS:${finalState.dps} | Lv.${finalState.level}`);
    console.log(`  시너지: ${result.synergies.join(', ') || '없음'}`);

    return result;
}

// ============================================================
// MODULE 5: LEARNING MEMORY
// ============================================================

function loadRecords() {
    try {
        if (fs.existsSync(RECORDS_FILE)) return JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf-8'));
    } catch { }
    return { games: [], strategy: { ...defaultStrategy } };
}

function saveRecords(records) {
    fs.writeFileSync(RECORDS_FILE, JSON.stringify(records, null, 2));
}

function adjustStrategy(records) {
    const strategy = JSON.parse(JSON.stringify(defaultStrategy));
    const games = records.games;
    if (games.length === 0) return strategy;

    const lastGame = games[games.length - 1];
    const avgRound = games.reduce((s, g) => s + parseRoundNumber(g.maxRound), 0) / games.length;

    console.log(`\n  🧠 학습 [${games.length}판] 평균R: ${avgRound.toFixed(1)}`);

    // Dying early → more aggressive spending
    if (lastGame.finalHP <= 0 && parseRoundNumber(lastGame.maxRound) < 15) {
        strategy.interestFloor = Math.max(10, strategy.interestFloor - 5);
        console.log('  → 조기 사망: 이자 하향');
    }

    // HP healthy → save more
    if (lastGame.finalHP >= 15) {
        strategy.interestFloor = Math.min(40, strategy.interestFloor + 5);
        console.log('  → HP 여유: 이자 상향');
    }

    // Boost weights for synergies in good games
    const nameMap = {
        '비트코인': 'Bitcoin', 'DeFi': 'DeFi', '소셜': 'Social',
        '거래소': 'Exchange', 'VC': 'VC', 'FUD': 'FUD',
        '러그풀': 'Rugpull', '베어마켓': 'Bear',
    };
    for (const g of games) {
        const roundScore = parseRoundNumber(g.maxRound);
        for (const syn of (g.synergies || [])) {
            const match = syn.match(/(.+)\((\d+)\)/);
            if (match) {
                const eng = nameMap[match[1]] || match[1];
                if (strategy.originWeights[eng] !== undefined) {
                    const bonus = roundScore > avgRound ? 0.1 : -0.05;
                    strategy.originWeights[eng] = Math.max(0.5, Math.min(2.0, strategy.originWeights[eng] + bonus));
                }
            }
        }
    }

    // XP timing
    if (lastGame.level < 5 && parseRoundNumber(lastGame.maxRound) > 10) {
        strategy.xpBuyStartRound = Math.max(2, strategy.xpBuyStartRound - 1);
        strategy.xpBuyGoldThreshold = Math.max(15, strategy.xpBuyGoldThreshold - 5);
        console.log('  → XP 구매 조기화');
    }

    return strategy;
}

// ============================================================
// MAIN
// ============================================================

(async () => {
    const TOTAL_GAMES = 5;
    const USE_LLM = process.argv.includes('--use-llm');
    console.log('🤖 CRD Autobot v2 — 밸런스 체크 QA');
    console.log(`📋 ${TOTAL_GAMES}판 플레이${USE_LLM ? ' + LLM 분석' : ''}\n`);

    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--window-size=1500,900', '--force-device-scale-factor=1'],
        defaultViewport: { width: 1440, height: 810 },
    });
    const page = await browser.newPage();

    // 누적 학습: 이전 기록을 불러와서 이어감
    const records = loadRecords();
    const startGameNum = records.games.length + 1;
    console.log(`  📚 누적 데이터: ${records.games.length}판 기록 로드됨\n`);

    for (let i = 0; i < TOTAL_GAMES; i++) {
        const gameNum = startGameNum + i;
        const strategy = records.games.length > 0 ? adjustStrategy(records) : { ...defaultStrategy };
        const result = await playOneGame(page, gameNum, strategy);

        if (result) {
            records.games.push(result);
            saveRecords(records);
        }

        if (i < TOTAL_GAMES) {
            console.log(`\n⏳ 다음 게임 준비...\n`);
            await sleep(2000);
        }
    }

    // ==============================
    // FINAL REPORT
    // ==============================
    console.log('\n' + '═'.repeat(50));
    console.log('🏆 최종 성장 보고서');
    console.log('═'.repeat(50));

    for (const g of records.games) {
        const r = parseRoundNumber(g.maxRound);
        const bar = '█'.repeat(Math.min(30, r));
        console.log(`  #${g.gameNumber}: ${g.maxRound.padEnd(5)} R${String(r).padStart(2)} HP:${String(g.finalHP).padStart(2)} DPS:${String(g.finalDPS).padStart(4)} Lv.${g.level} ${bar}`);
    }

    const first = records.games[0];
    const last = records.games[records.games.length - 1];
    if (first && last) {
        const growth = parseRoundNumber(last.maxRound) - parseRoundNumber(first.maxRound);
        const best = records.games.reduce((max, g) =>
            parseRoundNumber(g.maxRound) > parseRoundNumber(max.maxRound) ? g : max
        );
        console.log(`\n  📈 1판→${TOTAL_GAMES}판: ${growth > 0 ? '+' : ''}${growth}R`);
        console.log(`  🏅 최고: 게임 #${best.gameNumber} — ${best.maxRound}`);
    }

    console.log(`\n📁 ${SCREENSHOT_DIR}`);
    console.log(`📁 ${RECORDS_FILE}`);

    // ── LLM Analysis ──
    if (USE_LLM || true) {  // Always try, fallback handles no API key
        try {
            const llmAnalysis = await postGameAnalysis(records);
            const llmPatches = await suggestPatches(records);
            const llmStrategy = await improveStrategy(records);

            // Save LLM results to records for report
            records.llmAnalysis = llmAnalysis;
            records.llmPatches = llmPatches;
            records.llmStrategy = llmStrategy;
            saveRecords(records);

            if (typeof llmAnalysis === 'string') {
                console.log('\n🧠 AI 분석:');
                console.log(llmAnalysis.slice(0, 500));
            }
        } catch (e) {
            console.log(`  ⚠️ LLM 분석 실패: ${e.message}`);
        }
    }

    // ── Auto-generate Report ──
    try {
        const { execSync } = await import('child_process');
        execSync('node generate-report.mjs', { cwd: process.cwd(), stdio: 'inherit' });
    } catch (e) {
        console.log('  ⚠️ 리포트 생성 실패');
    }

    console.log('═'.repeat(50));

    await browser.close();
    process.exit(0);
})();
