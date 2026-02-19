import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = path.resolve('qa-screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
    console.log('🚀 CoinRandomDefense v3.5 — 게임 화면 스크린샷 캡처\n');
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--window-size=1500,900', '--force-device-scale-factor=1'],
        defaultViewport: { width: 1440, height: 810 }
    });
    const page = await browser.newPage();

    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 15000 });
    await sleep(2000);

    // Take lobby screenshot
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'final_0_lobby.png') });
    console.log('📸 로비 스크린샷');

    // Click campaign to enter game
    await page.evaluate(() => document.getElementById('btn-campaign')?.click());
    await sleep(3000);

    // Force hide lobby, show game for screenshot purposes
    await page.evaluate(() => {
        const lobby = document.getElementById('lobby-screen');
        const game = document.getElementById('game-screen');
        const wrapper = document.getElementById('game-scale-wrapper');
        if (lobby) lobby.style.display = 'none';
        if (game) { game.classList.remove('hidden'); game.style.display = ''; }
        if (wrapper) { wrapper.style.transform = 'none'; wrapper.style.position = 'relative'; wrapper.style.left = '0'; wrapper.style.top = '0'; }
    });
    await sleep(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'final_1_game.png'), fullPage: true });
    console.log('📸 게임 화면 스크린샷');

    // Reroll 3 times
    for (let i = 0; i < 3; i++) {
        await page.evaluate(() => document.getElementById('btn-reroll')?.click());
        await sleep(500);
    }
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'final_2_reroll.png'), fullPage: true });
    console.log('📸 리롤 후 스크린샷');

    // Buy first unit
    await page.evaluate(() => {
        const shop = document.getElementById('shop-slots');
        if (shop?.children[0]) shop.children[0].click();
    });
    await sleep(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'final_3_buy.png'), fullPage: true });
    console.log('📸 구매 후 스크린샷');

    // Select bench unit and place on board
    await page.evaluate(() => {
        const bench = document.getElementById('bench-slots');
        if (bench) {
            for (const child of bench.children) {
                if (!child.classList.contains('empty')) { child.click(); break; }
            }
        }
    });
    await sleep(500);
    await page.evaluate(() => {
        const grid = document.getElementById('board-grid');
        if (grid) {
            for (const child of grid.children) {
                if (child.classList.contains('empty') || child.children.length === 0) { child.click(); break; }
            }
        }
    });
    await sleep(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'final_4_placed.png'), fullPage: true });
    console.log('📸 배치 후 스크린샷');

    // Start combat
    await page.evaluate(() => document.getElementById('btn-next-round')?.click());
    await sleep(5000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'final_5_combat.png'), fullPage: true });
    console.log('📸 전투 스크린샷');

    console.log('\n✅ 모든 스크린샷 캡처 완료');
    await browser.close();
    process.exit(0);
})();
