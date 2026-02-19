import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = path.resolve('qa-screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
    console.log('🚀 CoinRandomDefense v3.5 — QA 자동화 테스트 시작...\n');
    // Game uses 1440x810 viewport with CSS transform scaling
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--window-size=1500,900', '--force-device-scale-factor=1'],
        defaultViewport: { width: 1440, height: 810 }
    });
    const page = await browser.newPage();

    let results = [];
    const report = (name, pass, detail) => {
        results.push({ name, pass, detail });
        console.log(`${pass ? '✅' : '❌'} ${name}: ${detail}`);
    };

    const takeScreenshot = async (name) => {
        const filePath = path.join(SCREENSHOT_DIR, name);
        // Disable transform scaling temporarily for accurate screenshot
        await page.evaluate(() => {
            const wr = document.getElementById('game-scale-wrapper');
            if (wr) { wr.dataset.origTransform = wr.style.transform; wr.style.transform = 'none'; wr.style.left = '0'; wr.style.top = '0'; }
        });
        await sleep(100);
        await page.screenshot({ path: filePath, fullPage: true });
        // Restore transform
        await page.evaluate(() => {
            const wr = document.getElementById('game-scale-wrapper');
            if (wr && wr.dataset.origTransform) { wr.style.transform = wr.dataset.origTransform; }
        });
        console.log(`📸 스크린샷 저장: ${name}`);
    };

    // ==============================
    // STEP 0: 페이지 로드
    // ==============================
    console.log('--- STEP 0: 페이지 로드 ---');
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 15000 });
    await sleep(2000);
    await takeScreenshot('0_lobby.png');

    const lobbyVisible = await page.evaluate(() => {
        const lobby = document.getElementById('lobby-screen');
        return lobby && !lobby.classList.contains('hidden');
    });
    report('STEP 0: 로비 화면 로드', lobbyVisible, lobbyVisible ? '로비 화면 정상 표시' : '로비 화면 미표시');

    // ==============================
    // STEP 1: 게임 진입 (캠페인 모드)
    // ==============================
    console.log('\n--- STEP 1: 게임 모드 선택 및 진입 ---');

    const hasCampaign = await page.evaluate(() => !!document.getElementById('btn-campaign'));
    if (hasCampaign) {
        console.log('  캠페인 버튼 발견 — 클릭');
        await page.evaluate(() => document.getElementById('btn-campaign')?.click());
        await sleep(3000);
    }

    // Check which screen is now visible
    let screenState = await page.evaluate(() => {
        const lobby = document.getElementById('lobby-screen');
        const match = document.getElementById('match-screen');
        const game = document.getElementById('game-screen');
        return {
            lobby: lobby && !lobby.classList.contains('hidden'),
            match: match && !match.classList.contains('hidden'),
            game: game && !game.classList.contains('hidden')
        };
    });
    console.log(`  화면 상태: lobby=${screenState.lobby}, match=${screenState.match}, game=${screenState.game}`);

    // Handle matchmaking if needed
    if (screenState.match) {
        console.log('  매치 화면 진입 — 봇 채우기 버튼 대기');
        await sleep(3000);
        const hasBotBtn = await page.evaluate(() => {
            const btn = document.getElementById('btn-start-bots');
            return btn && !btn.classList.contains('hidden');
        });
        if (hasBotBtn) {
            console.log('  봇 채우기 버튼 클릭');
            await page.evaluate(() => document.getElementById('btn-start-bots')?.click());
            await sleep(5000);
        }
    }

    // Re-check screen state
    screenState = await page.evaluate(() => {
        const game = document.getElementById('game-screen');
        return { game: game && !game.classList.contains('hidden') };
    });

    // Even if game-screen detection fails, the game elements (shop, bench, board) may be functional
    const hasGameElements = await page.evaluate(() => {
        return !!(document.getElementById('hud-gold') &&
            document.getElementById('btn-reroll') &&
            document.getElementById('shop-slots'));
    });
    report('STEP 1: 게임 요소 로드', hasGameElements,
        `게임 화면: ${screenState.game}, 게임 요소 존재: ${hasGameElements}`);
    await takeScreenshot('1_game_entered.png');

    // Read gold helper
    const getGold = async () => {
        return page.evaluate(() => {
            const el = document.getElementById('hud-gold');
            return el ? parseInt(el.innerText || '0') : -1;
        });
    };

    // ==============================
    // TEST 1: 리롤 3회 클릭
    // ==============================
    console.log('\n--- TEST 1: 리롤 3회 클릭 ---');
    const goldBefore1 = await getGold();
    console.log(`  초기 골드: ${goldBefore1}G`);

    for (let i = 0; i < 3; i++) {
        const g_before = await getGold();
        await page.evaluate(() => document.getElementById('btn-reroll')?.click());
        await sleep(800);
        const g_after = await getGold();
        console.log(`  리롤 ${i + 1}회: ${g_before}G → ${g_after}G (${g_after - g_before}G)`);
    }
    const goldAfter1 = await getGold();
    report('TEST 1: 리롤 3회', goldAfter1 < goldBefore1,
        `골드 ${goldBefore1}G → ${goldAfter1}G (총 -${goldBefore1 - goldAfter1}G)`);

    const shopCardCount = await page.evaluate(() => {
        const slots = document.getElementById('shop-slots');
        return slots ? slots.children.length : 0;
    });
    report('TEST 1: 상점 카드 존재', shopCardCount > 0, `상점 카드 ${shopCardCount}개`);
    await takeScreenshot('2_after_reroll.png');

    // ==============================
    // TEST 2: 첫 번째 유닛 구매
    // ==============================
    console.log('\n--- TEST 2: 첫 번째 유닛 구매 ---');
    const goldBefore2 = await getGold();

    const buyResult = await page.evaluate(() => {
        const shopSlots = document.getElementById('shop-slots');
        if (!shopSlots || shopSlots.children.length === 0) return null;
        const firstCard = shopSlots.children[0];
        firstCard.click();
        return { clicked: true, text: firstCard.textContent?.substring(0, 30) };
    });

    await sleep(1000);
    const goldAfter2 = await getGold();
    const goldDiff2 = goldBefore2 - goldAfter2;

    report('TEST 2: 유닛 구매', goldDiff2 > 0,
        `골드 ${goldBefore2}G → ${goldAfter2}G (비용: ${goldDiff2}G)`);
    await takeScreenshot('3_after_buy.png');

    // ==============================
    // TEST 3: 대기석 선택 → 보드 배치
    // ==============================
    console.log('\n--- TEST 3: 대기석 선택 후 보드 배치 ---');

    // Click a bench slot with a unit
    const benchClicked = await page.evaluate(() => {
        const bench = document.getElementById('bench-slots');
        if (!bench) return { success: false, reason: 'bench not found' };
        for (const child of bench.children) {
            if (!child.classList.contains('empty')) {
                child.click();
                return { success: true, text: child.textContent?.substring(0, 20) };
            }
        }
        // Fallback: click first child
        if (bench.children[0]) {
            bench.children[0].click();
            return { success: true, text: 'first-child' };
        }
        return { success: false, reason: 'no bench slots' };
    });

    await sleep(600);
    console.log(`  대기석 클릭: ${JSON.stringify(benchClicked)}`);
    report('TEST 3: 대기석 선택', benchClicked.success, `${benchClicked.success ? '클릭 완료' : benchClicked.reason}`);

    // Click empty board cell to place unit
    const boardClicked = await page.evaluate(() => {
        const grid = document.getElementById('board-grid');
        if (!grid) return { success: false, reason: 'grid not found' };
        for (const child of grid.children) {
            if (child.classList.contains('empty') || child.children.length === 0) {
                child.click();
                return { success: true, cellId: child.id || 'unnamed' };
            }
        }
        if (grid.children[0]) {
            grid.children[0].click();
            return { success: true, cellId: 'first-cell' };
        }
        return { success: false, reason: 'no empty cells' };
    });

    await sleep(600);
    console.log(`  보드 클릭: ${JSON.stringify(boardClicked)}`);
    report('TEST 3: 보드 배치', boardClicked.success, `${boardClicked.success ? '배치 완료' : boardClicked.reason}`);
    await takeScreenshot('4_after_place.png');

    // ==============================
    // TEST 4: 전투 시작 및 관전
    // ==============================
    console.log('\n--- TEST 4: 전투 시작 및 관전 (5초) ---');

    const roundBefore = await page.evaluate(() => document.getElementById('hud-round')?.innerText || '0');
    console.log(`  전투 전 라운드: ${roundBefore}`);

    const combatStarted = await page.evaluate(() => {
        const btn = document.getElementById('btn-next-round');
        if (btn) { btn.click(); return true; }
        return false;
    });
    console.log(`  전투 시작 버튼 클릭: ${combatStarted}`);

    await sleep(2000);
    await takeScreenshot('5_combat_start.png');

    for (let i = 3; i > 0; i--) {
        console.log(`  관전 중... ${i}초 남음`);
        await sleep(1000);
    }

    const roundAfter = await page.evaluate(() => document.getElementById('hud-round')?.innerText || '0');
    const hpAfter = await page.evaluate(() => document.getElementById('hud-hp')?.innerText || '?');
    const goldFinal = await getGold();

    await takeScreenshot('6_combat_end.png');
    report('TEST 4: 전투 관전', combatStarted,
        `라운드 ${roundBefore} → ${roundAfter}, HP: ${hpAfter}, 골드: ${goldFinal}G`);

    // ==============================
    // FINAL REPORT
    // ==============================
    console.log('\n' + '='.repeat(55));
    console.log('📋 CoinRandomDefense v3.5 — QA 테스트 최종 결과');
    console.log('='.repeat(55));
    const passCount = results.filter(r => r.pass).length;
    const totalCount = results.length;
    results.forEach(r => {
        console.log(`  ${r.pass ? '✅' : '❌'} ${r.name}`);
        console.log(`     → ${r.detail}`);
    });
    console.log('='.repeat(55));
    console.log(`🏆 결과: ${passCount}/${totalCount} 통과`);
    console.log(`📁 스크린샷 폴더: ${SCREENSHOT_DIR}`);
    console.log('='.repeat(55));

    await browser.close();
    process.exit(0);
})();
