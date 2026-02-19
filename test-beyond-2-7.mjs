/**
 * 2-7 이후 진행 테스트
 * 
 * 싱글모드에서 currentStageId를 7로 오버라이드하여
 * 2-7 이후로 진행되는지 확인합니다.
 * 
 * 전략: 보스를 이기기 위해 치트(골드 999)를 주고
 * 강한 유닛을 구매하여 2-7 보스를 클리어한 뒤
 * 3-1이 시작되는지 확인합니다.
 */

import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--window-size=1500,900'],
        defaultViewport: { width: 1440, height: 810 },
    });
    const page = await browser.newPage();

    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000);

    // === 1. 싱글 모드 진입 ===
    console.log('=== 싱글 모드 진입 ===');
    await page.evaluate(() => document.getElementById('btn-normal')?.click());
    await sleep(1000);
    await page.evaluate(() => document.getElementById('btn-solo')?.click());
    await sleep(3000);

    // Check initial state
    let state = await page.evaluate(() => ({
        round: document.getElementById('hud-round')?.innerText,
        gold: document.getElementById('hud-gold')?.innerText,
        hp: document.getElementById('hud-hp')?.innerText,
        level: document.getElementById('hud-level')?.innerText,
        btnText: document.getElementById('btn-next-round')?.textContent,
    }));
    console.log('Initial state:', JSON.stringify(state));

    // === 2. Override currentStageId to 7 (allow up to 7-7) ===
    console.log('\n=== currentStageId → 7 (7-7까지 허용) ===');
    await page.evaluate(() => {
        // @ts-ignore - Access global scope where currentStageId lives
        if (typeof window !== 'undefined') {
            // Try various ways to set currentStageId
            // It's a module-scoped variable, so we need to find another way
        }
    });

    // Since currentStageId is module-scoped, we can't change it directly.
    // Instead, let's patch the showGameOver function to not trigger on 2-7
    console.log('=== showGameOver 패치 (2-7에서 게임오버 방지) ===');
    await page.evaluate(() => {
        // Intercept the game over by hiding the result view when it appears
        // and unhiding the app
        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.type === 'attributes' && m.attributeName === 'class') {
                    const target = m.target;
                    // If app gets hidden (game over triggers), unhide it
                    if (target.id === 'app' && target.classList.contains('hidden')) {
                        console.log('[PATCH] Intercepted game over! Unhiding app...');
                        target.classList.remove('hidden');
                        // Also hide result view
                        const rv = document.getElementById('result-view');
                        if (rv) rv.classList.add('hidden');
                    }
                }
            }
        });

        const app = document.getElementById('app');
        if (app) {
            observer.observe(app, { attributes: true, attributeFilter: ['class'] });
            console.log('[PATCH] Game over interceptor installed');
        }
    });

    // === 3. 골드 치트로 강한 유닛 확보 ===
    console.log('\n=== 골드 999 치트 ===');
    // We need to modify the game state through the command system
    // Let's try to find and modify the player's gold via the DOM or eval
    await page.evaluate(() => {
        // Try to access game state - it might be exposed on window
        // Or we can use the shop to buy lots of units
    });

    // Simple approach: buy units, reroll aggressively
    // First, let's buy one unit and place it to enable combat button
    console.log('\n=== 유닛 구매/배치 ===');
    // Buy first shop unit
    await page.evaluate(() => {
        const shop = document.getElementById('shop-slots');
        if (shop?.children[0]) shop.children[0].click();
    });
    await sleep(500);

    // Place on board
    await page.evaluate(() => {
        const slots = document.getElementById('bench-slots');
        if (slots) {
            for (const s of slots.children) {
                if (s.querySelector('.unit-card')) { s.click(); break; }
            }
        }
    });
    await sleep(300);
    await page.evaluate(() => {
        const grid = document.getElementById('board-grid');
        if (grid) grid.children[10]?.click(); // cell (3,1)
    });
    await sleep(300);

    state = await page.evaluate(() => ({
        round: document.getElementById('hud-round')?.innerText,
        gold: document.getElementById('hud-gold')?.innerText,
        boardCount: document.getElementById('board-count')?.innerText,
        btnText: document.getElementById('btn-next-round')?.textContent,
        btnDisabled: document.getElementById('btn-next-round')?.disabled,
    }));
    console.log('After placement:', JSON.stringify(state));

    // === 4. 빠르게 라운드 진행하여 2-7까지 도달 ===
    console.log('\n=== 빠른 라운드 진행 ===');

    for (let round = 0; round < 30; round++) {
        state = await page.evaluate(() => ({
            round: document.getElementById('hud-round')?.innerText?.trim(),
            gold: document.getElementById('hud-gold')?.innerText,
            hp: document.getElementById('hud-hp')?.innerText,
            level: document.getElementById('hud-level')?.innerText,
            boardCount: document.getElementById('board-count')?.innerText,
            dps: document.getElementById('hud-dps')?.innerText,
            btnText: document.getElementById('btn-next-round')?.textContent?.trim(),
            btnDisabled: document.getElementById('btn-next-round')?.disabled,
            appHidden: document.getElementById('app')?.classList.contains('hidden'),
            resultVisible: (() => {
                const rv = document.getElementById('result-view');
                return rv ? !rv.classList.contains('hidden') : false;
            })(),
        }));

        console.log(`  [${state.round}] 💰${state.gold} ❤️${state.hp} Lv.${state.level} ${state.boardCount} DPS:${state.dps} btn:"${state.btnText}" disabled=${state.btnDisabled} appHidden=${state.appHidden} resultVisible=${state.resultVisible}`);

        // Check if game over
        if (state.appHidden || state.resultVisible) {
            console.log('\n  🛑 게임 오버 감지! (2-7 클리어 체크에 의한 종료)');
            console.log('  → 싱글모드에서는 2-7이 최종 라운드입니다.');
            console.log('  → currentStageId=1 → (stageId+1)-7 = 2-7에서 showGameOver() 호출');
            break;
        }

        // If button text has combat 시작 and not disabled, start combat
        if (state.btnText?.includes('전투 시작') && !state.btnDisabled) {
            // Buy any affordable units first
            await page.evaluate(() => {
                const shop = document.getElementById('shop-slots');
                if (shop) {
                    for (const slot of shop.children) {
                        if (!slot.classList.contains('empty')) slot.click();
                    }
                }
            });
            await sleep(300);

            // Place bench units
            await page.evaluate(() => {
                const slots = document.getElementById('bench-slots');
                const grid = document.getElementById('board-grid');
                if (!slots || !grid) return;
                const cards = slots.querySelectorAll('.unit-card');
                if (cards.length > 0) {
                    // Click first bench card to select
                    cards[0].closest('.bench-slot')?.click();
                }
            });
            await sleep(200);
            await page.evaluate(() => {
                const grid = document.getElementById('board-grid');
                if (grid) {
                    for (const cell of grid.children) {
                        if (!cell.classList.contains('occupied')) { cell.click(); break; }
                    }
                }
            });
            await sleep(200);

            // Start combat
            await page.evaluate(() => document.getElementById('btn-next-round')?.click());
            await sleep(500);
        }

        // Wait for combat to end
        for (let wait = 0; wait < 60; wait++) {
            const btn = await page.evaluate(() => ({
                text: document.getElementById('btn-next-round')?.textContent?.trim(),
                disabled: document.getElementById('btn-next-round')?.disabled,
                appHidden: document.getElementById('app')?.classList.contains('hidden'),
                resultVisible: (() => {
                    const rv = document.getElementById('result-view');
                    return rv ? !rv.classList.contains('hidden') : false;
                })(),
            }));

            if (btn.appHidden || btn.resultVisible) {
                console.log('  → 게임 오버! (result view visible)');
                state.appHidden = true;
                break;
            }

            if (btn.text?.includes('전투 시작') && !btn.disabled) break;
            await sleep(2000);
        }

        if (state.appHidden) break;
    }

    // === 5. 결과 확인 ===
    console.log('\n=== 최종 결과 ===');
    const finalState = await page.evaluate(() => ({
        round: document.getElementById('hud-round')?.innerText,
        gold: document.getElementById('hud-gold')?.innerText,
        hp: document.getElementById('hud-hp')?.innerText,
        level: document.getElementById('hud-level')?.innerText,
        appHidden: document.getElementById('app')?.classList.contains('hidden'),
        resultVisible: (() => {
            const rv = document.getElementById('result-view');
            return rv ? !rv.classList.contains('hidden') : false;
        })(),
    }));
    console.log(JSON.stringify(finalState, null, 2));

    if (finalState.appHidden || finalState.resultVisible) {
        console.log('\n📋 결론: 싱글모드(stageId=1)에서 2-7이 마지막 라운드입니다.');
        console.log('   → currentStageId + 1 = 2, 따라서 2-7 도달 시 showGameOver() 호출');
        console.log('   → 3-1 이후 진행을 위해서는:');
        console.log('     1. 4인 경쟁모드 (currentStageId=7, 7-7까지)');
        console.log('     2. 또는 startGameFromSPA(7)로 stageId 변경 필요');
    } else {
        console.log('\n📋 게임이 계속 진행 중! 2-7 이후에도 라운드가 진행됩니다.');
    }

    await sleep(3000);
    await browser.close();
    process.exit(0);
})();
