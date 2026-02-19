/**
 * CoinRandomDefense v3.5 — AI Game Player v2
 * 
 * 챌린저급 성장 자동화 시스템
 * Level 1: Dynamic UNIT_DB from config.ts
 * Level 2: Forced Meta Exploration (MCTS-lite)
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { postGameAnalysis, suggestPatches, improveStrategy } from './llm-advisor.mjs';

const SCREENSHOT_DIR = path.resolve('ai-screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR);
const RECORDS_FILE = path.resolve('ai-records.json');

// ⚡ [속도 혁신 1] Headless 모드용 초고속 Sleep (대기 시간 80% 단축)
const FAST_MODE = true;
const sleep = (ms) => new Promise(r => setTimeout(r, FAST_MODE ? ms / 5 : ms));

// ============================================================
// LEVEL 1: DYNAMIC UNIT DATABASE (자동 스크래핑)
// ============================================================
// config.ts에서 유닛 데이터를 자동으로 파싱합니다.
// 밸런스 패치 후 npm run ai만 실행하면 새 수치를 자동 인식!

function loadUnitDBFromConfig() {
    const configPath = path.resolve('../CoinRandomDefense/v3/src/core/config.ts');
    const altPaths = [
        path.resolve('../../CoinRandomDefense/v3/src/core/config.ts'),
        path.resolve('../v3/src/core/config.ts'),
    ];

    let configContent = null;
    for (const p of [configPath, ...altPaths]) {
        try {
            if (fs.existsSync(p)) {
                configContent = fs.readFileSync(p, 'utf-8');
                console.log(`  📂 config.ts 로드: ${p}`);
                break;
            }
        } catch { }
    }

    if (!configContent) {
        console.log('  ⚠️ config.ts 못 찾음 → 내장 DB 사용');
        return null;
    }

    const db = {};
    // 정규식: { id: '...', name: '...', ... cost: N, ... origin: Origin.XXX, ... baseDmg: N, attackSpeed: N.NN, ... }
    const unitRegex = /id:\s*'([^']+)',\s*name:\s*'([^']+)',.*?cost:\s*(\d+),.*?origin:\s*(?:Origin\.)?(\w+),.*?dmgType:\s*'(\w+)'\s*as\s*const,\s*baseDmg:\s*(\d+),\s*attackSpeed:\s*([\d.]+)/gs;

    let match;
    while ((match = unitRegex.exec(configContent)) !== null) {
        const [, id, name, costStr, origin, dmgType, baseDmgStr, atkSpdStr] = match;
        const cost = parseInt(costStr);
        const baseDmg = parseInt(baseDmgStr);
        const atkSpd = parseFloat(atkSpdStr);
        const dps = Math.round(baseDmg * atkSpd);

        db[name] = { id, cost, origin, dmgType, dps, baseDmg, attackSpeed: atkSpd };
    }

    if (Object.keys(db).length > 0) {
        console.log(`  ✅ 유닛 ${Object.keys(db).length}개 자동 로드됨 (config.ts)`);
        const top5 = Object.entries(db).sort((a, b) => b[1].dps - a[1].dps).slice(0, 5);
        console.log(`  📊 DPS 상위: ${top5.map(([n, d]) => `${n}(${d.dps})`).join(', ')}`);
        return db;
    }
    return null;
}

// 브라우저에서 window.__UNIT_DB__ 읽기 (가장 정확한 방법)
async function loadUnitDBFromBrowser(page) {
    try {
        const data = await page.evaluate(() => {
            const db = window.__UNIT_DB__;
            if (!db) return null;
            const result = {};
            for (const [id, unit] of Object.entries(db)) {
                result[unit.name] = {
                    id: unit.id,
                    cost: unit.cost,
                    origin: unit.origin,
                    dmgType: unit.dmgType,
                    dps: Math.round(unit.baseDmg * (unit.attackSpeed || 1)),
                    baseDmg: unit.baseDmg,
                    attackSpeed: unit.attackSpeed,
                };
            }
            return result;
        });
        if (data && Object.keys(data).length > 0) {
            console.log(`  🌐 브라우저에서 유닛 ${Object.keys(data).length}개 실시간 로드!`);
            UNIT_DB = data;
            return true;
        }
    } catch (e) {
        console.log(`  ⚠️ 브라우저 DB 로드 실패: ${e.message}`);
    }
    return false;
}

// 게임 접속 후 동적으로 채워질 빈 객체
let UNIT_DB = loadUnitDBFromConfig() || {};

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
    // ── 이자 경제 전략 ──
    // 실제 플레이어처럼 30G 유지 → 이자 3G/라운드 (게임 최대 이자)
    interestFloor: 30,       // 이 이하로 골드를 안 씀 (이자 보존, 최대 3G/라운드)
    earlyEconTarget: 20,     // 초반 목표 골드 (2G 이자)
    loseStreakThreshold: 5,  // HP 이하면 이자 포기하고 올인

    // ── 리롤 전략 ──
    earlyRerollLimit: 0,     // 초반: 리롤 안 함 (돈 모으기)
    midRerollBudget: 6,      // 중반: 이자 초과분만 리롤
    lateRerollBudget: 30,    // 후반: 공격적 리롤

    // ── XP 전략 ──
    xpBuyStartRound: 3,      // XP 구매 시작 라운드
    xpBuyGoldThreshold: 54,  // 이자 50G + XP 4G = 54G 이상일 때만

    originWeights: {
        Bitcoin: 1.0, DeFi: 1.0, Social: 1.0, Exchange: 1.0,
        VC: 1.0, FUD: 1.2, Rugpull: 1.0, Bear: 1.0,
    },
    // 몬스터 경로 = 테두리 반시계방향 (좌상→좌하→우하→우상)
    // 최적 배치 = 경로 코너 근처 (2변 동시 커버)
    // 최악 = 보드 정중앙 (사거리가 테두리까지 안 닿음)
    preferredPositions: [
        // Tier 1: 왼쪽 2번째 칸 위/아래 (1순위, 2순위)
        { x: 1, y: 1 }, { x: 1, y: 2 },
        // Tier 2: 오른쪽 코너 인접
        { x: 5, y: 1 }, { x: 5, y: 2 },
        // Tier 2: 테두리 바로 안쪽 (1변 풀커버)
        { x: 2, y: 0 }, { x: 4, y: 0 },
        { x: 2, y: 3 }, { x: 4, y: 3 },
        { x: 0, y: 1 }, { x: 6, y: 1 },
        { x: 0, y: 2 }, { x: 6, y: 2 },
        // Tier 3: 테두리 위 (경로 위 = 직접 커버)
        { x: 1, y: 0 }, { x: 5, y: 0 },
        { x: 1, y: 3 }, { x: 5, y: 3 },
        { x: 3, y: 0 }, { x: 3, y: 3 },
        // Tier 4: 코너 셀
        { x: 0, y: 0 }, { x: 6, y: 0 },
        { x: 0, y: 3 }, { x: 6, y: 3 },
        // Tier 5: 중앙 (최악)
        { x: 2, y: 1 }, { x: 4, y: 1 },
        { x: 2, y: 2 }, { x: 4, y: 2 },
        { x: 3, y: 1 }, { x: 3, y: 2 },
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

// ── 이자 계산 ──
function getInterest(gold) {
    return Math.min(5, Math.floor(gold / 10));
}

// ── 스펜딩 가능 골드 (이자 보존) ──
function getSpendableGold(gold, strategy, gameState) {
    const stage = parseInt(gameState.round?.split('-')[0]) || 1;
    const hp = gameState.hp || 20;

    // HP 위급하면 이자 포기하고 올인
    if (hp <= strategy.loseStreakThreshold) return gold;

    // 초반 (stage 1): earlyEconTarget까지만 모으면 됨
    if (stage <= 1) {
        const target = Math.min(gold, strategy.earlyEconTarget);
        return Math.max(0, gold - target);
    }

    // 중반 이후: 50G 이자 보존 (초과분만 사용)
    return Math.max(0, gold - strategy.interestFloor);
}

function evaluateUnit(shopUnit, gameState, strategy) {
    if (!shopUnit || !shopUnit.canAfford) return -999;

    const info = lookupUnit(shopUnit.name);
    if (!info) return 1;

    const stage = parseInt(gameState.round?.split('-')[0]) || 1;
    const spendable = getSpendableGold(gameState.gold, strategy, gameState);
    let score = 0;

    // ============================================
    // 0. 이자 보존: 돈이 없으면 안 삼
    // ============================================
    if (info.cost > spendable) {
        // 예외: 합성 확정이면 이자 깨고라도 삼
        if (shopUnit.mergeReady >= 2) score += 500;
        else return -100;  // 이자 못 깨는 유닛은 패스
    }

    // ============================================
    // 1. 합성 확정 = 무조건 삼 (★2 = DPS x2)
    // ============================================
    const ownedCount = [...gameState.bench, ...gameState.board]
        .filter(u => u && u.name === shopUnit.name).length;
    if (shopUnit.mergeReady === 3) score += 800;
    else if (shopUnit.mergeReady === 2) score += 500;
    else if (ownedCount >= 2) score += 600;   // 3장째 = ★2 확정
    else if (ownedCount === 1) score += 80;   // 2장째 = 준비

    // ============================================
    // 2. 보드 슬롯 비었으면 = 전력 보강 필요
    // ============================================
    if (gameState.boardCurrent < gameState.boardMax) {
        score += 100;
        score += (info.dps / info.cost) * 10;  // DPS 높은 유닛 우선
    }

    // ============================================
    // 3. DPS 효율 (유효 DPS / 골드)
    // ============================================
    score += (info.dps / info.cost) * 5;

    // ============================================
    // 4. 시너지 연계
    // ============================================
    const existingOrigins = {};
    for (const u of gameState.board) {
        const uInfo = lookupUnit(u.name);
        if (uInfo) existingOrigins[uInfo.origin] = (existingOrigins[uInfo.origin] || 0) + 1;
    }
    const originCount = existingOrigins[info.origin] || 0;
    if (originCount === 1) score += 60;
    else if (originCount === 3) score += 80;
    else if (originCount === 5) score += 100;
    else if (originCount >= 1) score += 25;
    score *= (strategy.originWeights[info.origin] || 1.0);

    // ============================================
    // 5. 학습된 유닛 성과 반영
    // ============================================
    const unitScores = strategy._unitScores || {};
    const learned = unitScores[shopUnit.name];
    if (learned && learned.gamesPlayed >= 2) {
        const avgRound = Object.values(unitScores)
            .filter(s => s.gamesPlayed >= 2)
            .reduce((acc, s, _, arr) => acc + s.avgScore / arr.length, 0);
        if (learned.avgScore > avgRound * 1.1) score += 30;   // 강한 유닛
        else if (learned.avgScore < avgRound * 0.8) score -= 30;  // 약한 유닛
    }

    // ============================================
    // 6. 스테이지별 코스트 선호
    // ============================================
    if (stage <= 1 && info.cost >= 3) score -= 50;
    if (stage >= 3 && info.cost >= 3) score += 20;
    if (stage >= 4 && info.cost >= 4) score += 40;

    return score;
}

function shouldReroll(gameState, strategy, goldSpentThisTurn) {
    const { gold, round, bench, boardCurrent, boardMax } = gameState;
    const stage = parseInt(round?.split('-')[0]) || 1;
    const spendable = getSpendableGold(gold, strategy, gameState);

    if (bench.length >= 9) return false;
    if (gold < 4) return false;

    // 이자 보존: 리롤 후에도 이자 유지 가능해야 함
    if (spendable < 2 && gameState.hp > strategy.loseStreakThreshold) return false;

    // 예산 체크
    const budget = stage <= 1 ? strategy.earlyRerollLimit
        : stage <= 3 ? strategy.midRerollBudget
            : strategy.lateRerollBudget;
    if (goldSpentThisTurn >= budget) return false;

    // 초반: 절대 리롤 안 함 (돈 모으기)
    if (stage <= 1) return false;

    // 합성 가능한 유닛이 상점에 있으면 리롤 금지 (사기)
    const hasGoodShop = gameState.shop.some(s => s && (s.mergeReady >= 2));
    if (hasGoodShop) return false;

    // 합성 대기(2장)인 유닛이 있으면 리롤해서 3장째 찾기
    const pairNames = {};
    for (const u of [...bench, ...gameState.board]) {
        if (u?.name) pairNames[u.name] = (pairNames[u.name] || 0) + 1;
    }
    const hasPair = Object.values(pairNames).some(c => c === 2);
    if (hasPair && spendable >= 4) return true;

    // 보드 비었는데 상점에 좋은 유닛 없으면 리롤
    if (boardCurrent < boardMax && spendable >= 2) return true;

    // 이자 초과분이 충분하면 리롤
    if (spendable >= 10) return true;

    return false;
}

function shouldBuyXP(gameState, strategy) {
    const { gold, level, round, boardCurrent, boardMax } = gameState;
    const roundNum = parseRoundNumber(round);
    const spendable = getSpendableGold(gold, strategy, gameState);

    if (level >= 10) return false;
    if (gold < 4) return false;

    // 이자 보존: XP 구매 후에도 이자 유지
    if (spendable < 4 && gameState.hp > strategy.loseStreakThreshold) return false;

    // 보드가 꽉 차면 레벨업 필수 (슬롯 확보)
    if (boardCurrent >= boardMax && spendable >= 4) return true;

    // 라운드 체크
    if (roundNum < strategy.xpBuyStartRound) return false;

    // 이자 초과분이 충분하면 XP 구매
    if (spendable >= 8) return true;

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

// 증강 선택 자동 핸들러
async function handleAugmentPick(page) {
    const result = await page.evaluate(() => {
        const overlay = document.getElementById('augment-overlay');
        if (!overlay) return null;

        // 카드 찾기: overlay 안의 클릭 가능한 카드들
        const allDivs = overlay.querySelectorAll('div');
        const cards = Array.from(allDivs).filter(d =>
            d.style.cursor === 'pointer' || d.onclick !== null
        );
        if (cards.length === 0) return null;

        // 카드 텍스트 읽기
        const cardTexts = cards.map(c => c.textContent || '');

        // 전투 증강 우선순위 (DPS 관련 키워드)
        const priorities = ['크리', '공격', '스플래시', 'DMG', '데미지', '관통', '피해', '확률'];
        let bestIdx = 0;
        let bestScore = 0;
        cardTexts.forEach((text, i) => {
            let score = 1;  // 기본 1점 (아무거나 선택)
            priorities.forEach((kw, pri) => {
                if (text.includes(kw)) score += (priorities.length - pri);
            });
            if (score > bestScore) { bestScore = score; bestIdx = i; }
        });

        // 선택 클릭
        cards[bestIdx].click();
        return cardTexts[bestIdx]?.substring(0, 40) || '선택 완료';
    });

    if (result) await sleep(500);
    return result;
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
            // 3x 속도 설정
            for (let s = 0; s < 2; s++) {
                await page.evaluate(() => document.getElementById('btn-speed')?.click());
                await sleep(200);
            }
            console.log('  ⚡ 3배속 설정');
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

    // === Step 0: 증강 선택 (팝업이 있으면 자동 선택) ===
    const augResult = await handleAugmentPick(page);
    if (augResult) {
        console.log(`    🧬 증강 선택: ${augResult}`);
        actions.push({ type: 'augment', choice: augResult });
    }

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

    // === Step 4: Place bench units on board (★ 높은 유닛 우선 배치) ===
    state = await readGameState(page);
    let placed = 0;

    // 벤치 유닛을 ★ 레벨 + DPS 기준으로 정렬 (강한 유닛 우선)
    const sortedBench = [...state.bench].sort((a, b) => {
        const starA = a.star || 1, starB = b.star || 1;
        if (starB !== starA) return starB - starA;  // ★ 높은 유닛 먼저
        const infoA = lookupUnit(a.name), infoB = lookupUnit(b.name);
        return (infoB?.dps || 0) - (infoA?.dps || 0);  // DPS 높은 유닛 먼저
    });

    for (const benchUnit of sortedBench) {
        if (state.boardCurrent >= state.boardMax) break;
        if (!benchUnit) continue;

        const pos = chooseBestPlacement(state, strategy);
        if (!pos) break;

        await clickBenchSlot(page, benchUnit.index);
        await sleep(200);
        await clickBoardCell(page, pos.x, pos.y);
        await sleep(200);

        const starTag = (benchUnit.star || 1) > 1 ? ` ★${benchUnit.star}` : '';
        console.log(`    📌 ${benchUnit.name || '?'}${starTag} → (${pos.x},${pos.y})`);
        actions.push({ type: 'place', name: benchUnit.name, x: pos.x, y: pos.y, star: benchUnit.star });
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
        await page.goto('http://localhost:5174/', { waitUntil: 'networkidle2', timeout: 30000 });
    } catch (e) {
        console.log(`  ⚠️ 페이지 로드 재시도...`);
        await sleep(3000);
        await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
    await sleep(3000);

    // 🔥 게임의 최신 밸런스 DB를 훔쳐와서 봇의 두뇌(UNIT_DB)에 이식함
    UNIT_DB = await page.evaluate(() => window.__UNIT_DB__);
    if (!UNIT_DB || Object.keys(UNIT_DB).length === 0) {
        console.log('  ⚠️ window.__UNIT_DB__ 미발견 — config.ts 파싱 DB 사용');
        UNIT_DB = loadUnitDBFromConfig() || {};
    } else {
        console.log(`  🔗 최신 밸런스 DB 연동 완료: 총 ${Object.keys(UNIT_DB).length}개 유닛 데이터 로드`);
    }

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
            // 전투 종료 후 증강 선택 팝업 체크
            await sleep(500);
            const augResult = await handleAugmentPick(page);
            if (augResult) console.log(`    🧬 증강 선택: ${augResult}`);
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
        _strategySnapshot: strategy._snapshot || null,
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
        if (fs.existsSync(RECORDS_FILE)) {
            const data = JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf-8'));
            // 마이그레이션: 이전 포맷 호환
            if (!data.unitScores) data.unitScores = {};
            if (!data.learnedParams) data.learnedParams = {};
            return data;
        }
    } catch { }
    return { games: [], strategy: { ...defaultStrategy }, unitScores: {}, learnedParams: {} };
}

function saveRecords(records) {
    fs.writeFileSync(RECORDS_FILE, JSON.stringify(records, null, 2));
}

// ============================================================
// 핵심: 게임 결과로부터 학습
// ============================================================
function updateLearning(records, gameResult) {
    const roundScore = parseRoundNumber(gameResult.maxRound);

    // 1. 유닛별 승률 추적
    const unitsUsed = new Set();
    for (const round of (gameResult.log || [])) {
        for (const u of (round.unitsOnBoard || [])) {
            if (u.name) unitsUsed.add(u.name);
        }
    }

    for (const unitName of unitsUsed) {
        if (!records.unitScores[unitName]) {
            records.unitScores[unitName] = { totalScore: 0, gamesPlayed: 0, avgScore: 0, bestRound: 0 };
        }
        const s = records.unitScores[unitName];
        s.totalScore += roundScore;
        s.gamesPlayed++;
        s.avgScore = s.totalScore / s.gamesPlayed;
        s.bestRound = Math.max(s.bestRound, roundScore);
    }

    // 2. 경제 패턴 학습 (라운드별 골드 추적)
    const goldHistory = (gameResult.log || []).map(r => r.gold || 0);
    const avgGoldOnHand = goldHistory.length > 0 ? goldHistory.reduce((a, b) => a + b, 0) / goldHistory.length : 0;

    // 3. 학습 파라미터 업데이트
    const lp = records.learnedParams;
    if (!lp.totalGames) lp.totalGames = 0;
    if (!lp.avgRoundReached) lp.avgRoundReached = 0;
    if (!lp.avgGoldHeld) lp.avgGoldHeld = 0;
    if (!lp.bestEverRound) lp.bestEverRound = 0;
    if (!lp.avgHP) lp.avgHP = 0;
    if (!lp.avgLevel) lp.avgLevel = 0;

    const n = lp.totalGames;
    lp.totalGames++;
    lp.avgRoundReached = (lp.avgRoundReached * n + roundScore) / (n + 1);
    lp.avgGoldHeld = (lp.avgGoldHeld * n + avgGoldOnHand) / (n + 1);
    lp.bestEverRound = Math.max(lp.bestEverRound, roundScore);
    lp.avgHP = (lp.avgHP * n + (gameResult.finalHP || 0)) / (n + 1);
    lp.avgLevel = (lp.avgLevel * n + (gameResult.level || 1)) / (n + 1);

    // 4. 시너지별 성과 추적
    if (!lp.synergyScores) lp.synergyScores = {};
    const nameMap = {
        '비트코인': 'Bitcoin', 'DeFi': 'DeFi', '소셜': 'Social',
        '거래소': 'Exchange', 'VC': 'VC', 'FUD': 'FUD',
        '러그풀': 'Rugpull', '베어마켓': 'Bear',
    };
    for (const syn of (gameResult.synergies || [])) {
        const match = syn.match(/(.+)\((\d+)\)/);
        if (match) {
            const eng = nameMap[match[1]] || match[1];
            if (!lp.synergyScores[eng]) lp.synergyScores[eng] = { total: 0, count: 0 };
            lp.synergyScores[eng].total += roundScore;
            lp.synergyScores[eng].count++;
        }
    }

    console.log(`  📈 학습 업데이트: ${unitsUsed.size}개 유닛, 평균R:${lp.avgRoundReached.toFixed(1)}, 최고:${lp.bestEverRound}`);
}

function adjustStrategy(records) {
    const games = records.games;
    const lp = records.learnedParams || {};
    const totalGames = lp.totalGames || games.length;
    const avgRound = lp.avgRoundReached || 10;
    const bestEver = lp.bestEverRound || 10;

    // ================================================================
    // 🧬 진화형 자동 학습 (Evolutionary Self-Tuning)
    // ================================================================
    // 규칙: "잘 된 게임의 파라미터를 물려받고, 약간 돌연변이시킨다"
    // 사람이 목표를 정해줄 필요 없음 — 결과(라운드)가 보상 신호.

    // 1. 역대 최고 파라미터 셋 로드 (없으면 기본값)
    if (!records.bestParams) {
        records.bestParams = {
            interestFloor: 20,     // 이자 임계 (낮을수록 공격적)
            earlyRerollLimit: 2,   // 초반 리롤 횟수
            midRerollBudget: 8,    // 중반 리롤 예산
            lateRerollBudget: 20,  // 후반 리롤 예산
            xpBuyStartRound: 5,    // XP 구매 시작 라운드
            xpBuyGoldThreshold: 20,// XP 구매 골드 임계
            buyAggression: 0.8,    // 구매 공격성 (0~1, 높을수록 많이 삼)
            originWeights: {
                Bitcoin: 1.0, DeFi: 1.0, Social: 1.0, Exchange: 1.0,
                VC: 1.0, FUD: 1.0, Rugpull: 1.0, Bear: 1.0,
            },
            score: 0,  // 이 파라미터로 달성한 최고 라운드
        };
    }

    const best = records.bestParams;

    // 2. 돌연변이(Mutation): 최고 파라미터에서 ±20% 랜덤 변동
    function mutate(value, min, max) {
        const noise = 1 + (Math.random() - 0.5) * 0.4; // 0.8 ~ 1.2
        return Math.round(Math.max(min, Math.min(max, value * noise)));
    }
    function mutateFloat(value, min, max) {
        const noise = 1 + (Math.random() - 0.5) * 0.4;
        return Math.max(min, Math.min(max, value * noise));
    }

    const strategy = JSON.parse(JSON.stringify(defaultStrategy));
    strategy.interestFloor = mutate(best.interestFloor, 10, 30);
    strategy.earlyRerollLimit = mutate(best.earlyRerollLimit, 0, 5);
    strategy.midRerollBudget = mutate(best.midRerollBudget, 2, 20);
    strategy.lateRerollBudget = mutate(best.lateRerollBudget, 5, 50);
    strategy.xpBuyStartRound = mutate(best.xpBuyStartRound, 1, 10);
    strategy.xpBuyGoldThreshold = mutate(best.xpBuyGoldThreshold, 10, 40);
    strategy.buyAggression = mutateFloat(best.buyAggression || 0.8, 0.3, 1.0);

    // 시너지 가중치 돌연변이
    for (const origin of Object.keys(strategy.originWeights)) {
        strategy.originWeights[origin] = mutateFloat(
            best.originWeights?.[origin] || 1.0, 0.3, 3.0
        );
    }

    // 3. 도달 라운드 기반 파라미터 강화 (최근 게임에서 배움)
    if (games.length >= 2) {
        const recent = games.slice(-5);
        const recentBest = recent.reduce((a, b) =>
            parseRoundNumber(a.maxRound) > parseRoundNumber(b.maxRound) ? a : b
        );
        const recentBestRound = parseRoundNumber(recentBest.maxRound);

        // 최고 기록 갱신 시 → 그 게임의 파라미터를 새 기준으로 채택
        if (recentBestRound > (best.score || 0) && recentBest._strategySnapshot) {
            const snap = recentBest._strategySnapshot;
            best.interestFloor = snap.interestFloor ?? best.interestFloor;
            best.midRerollBudget = snap.midRerollBudget ?? best.midRerollBudget;
            best.lateRerollBudget = snap.lateRerollBudget ?? best.lateRerollBudget;
            best.xpBuyStartRound = snap.xpBuyStartRound ?? best.xpBuyStartRound;
            best.buyAggression = snap.buyAggression ?? best.buyAggression;
            if (snap.originWeights) best.originWeights = { ...snap.originWeights };
            best.score = recentBestRound;
            console.log(`  🏆 최고 기록 ${recentBestRound}R! 파라미터 채택됨`);
        }
    }

    // 4. 시너지 학습 (성과 좋은 시너지 자동 부스트)
    const ss = lp.synergyScores || {};
    for (const [origin, data] of Object.entries(ss)) {
        if (data.count >= 3 && strategy.originWeights[origin] !== undefined) {
            const synergyAvg = data.total / data.count;
            const bonus = (synergyAvg - avgRound) * 0.1;
            strategy.originWeights[origin] = Math.max(0.3, Math.min(3.0,
                strategy.originWeights[origin] + bonus
            ));
        }
    }

    // 5. 전략 스냅샷 저장 (나중에 결과와 비교하기 위해)
    strategy._snapshot = {
        interestFloor: strategy.interestFloor,
        midRerollBudget: strategy.midRerollBudget,
        lateRerollBudget: strategy.lateRerollBudget,
        xpBuyStartRound: strategy.xpBuyStartRound,
        buyAggression: strategy.buyAggression,
        originWeights: { ...strategy.originWeights },
    };

    console.log(`\n  🧬 진화학습 [${totalGames}판] 최고:${bestEver}R 평균:${avgRound.toFixed(1)}R`);
    console.log(`  → 이자:${strategy.interestFloor} 리롤:${strategy.midRerollBudget}/${strategy.lateRerollBudget} XP:R${strategy.xpBuyStartRound} 공격성:${(strategy.buyAggression || 0.8).toFixed(2)}`);

    // ── 탐험 모드 (20%): 랜덤 시너지 올인 ──
    if (Math.random() < 0.2) {
        const origins = Object.keys(strategy.originWeights);
        const target = origins[Math.floor(Math.random() * origins.length)];
        strategy.originWeights[target] = 5.0;
        origins.forEach(o => { if (o !== target) strategy.originWeights[o] = 0.5; });
        strategy._exploration = target;
        console.log(`  🎯 [탐험] ${target} 올인!`);
    }

    // 유닛 스코어 전달
    strategy._unitScores = records.unitScores || {};

    return strategy;
}

// ============================================================
// MAIN
// ============================================================

// ============================================================
// MAIN (초고속 병렬 시뮬레이터 적용)
// ============================================================

(async () => {
    const TOTAL_GAMES = 100; // � 밤새 자동학습 (100판)
    const CONCURRENCY = 4;   // 🚀 4탭 병렬
    const USE_LLM = process.argv.includes('--use-llm');

    console.log('🤖 CRD Autobot v3 — [초고속 Headless 병렬 시뮬레이터]');
    console.log(`📋 총 ${TOTAL_GAMES}판 플레이 (동시 ${CONCURRENCY}개 탭 실행)\n`);

    // ⚡ [속도 혁신 2] Headless 모드 켜기 및 GPU 가속 끄기 (메모리 최적화)
    const browser = await puppeteer.launch({
        headless: true, // 화면을 띄우지 않고 백그라운드에서 광속 실행
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage', // 메모리 뻗음 방지
            '--mute-audio' // 효과음 테러 방지
        ],
    });

    const records = loadRecords();
    const startGameNum = records.games.length + 1;
    console.log(`  📚 누적 데이터: ${records.games.length}판 기록 로드됨\n`);

    // ⚡ [속도 혁신 3] CONCURRENCY 단위로 쪼개서 병렬(Promise.all) 실행
    for (let i = 0; i < TOTAL_GAMES; i += CONCURRENCY) {
        const batchSize = Math.min(CONCURRENCY, TOTAL_GAMES - i);
        console.log(`\n🚀 [병렬 처리] ${startGameNum + i} ~ ${startGameNum + i + batchSize - 1}번째 게임 동시 시작...`);

        const promises = [];
        for (let j = 0; j < batchSize; j++) {
            const gameNum = startGameNum + i + j;

            promises.push((async () => {
                const page = await browser.newPage();

                const strategy = records.games.length > 0 ? adjustStrategy(records) : { ...defaultStrategy };
                strategy._unitScores = records.unitScores || {};

                const result = await playOneGame(page, gameNum, strategy);
                await page.close(); // 완료된 탭은 즉시 닫아서 RAM 확보
                return result;
            })());
        }

        // 배치 단위로 4판이 모두 끝날 때까지 기다림
        const results = await Promise.all(promises);

        // 결과 취합 및 학습 업데이트 (순차적으로 안전하게 처리)
        for (let ri = 0; ri < results.length; ri++) {
            const res = results[ri];
            if (res) {
                // 전략 스냅샷을 결과에 저장 (진화학습용)
                if (res._strategySnapshot) {
                    // 이미 있으면 OK
                } else if (promises[ri]?._snapshot) {
                    res._strategySnapshot = promises[ri]._snapshot;
                }
                updateLearning(records, res);
                records.games.push(res);
            }
        }
        saveRecords(records);
    }

    // ==============================
    // FINAL REPORT 출력 (기존과 동일)
    // ==============================
    console.log('\n' + '═'.repeat(50));
    console.log('🏆 최종 성장 보고서');
    console.log('═'.repeat(50));

    for (const g of records.games) {
        const r = parseRoundNumber(g.maxRound);
        const bar = '█'.repeat(Math.min(30, r));
        console.log(`  #${g.gameNumber}: ${g.maxRound.padEnd(5)} R${String(r).padStart(2)} HP:${String(g.finalHP).padStart(2)} DPS:${String(g.finalDPS).padStart(4)} Lv.${g.level} ${bar}`);
    }

    if (USE_LLM || true) {
        try {
            const { postGameAnalysis, suggestPatches, improveStrategy } = await import('./llm-advisor.mjs');
            console.log('\n🧠 LLM 메타 분석 요청 중...');
            records.llmAnalysis = await postGameAnalysis(records);
            saveRecords(records);
            console.log(records.llmAnalysis.slice(0, 500) + '...\n');
        } catch (e) {
            console.log(`  ⚠️ LLM 분석 실패: ${e.message}`);
        }
    }

    try {
        const { execSync } = await import('child_process');
        execSync('node generate-report.mjs', { cwd: process.cwd(), stdio: 'inherit' });
    } catch (e) { }

    console.log('═'.repeat(50));
    await browser.close();
    process.exit(0);
})();
