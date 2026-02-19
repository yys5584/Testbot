/**
 * CRD Autobot v2 — Balance Report Generator
 * 
 * ai-records.json → reports/balance-report-{timestamp}.html
 * 
 * Chart.js CDN 임베드, 오프라인에서도 열 수 있는 단일 HTML 파일 생성
 */

import fs from 'fs';
import path from 'path';
import { generateLLMReportSection } from './llm-advisor.mjs';

const RECORDS_FILE = path.resolve('ai-records.json');
const REPORTS_DIR = path.resolve('reports');

if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

function loadRecords() {
    if (!fs.existsSync(RECORDS_FILE)) {
        console.error('❌ ai-records.json not found. Run `npm run ai` first.');
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf-8'));
}

// ── Analyze ──

function analyzeGames(records) {
    const games = records.games;
    const allRounds = games.flatMap(g => g.log || []);

    // 1. Unit pick rates
    const unitPicks = {};
    for (const r of allRounds) {
        for (const u of (r.unitsBought || [])) {
            unitPicks[u.name] = (unitPicks[u.name] || { count: 0, cost: 0, merged: 0 });
            unitPicks[u.name].count++;
            unitPicks[u.name].cost = u.cost;
            if (u.merged) unitPicks[u.name].merged++;
        }
    }

    // 2. DPS coverage per round (averaged across games)
    const roundDPS = {};
    for (const g of games) {
        for (const r of (g.log || [])) {
            if (!r.round || r.round === '0') continue;
            if (!roundDPS[r.round]) roundDPS[r.round] = { dps: [], req: [], coverage: [] };
            roundDPS[r.round].dps.push(r.dps || 0);
            roundDPS[r.round].req.push(r.requiredDPS || 0);
            const cov = r.dpsCoverage ?? (r.requiredDPS > 0 ? r.dps / r.requiredDPS : 1);
            roundDPS[r.round].coverage.push(cov);
        }
    }

    // 3. Economy per round
    const roundEcon = {};
    for (const g of games) {
        for (const r of (g.log || [])) {
            if (!r.round || r.round === '0') continue;
            if (!roundEcon[r.round]) roundEcon[r.round] = { gold: [], spentU: [], spentR: [], spentX: [] };
            roundEcon[r.round].gold.push(r.gold || 0);
            const e = r.goldEconomy || {};
            roundEcon[r.round].spentU.push(e.spentUnits || 0);
            roundEcon[r.round].spentR.push(e.spentReroll || 0);
            roundEcon[r.round].spentX.push(e.spentXP || 0);
        }
    }

    // 4. HP per round
    const roundHP = {};
    for (const g of games) {
        for (const r of (g.log || [])) {
            if (!r.round || r.round === '0') continue;
            if (!roundHP[r.round]) roundHP[r.round] = [];
            roundHP[r.round].push(r.hp || 0);
        }
    }

    // 5. Synergy activation
    const synergyMap = {};
    for (const g of games) {
        for (const r of (g.log || [])) {
            for (const s of (r.synergySnapshot || [])) {
                if (!synergyMap[s.name]) synergyMap[s.name] = { total: 0, rounds: {} };
                synergyMap[s.name].total++;
                synergyMap[s.name].rounds[r.round] = (synergyMap[s.name].rounds[r.round] || 0) + 1;
            }
        }
    }

    // 6. Cost distribution per round
    const costDist = {};
    for (const g of games) {
        for (const r of (g.log || [])) {
            if (!r.round || r.round === '0') continue;
            if (!costDist[r.round]) costDist[r.round] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
            for (const u of (r.unitsOnBoard || [])) {
                // Look up cost from unitsBought or guess from name
                const bought = (r.unitsBought || []).find(b => b.name === u.name);
                const cost = bought?.cost || 1;
                costDist[r.round][Math.min(5, cost)]++;
            }
        }
    }

    // 7. Anomalies
    const anomalies = [];
    // Low DPS coverage zones
    for (const [round, data] of Object.entries(roundDPS)) {
        const avgCov = avg(data.coverage);
        if (avgCov < 0.3 && data.req[0] > 5) {
            anomalies.push({ type: 'low_dps', round, coverage: avgCov, severity: avgCov < 0.15 ? 'critical' : 'warning' });
        }
    }
    // Unpicked units (all 46 units in UNIT_DB that were never bought)
    const allUnitNames = Object.keys(unitPicks);
    if (allUnitNames.length < 10) {
        anomalies.push({ type: 'low_diversity', message: `${allUnitNames.length}종만 픽됨 (46종 중)`, severity: 'info' });
    }
    // Economy bottleneck (0 gold + 0 actions)
    for (const r of allRounds) {
        if (r.gold === 0 && r.actionsCount <= 1 && r.round !== '1-1') {
            anomalies.push({ type: 'economy_bottleneck', round: r.round, severity: 'warning' });
        }
    }
    // Deduplicate anomalies by round+type
    const seen = new Set();
    const uniqueAnomalies = anomalies.filter(a => {
        const key = `${a.type}-${a.round || a.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    return {
        games,
        unitPicks,
        roundDPS,
        roundEcon,
        roundHP,
        synergyMap,
        costDist,
        anomalies: uniqueAnomalies,
        strategy: records.strategy,
    };
}

function avg(arr) {
    return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function roundOrder(rounds) {
    return Object.keys(rounds).sort((a, b) => {
        const [as, ar] = a.split('-').map(Number);
        const [bs, br] = b.split('-').map(Number);
        return (as * 10 + ar) - (bs * 10 + br);
    });
}

// ── HTML Template ──

function generateHTML(analysis, records) {
    const { games, unitPicks, roundDPS, roundEcon, roundHP, synergyMap, costDist, anomalies, strategy } = analysis;
    const rounds = roundOrder(roundDPS);
    const ts = new Date().toLocaleString('ko-KR');

    // Prepare chart data
    const dpsLabels = JSON.stringify(rounds);
    const dpsActual = JSON.stringify(rounds.map(r => Math.round(avg(roundDPS[r].dps))));
    const dpsRequired = JSON.stringify(rounds.map(r => Math.round(avg(roundDPS[r].req))));
    const dpsCoverage = JSON.stringify(rounds.map(r => +(avg(roundDPS[r].coverage) * 100).toFixed(1)));

    const econLabels = JSON.stringify(roundOrder(roundEcon));
    const econRounds = roundOrder(roundEcon);
    const econGold = JSON.stringify(econRounds.map(r => Math.round(avg(roundEcon[r].gold))));
    const econSpentU = JSON.stringify(econRounds.map(r => Math.round(avg(roundEcon[r].spentU))));
    const econSpentR = JSON.stringify(econRounds.map(r => Math.round(avg(roundEcon[r].spentR))));
    const econSpentX = JSON.stringify(econRounds.map(r => Math.round(avg(roundEcon[r].spentX))));

    const hpRounds = roundOrder(roundHP);
    const hpLabels = JSON.stringify(hpRounds);
    const hpData = JSON.stringify(hpRounds.map(r => Math.round(avg(roundHP[r]))));

    // Unit picks sorted
    const unitEntries = Object.entries(unitPicks).sort((a, b) => b[1].count - a[1].count);
    const unitLabels = JSON.stringify(unitEntries.map(e => e[0]));
    const unitCounts = JSON.stringify(unitEntries.map(e => e[1].count));
    const unitMerges = JSON.stringify(unitEntries.map(e => e[1].merged));
    const unitCosts = JSON.stringify(unitEntries.map(e => e[1].cost));

    // Synergy heat
    const synergyNames = Object.keys(synergyMap).sort();
    const synergyData = JSON.stringify(synergyNames.map(n => ({
        name: n, total: synergyMap[n].total,
        byRound: rounds.map(r => synergyMap[n].rounds[r] || 0),
    })));

    // Cost dist
    const costRounds = roundOrder(costDist);
    const costLabels = JSON.stringify(costRounds);
    const cost1 = JSON.stringify(costRounds.map(r => costDist[r][1] || 0));
    const cost2 = JSON.stringify(costRounds.map(r => costDist[r][2] || 0));
    const cost3 = JSON.stringify(costRounds.map(r => costDist[r][3] || 0));
    const cost4 = JSON.stringify(costRounds.map(r => costDist[r][4] || 0));
    const cost5 = JSON.stringify(costRounds.map(r => costDist[r][5] || 0));

    // Game summary
    const gameSummaryHTML = games.map(g => `
        <tr>
            <td>#${g.gameNumber}</td>
            <td>${g.maxRound}</td>
            <td>${g.finalHP}</td>
            <td>${g.finalDPS}</td>
            <td>Lv.${g.level}</td>
            <td>${g.boardSize}</td>
            <td>${(g.synergies || []).join(', ') || '—'}</td>
        </tr>`).join('\n');

    // Anomalies
    const anomalyHTML = anomalies.length === 0 ? '<p style="color:#4ade80">✅ 이상 없음</p>' :
        anomalies.map(a => {
            const icon = a.severity === 'critical' ? '🔴' : a.severity === 'warning' ? '🟡' : '🔵';
            let msg = '';
            if (a.type === 'low_dps') msg = `${a.round} — DPS 달성률 ${(a.coverage * 100).toFixed(0)}%`;
            else if (a.type === 'economy_bottleneck') msg = `${a.round} — 경제 병목 (골드 0, 행동 불가)`;
            else if (a.type === 'low_diversity') msg = a.message;
            else msg = JSON.stringify(a);
            return `<div class="anomaly ${a.severity}">${icon} ${msg}</div>`;
        }).join('\n');

    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CRD Autobot — 밸런스 리포트</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', sans-serif; background: #0f0f23; color: #e2e8f0; padding: 24px; }
h1 { font-size: 28px; color: #fbbf24; margin-bottom: 4px; }
h2 { font-size: 20px; color: #60a5fa; margin: 32px 0 12px; border-bottom: 1px solid #1e293b; padding-bottom: 8px; }
h3 { font-size: 16px; color: #94a3b8; margin: 20px 0 8px; }
.subtitle { color: #64748b; margin-bottom: 24px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
.card { background: #1e1e3a; border-radius: 12px; padding: 20px; border: 1px solid #2d2d5e; }
.card.full { grid-column: 1 / -1; }
canvas { max-height: 320px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th { text-align: left; color: #94a3b8; border-bottom: 1px solid #2d2d5e; padding: 8px 6px; }
td { padding: 8px 6px; border-bottom: 1px solid #1a1a3a; }
tr:hover { background: #2d2d5e33; }
.anomaly { padding: 8px 12px; margin: 4px 0; border-radius: 6px; font-size: 14px; }
.anomaly.critical { background: #7f1d1d44; border-left: 3px solid #ef4444; }
.anomaly.warning { background: #78350f44; border-left: 3px solid #f59e0b; }
.anomaly.info { background: #1e3a5f44; border-left: 3px solid #3b82f6; }
.stat-box { display: inline-block; background: #1e1e3a; border-radius: 8px; padding: 12px 20px; margin: 4px; text-align: center; border: 1px solid #2d2d5e; }
.stat-box .value { font-size: 28px; font-weight: bold; color: #fbbf24; }
.stat-box .label { font-size: 12px; color: #64748b; }
.llm-section { background: #1a1a3a; border: 1px solid #4f46e5; border-radius: 12px; padding: 20px; margin-top: 20px; }
.llm-section h2 { color: #a78bfa; border-color: #4f46e5; }
.llm-placeholder { color: #64748b; font-style: italic; }
</style>
</head>
<body>

<h1>🤖 CRD Autobot — 밸런스 리포트</h1>
<p class="subtitle">생성: ${ts} | ${games.length}판 분석</p>

<!-- Summary Stats -->
<div style="margin-bottom:24px">
<div class="stat-box"><div class="value">${games.length}</div><div class="label">판 수</div></div>
<div class="stat-box"><div class="value">${games[games.length - 1]?.maxRound || '—'}</div><div class="label">최다 라운드</div></div>
<div class="stat-box"><div class="value">${Math.round(avg(games.map(g => g.finalHP)))}</div><div class="label">평균 HP</div></div>
<div class="stat-box"><div class="value">${Math.round(avg(games.map(g => g.finalDPS)))}</div><div class="label">평균 DPS</div></div>
<div class="stat-box"><div class="value">${unitEntries.length}</div><div class="label">유닛 다양성</div></div>
<div class="stat-box"><div class="value">${anomalies.filter(a => a.severity === 'critical').length}</div><div class="label">심각 이상</div></div>
</div>

<!-- Game Summary Table -->
<h2>📊 게임별 요약</h2>
<table>
<tr><th>게임</th><th>라운드</th><th>HP</th><th>DPS</th><th>레벨</th><th>보드</th><th>시너지</th></tr>
${gameSummaryHTML}
</table>

<!-- Charts -->
<h2>📈 밸런스 차트</h2>

<div class="grid">
<div class="card">
<h3>DPS 달성률</h3>
<canvas id="chartDPS"></canvas>
</div>
<div class="card">
<h3>DPS 커버리지 (%)</h3>
<canvas id="chartCoverage"></canvas>
</div>
<div class="card">
<h3>경제 곡선</h3>
<canvas id="chartEcon"></canvas>
</div>
<div class="card">
<h3>HP 추이</h3>
<canvas id="chartHP"></canvas>
</div>
<div class="card">
<h3>유닛 픽률</h3>
<canvas id="chartUnits"></canvas>
</div>
<div class="card">
<h3>코스트 분포</h3>
<canvas id="chartCost"></canvas>
</div>
</div>

<!-- Anomalies -->
<h2>⚠️ 이상치 탐지</h2>
<div class="card full">
${anomalyHTML}
</div>

<!-- LLM Section -->
<div class="llm-section">
${(() => {
            const llmContent = generateLLMReportSection(records?.llmAnalysis, records?.llmPatches);
            return llmContent || `<h2>🧠 AI 분석 (LLM)</h2><p class="llm-placeholder"><code>npm run ai</code> 실행 시 자동으로 밸런스 분석이 표시됩니다. OPENAI_API_KEY 설정 시 GPT-4o 분석, 미설정 시 룰 기반 분석.</p>`;
        })()}
</div>

<script>
const dpsLabels = ${dpsLabels};
const dpsActual = ${dpsActual};
const dpsRequired = ${dpsRequired};
const dpsCoverage = ${dpsCoverage};

// 1. DPS Chart
new Chart(document.getElementById('chartDPS'), {
    type: 'line',
    data: {
        labels: dpsLabels,
        datasets: [
            { label: '실제 DPS', data: dpsActual, borderColor: '#4ade80', backgroundColor: '#4ade8022', fill: true, tension: 0.3 },
            { label: '요구 DPS', data: dpsRequired, borderColor: '#ef4444', backgroundColor: '#ef444422', fill: true, tension: 0.3 },
        ]
    },
    options: { responsive: true, plugins: { legend: { labels: { color: '#94a3b8' } } }, scales: { x: { ticks: { color: '#64748b' } }, y: { ticks: { color: '#64748b' }, beginAtZero: true } } }
});

// 2. Coverage Chart
new Chart(document.getElementById('chartCoverage'), {
    type: 'bar',
    data: {
        labels: dpsLabels,
        datasets: [{
            label: 'DPS 달성률 (%)',
            data: dpsCoverage,
            backgroundColor: dpsCoverage.map(v => v >= 100 ? '#4ade80' : v >= 50 ? '#fbbf24' : '#ef4444'),
            borderRadius: 4,
        }]
    },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#64748b' } }, y: { ticks: { color: '#64748b' }, max: Math.max(100, ...dpsCoverage) + 10 } } }
});

// 3. Economy Chart
new Chart(document.getElementById('chartEcon'), {
    type: 'bar',
    data: {
        labels: ${econLabels},
        datasets: [
            { label: '잔액', data: ${econGold}, backgroundColor: '#fbbf24aa', borderRadius: 3 },
            { label: '유닛 구매', data: ${econSpentU}, backgroundColor: '#60a5faaa', borderRadius: 3 },
            { label: '리롤', data: ${econSpentR}, backgroundColor: '#f472b6aa', borderRadius: 3 },
            { label: 'XP', data: ${econSpentX}, backgroundColor: '#a78bfaaa', borderRadius: 3 },
        ]
    },
    options: { responsive: true, plugins: { legend: { labels: { color: '#94a3b8' } } }, scales: { x: { stacked: false, ticks: { color: '#64748b' } }, y: { ticks: { color: '#64748b' } } } }
});

// 4. HP Chart
new Chart(document.getElementById('chartHP'), {
    type: 'line',
    data: {
        labels: ${hpLabels},
        datasets: [{
            label: 'HP',
            data: ${hpData},
            borderColor: '#ef4444',
            backgroundColor: '#ef444422',
            fill: true, tension: 0.3, pointRadius: 3,
        }]
    },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#64748b' } }, y: { ticks: { color: '#64748b' }, min: 0, max: 22 } } }
});

// 5. Unit Picks
new Chart(document.getElementById('chartUnits'), {
    type: 'bar',
    data: {
        labels: ${unitLabels},
        datasets: [
            { label: '구매 횟수', data: ${unitCounts}, backgroundColor: '#60a5faaa', borderRadius: 3 },
            { label: '합성 횟수', data: ${unitMerges}, backgroundColor: '#fbbf24aa', borderRadius: 3 },
        ]
    },
    options: { indexAxis: 'y', responsive: true, plugins: { legend: { labels: { color: '#94a3b8' } } }, scales: { x: { ticks: { color: '#64748b' } }, y: { ticks: { color: '#94a3b8', font: { size: 11 } } } } }
});

// 6. Cost Distribution
new Chart(document.getElementById('chartCost'), {
    type: 'bar',
    data: {
        labels: ${costLabels},
        datasets: [
            { label: '1코', data: ${cost1}, backgroundColor: '#94a3b8', borderRadius: 2 },
            { label: '2코', data: ${cost2}, backgroundColor: '#60a5fa', borderRadius: 2 },
            { label: '3코', data: ${cost3}, backgroundColor: '#a78bfa', borderRadius: 2 },
            { label: '4코', data: ${cost4}, backgroundColor: '#fbbf24', borderRadius: 2 },
            { label: '5코', data: ${cost5}, backgroundColor: '#ef4444', borderRadius: 2 },
        ]
    },
    options: { responsive: true, plugins: { legend: { labels: { color: '#94a3b8' } } }, scales: { x: { stacked: true, ticks: { color: '#64748b' } }, y: { stacked: true, ticks: { color: '#64748b' } } } }
});
</script>
</body>
</html>`;
}

// ── Main ──

const records = loadRecords();
const analysis = analyzeGames(records);
const html = generateHTML(analysis, records);

const filename = `balance-report-${Date.now()}.html`;
const filepath = path.join(REPORTS_DIR, filename);
fs.writeFileSync(filepath, html, 'utf-8');

// Also write a latest symlink
fs.writeFileSync(path.join(REPORTS_DIR, 'latest.html'), html, 'utf-8');

console.log('🤖 CRD Autobot — 밸런스 리포트 생성 완료');
console.log(`📊 ${filepath}`);
console.log(`📊 ${path.join(REPORTS_DIR, 'latest.html')}`);
console.log(`\n📈 게임 ${analysis.games.length}판 분석`);
console.log(`⚠️ 이상치 ${analysis.anomalies.length}건 탐지`);

// Print anomalies to console
for (const a of analysis.anomalies) {
    const icon = a.severity === 'critical' ? '🔴' : a.severity === 'warning' ? '🟡' : '🔵';
    let msg = '';
    if (a.type === 'low_dps') msg = `${a.round} — DPS 달성률 ${(a.coverage * 100).toFixed(0)}%`;
    else if (a.type === 'economy_bottleneck') msg = `${a.round} — 경제 병목`;
    else if (a.type === 'low_diversity') msg = a.message;
    console.log(`  ${icon} ${msg}`);
}
