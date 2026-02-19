import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--window-size=1500,900'],
        defaultViewport: { width: 1440, height: 810 },
    });
    const page = await browser.newPage();

    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 15000 });
    await sleep(2000);

    // Enter game
    await page.evaluate(() => document.getElementById('btn-normal')?.click());
    await sleep(2000);
    await page.evaluate(() => document.getElementById('btn-start-bots')?.click());
    await sleep(5000);

    // Check initial state
    console.log('=== INITIAL STATE ===');
    let state = await page.evaluate(() => ({
        gold: document.getElementById('hud-gold')?.innerText,
        round: document.getElementById('hud-round')?.innerText,
        boardCount: document.getElementById('board-count')?.innerText,
        benchCount: document.querySelectorAll('.bench-slot .unit-card').length,
        buttonText: document.getElementById('btn-next-round')?.textContent,
        buttonDisabled: document.getElementById('btn-next-round')?.disabled,
    }));
    console.log(JSON.stringify(state, null, 2));

    // Buy a unit
    console.log('\n=== BUY FIRST SHOP UNIT ===');
    await page.evaluate(() => {
        const shop = document.getElementById('shop-slots');
        if (shop?.children[0] && !shop.children[0].classList.contains('empty')) {
            shop.children[0].click();
        }
    });
    await sleep(500);

    state = await page.evaluate(() => ({
        gold: document.getElementById('hud-gold')?.innerText,
        boardCount: document.getElementById('board-count')?.innerText,
        benchCount: document.querySelectorAll('.bench-slot .unit-card').length,
        benchSlots: (() => {
            const result = [];
            const slots = document.getElementById('bench-slots');
            if (slots) {
                for (let i = 0; i < slots.children.length; i++) {
                    const card = slots.children[i].querySelector('.unit-card');
                    if (card) result.push({ index: i, name: card.querySelector('.name')?.textContent });
                }
            }
            return result;
        })(),
        buttonText: document.getElementById('btn-next-round')?.textContent,
        buttonDisabled: document.getElementById('btn-next-round')?.disabled,
    }));
    console.log('After buy:', JSON.stringify(state, null, 2));

    if (state.benchSlots.length > 0) {
        const benchIdx = state.benchSlots[0].index;

        // CLICK BENCH SLOT TO SELECT
        console.log(`\n=== CLICKING BENCH SLOT ${benchIdx} ===`);
        await page.evaluate((idx) => {
            const slots = document.getElementById('bench-slots');
            if (slots?.children[idx]) {
                console.log('Clicking bench slot', idx);
                slots.children[idx].click();
            }
        }, benchIdx);
        await sleep(500);

        // Check selection
        const sel = await page.evaluate(() => {
            const selected = document.querySelectorAll('.selected');
            return {
                selectedCount: selected.length,
                selectedHTML: selected[0]?.outerHTML?.substring(0, 200),
                boardCount: document.getElementById('board-count')?.innerText,
            };
        });
        console.log('Selection:', JSON.stringify(sel, null, 2));

        // CLICK BOARD CELL (3,1)
        console.log('\n=== CLICKING BOARD CELL (3,1) ===');
        await page.evaluate(() => {
            const grid = document.getElementById('board-grid');
            if (!grid) { console.log('No grid!'); return; }
            for (const cell of grid.children) {
                if (cell.dataset.x === '3' && cell.dataset.y === '1') {
                    console.log('Found cell 3,1, clicking');
                    cell.click();
                    break;
                }
            }
        });
        await sleep(500);

        // Check result
        const after = await page.evaluate(() => ({
            boardCount: document.getElementById('board-count')?.innerText,
            benchCount: document.querySelectorAll('.bench-slot .unit-card').length,
            occupiedCells: (() => {
                const grid = document.getElementById('board-grid');
                const result = [];
                if (grid) {
                    for (const cell of grid.children) {
                        if (cell.classList.contains('occupied')) {
                            const card = cell.querySelector('.unit-card');
                            result.push({
                                x: cell.dataset.x, y: cell.dataset.y,
                                name: card?.querySelector('.name')?.textContent,
                            });
                        }
                    }
                }
                return result;
            })(),
            buttonText: document.getElementById('btn-next-round')?.textContent,
            buttonDisabled: document.getElementById('btn-next-round')?.disabled,
        }));
        console.log('After placement:', JSON.stringify(after, null, 2));

        if (after.occupiedCells.length > 0) {
            // TRY START COMBAT
            console.log('\n=== STARTING COMBAT ===');
            await page.evaluate(() => document.getElementById('btn-next-round')?.click());
            await sleep(1000);

            const combat = await page.evaluate(() => ({
                buttonText: document.getElementById('btn-next-round')?.textContent,
                buttonDisabled: document.getElementById('btn-next-round')?.disabled,
                round: document.getElementById('hud-round')?.innerText,
            }));
            console.log('Combat state:', JSON.stringify(combat, null, 2));

            // Wait for combat end
            console.log('\n=== WAITING FOR COMBAT END ===');
            for (let i = 0; i < 30; i++) {
                await sleep(2000);
                const s = await page.evaluate(() => ({
                    text: document.getElementById('btn-next-round')?.textContent?.trim(),
                    disabled: document.getElementById('btn-next-round')?.disabled,
                    round: document.getElementById('hud-round')?.innerText,
                    gold: document.getElementById('hud-gold')?.innerText,
                }));
                console.log(`  ${i}: ${s.text} disabled=${s.disabled} round=${s.round} gold=${s.gold}`);
                if (s.text?.includes('전투 시작') && !s.disabled) {
                    console.log('  ✅ Combat ended!');
                    break;
                }
            }
        }
    }

    await browser.close();
    process.exit(0);
})();
