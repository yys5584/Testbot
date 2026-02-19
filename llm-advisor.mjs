/**
 * CRD Autobot v2 — LLM Advisor
 * 
 * GPT-4o-mini 기반 게임 분석 + 밸런스 패치 제안
 * 
 * 기능:
 * A. postGameAnalysis()  — 게임 후 밸런스 분석
 * B. suggestPatches()    — 파라미터 변경 제안
 * C. improveStrategy()   — AI 전략 자가 개선
 * 
 * 환경변수: OPENAI_API_KEY 또는 .env 파일
 */

import fs from 'fs';
import path from 'path';

// ── Config ──

const RECORDS_FILE = path.resolve('ai-records.json');
const LLM_LOG_DIR = path.resolve('llm-logs');
if (!fs.existsSync(LLM_LOG_DIR)) fs.mkdirSync(LLM_LOG_DIR, { recursive: true });

function getApiKey() {
    if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
    try {
        const envFile = fs.readFileSync(path.resolve('.env'), 'utf-8');
        const match = envFile.match(/OPENAI_API_KEY\s*=\s*(.+)/);
        if (match) return match[1].trim();
    } catch { }
    return null;
}

// ── LLM Call ──

async function callLLM(messages, { model = 'gpt-4o-mini', temperature = 0.7, maxTokens = 2000 } = {}) {
    const apiKey = getApiKey();
    if (!apiKey) {
        console.log('  ⚠️ OPENAI_API_KEY 미설정 — 폴백 모드');
        return null;
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
        }),
    });

    if (!res.ok) {
        const body = await res.text();
        console.error(`  ❌ LLM API 오류: ${res.status} ${body.slice(0, 200)}`);
        return null;
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
}

// ── Game State Summarizer ──

function summarizeGames(records) {
    const games = records.games;
    const lines = [];

    lines.push(`## 게임 결과 (${games.length}판)`);
    for (const g of games) {
        lines.push(`### 게임 #${g.gameNumber}: ${g.maxRound} | HP:${g.finalHP} | DPS:${g.finalDPS} | Lv.${g.level}`);
        lines.push(`시너지: ${(g.synergies || []).join(', ') || '없음'}`);
        lines.push('');

        // Key rounds
        for (const r of (g.log || [])) {
            if (!r.round || r.round === '0') continue;
            const cov = r.requiredDPS > 0 ? ((r.dps / r.requiredDPS) * 100).toFixed(0) : '100';
            const units = (r.unitsBought || []).map(u => `${u.name}(${u.cost}G${u.merged ? ',★합' : ''})`).join(', ');
            const synergies = (r.synergySnapshot || []).map(s => `${s.name}(${s.count})`).join(', ');
            lines.push(`  ${r.round}: 💰${r.gold}G ❤️${r.hp} Lv.${r.level} [${r.boardSize}] DPS:${r.dps}/${r.requiredDPS}(${cov}%) ${units ? '구매:' + units : ''} ${synergies ? '시너지:' + synergies : ''}`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

// ── UNIT_DB Reference ──

const UNIT_DB_SUMMARY = `
## 유닛 DB (46종)
### 1코 (8종): PC방 채굴자(BTC,6dps), 메타마스크 유저(DeFi,7), 스캠 개발자(Social,7), PerpDEX(Exchange,8), HODLer(VC,8), FUD 유포자(FUD,8), PI User(Rugpull,8), Gareth Soloway(Bear,7)
### 2코 (8종): Jesse Pollak(DeFi,14), Jesse Powell(Exchange,12), Kashkari(FUD,15), OpenSea(Social,14), DAO 거버너(VC,13), Ruja Ignatova(Rugpull,15), Kris Marszalek(Bear,14), 소규모 풀 운영자(BTC,13)
### 3코 (8종): Uniswap V4(DeFi,24), CZ(Exchange,22), Peter Schiff(FUD,25), Elon Musk(Social,24), 비트코인 고래(BTC,21), Marc Andreessen(VC,22), LUNA 홀더(Rugpull,25), 마이클 세일러(Bear,23)
### 4코 (8종): Vitalik(DeFi,36), Brian Armstrong(Exchange,35), Cathie Wood(FUD,38), Punk6529(Social,36), 사토시 나카모토(BTC,34), 크리스 딕슨(VC,35), 김치프리미엄 트레이더(Rugpull,38), Jim Cramer(Bear,36)
### 5코 (8종): GCR(DeFi,52), SBF(Exchange,50), Elizabeth Warren(FUD,55), Jack Dorsey(Social,52), 라이트닝 노드(BTC,48), a16z crypto(VC,50), Do Kwon(Rugpull,55), Nouriel Roubini(Bear,52)

### 시너지 (origin 2/4/6/8): Bitcoin, DeFi, Social, Exchange, VC, FUD, Rugpull, Bear
- 2개: 소량 버프, 4개: 중간 버프, 6개: 강력 버프

### 합성: 같은 유닛 3개 → ★2 (스탯x2), 9개 → ★3 (스탯x4)

### 스테이지: 각 스테이지 7라운드 (1~6 일반 + 7 보스), 보스 HP 높음
`;

// ── Feature A: Post-Game Analysis ──

export async function postGameAnalysis(records) {
    console.log('\n🧠 LLM 포스트 게임 분석...');

    const summary = summarizeGames(records);

    const messages = [
        {
            role: 'system',
            content: `당신은 오토배틀러 게임 "CoinRandomDefense"의 밸런스 분석 전문가 AI입니다.
게임 플레이 데이터를 분석하여 밸런스 문제점을 식별하고 개선안을 제시합니다.

${UNIT_DB_SUMMARY}

출력 형식:
1. **밸런스 진단** (5줄 이내)
2. **핵심 문제** (최대 3개, 구체적 수치 포함)
3. **패치 제안** (JSON 형식)
4. **전략 개선** (AI 에이전트가 다음 게임에서 할 수 있는 것)

패치 제안 JSON 예시:
\`\`\`json
{
  "patches": [
    {"target": "2-7 보스", "field": "hp", "current": 142, "suggested": 100, "reason": "DPS 달성률 9%로 너무 어려움"},
    {"target": "FUD 유포자", "field": "dps", "current": 8, "suggested": 10, "reason": "1코 DPS 효율 상향"}
  ]
}
\`\`\`
`
        },
        {
            role: 'user',
            content: `다음 ${records.games.length}판의 게임 데이터를 분석해주세요:\n\n${summary}`
        }
    ];

    const result = await callLLM(messages, { maxTokens: 2000 });

    if (result) {
        const logFile = path.join(LLM_LOG_DIR, `analysis-${Date.now()}.md`);
        fs.writeFileSync(logFile, result, 'utf-8');
        console.log(`  📄 분석 저장: ${logFile}`);
        return result;
    }

    // Fallback: rule-based analysis
    return fallbackAnalysis(records);
}

// ── Feature B: Balance Patch Suggestions ──

export async function suggestPatches(records) {
    console.log('\n🔧 LLM 밸런스 패치 제안...');

    const summary = summarizeGames(records);

    const messages = [
        {
            role: 'system',
            content: `당신은 게임 밸런스 디자이너입니다. 플레이 데이터를 보고 구체적인 파라미터 패치를 JSON 으로만 제안하세요.

${UNIT_DB_SUMMARY}

반드시 아래 JSON 형식으로만 응답:
{
  "diagnosis": "한 줄 진단",
  "patches": [
    {"target": "유닛/보스/시스템", "field": "파라미터", "current": 현재값, "suggested": 제안값, "reason": "근거", "impact": "예상 영향"}
  ],
  "priority": "high/medium/low"
}`
        },
        {
            role: 'user',
            content: summary
        }
    ];

    const result = await callLLM(messages, { temperature: 0.3, maxTokens: 1500 });

    if (result) {
        try {
            // Extract JSON from response
            const jsonMatch = result.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                const logFile = path.join(LLM_LOG_DIR, `patches-${Date.now()}.json`);
                fs.writeFileSync(logFile, JSON.stringify(parsed, null, 2), 'utf-8');
                console.log(`  📄 패치 제안 저장: ${logFile}`);
                return parsed;
            }
        } catch (e) {
            console.log('  ⚠️ JSON 파싱 실패, 원본 반환');
        }
        return { raw: result };
    }

    return fallbackPatches(records);
}

// ── Feature C: Strategy Self-Improvement ──

export async function improveStrategy(records) {
    console.log('\n📈 LLM 전략 자가 개선...');

    const currentStrategy = records.strategy;
    const summary = summarizeGames(records);

    const messages = [
        {
            role: 'system',
            content: `당신은 오토배틀러 AI 에이전트의 전략 최적화 담당입니다.
현재 전략 파라미터와 게임 결과를 보고, 다음 게임에서 더 잘할 수 있도록 파라미터를 조정합니다.

현재 전략:
${JSON.stringify(currentStrategy, null, 2)}

반드시 아래 JSON 형식으로만 응답:
{
  "reasoning": "조정 근거 (2-3줄)",
  "adjustedStrategy": {
    "interestFloor": 숫자,
    "earlyRerollLimit": 숫자,
    "midRerollBudget": 숫자,
    "lateRerollBudget": 숫자,
    "xpBuyStartRound": 숫자,
    "xpBuyGoldThreshold": 숫자,
    "originWeights": {"Bitcoin": 숫자, ...}
  }
}`
        },
        {
            role: 'user',
            content: summary
        }
    ];

    const result = await callLLM(messages, { temperature: 0.4, maxTokens: 1000 });

    if (result) {
        try {
            const jsonMatch = result.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed.adjustedStrategy) {
                    const logFile = path.join(LLM_LOG_DIR, `strategy-${Date.now()}.json`);
                    fs.writeFileSync(logFile, JSON.stringify(parsed, null, 2), 'utf-8');
                    console.log(`  📄 전략 조정 저장: ${logFile}`);
                    console.log(`  💡 근거: ${parsed.reasoning}`);
                    return parsed.adjustedStrategy;
                }
            }
        } catch (e) {
            console.log('  ⚠️ JSON 파싱 실패');
        }
    }

    return null; // Use existing strategy
}

// ── Fallbacks (no API key) ──

function fallbackAnalysis(records) {
    const games = records.games;
    const lines = [];

    lines.push('## 밸런스 진단 (룰 기반 분석)');
    lines.push('');

    // DPS analysis
    const allRounds = games.flatMap(g => g.log || []);
    const dpsGaps = {};
    for (const r of allRounds) {
        if (!r.round || r.round === '0') continue;
        const cov = r.requiredDPS > 0 ? r.dps / r.requiredDPS : 1;
        if (!dpsGaps[r.round]) dpsGaps[r.round] = [];
        dpsGaps[r.round].push(cov);
    }

    const criticalRounds = Object.entries(dpsGaps)
        .map(([round, covs]) => ({ round, avg: covs.reduce((s, v) => s + v, 0) / covs.length }))
        .filter(r => r.avg < 0.3)
        .sort((a, b) => a.avg - b.avg);

    if (criticalRounds.length > 0) {
        lines.push('### 🔴 핵심 문제: DPS 부족');
        for (const r of criticalRounds.slice(0, 5)) {
            lines.push(`- **${r.round}**: DPS 달성률 ${(r.avg * 100).toFixed(0)}%`);
        }
        lines.push('');
    }

    // Economy analysis
    const avgGoldPerRound = allRounds.reduce((s, r) => s + (r.gold || 0), 0) / allRounds.length;
    lines.push(`### 경제 분석`);
    lines.push(`- 평균 잔여 골드: ${avgGoldPerRound.toFixed(1)}G`);
    lines.push(`- 이자 전략: floor=${records.strategy?.interestFloor || '?'}`);
    lines.push('');

    // Synergy analysis
    const synergyCount = {};
    for (const g of games) {
        for (const s of (g.synergies || [])) {
            synergyCount[s] = (synergyCount[s] || 0) + 1;
        }
    }
    lines.push('### 시너지 활성 빈도');
    if (Object.keys(synergyCount).length === 0) {
        lines.push('- ⚠️ 시너지 활성 없음 — 유닛 다양성 부족');
    } else {
        for (const [s, c] of Object.entries(synergyCount).sort((a, b) => b[1] - a[1])) {
            lines.push(`- ${s}: ${c}회`);
        }
    }
    lines.push('');

    // Patch suggestions
    lines.push('### 📋 패치 제안');
    if (criticalRounds.some(r => r.round === '2-7' || r.round?.endsWith('-7'))) {
        lines.push('- 보스 HP 하향 필요 (DPS 달성률 < 15%)');
    }
    if (avgGoldPerRound > 15) {
        lines.push('- 골드 축적 과다 → 유닛 구매/리롤 더 공격적으로');
    }
    if (Object.keys(synergyCount).length < 2) {
        lines.push('- 시너지 활성률 매우 낮음 → 같은 origin 유닛 우선 구매 전략 강화');
    }

    return lines.join('\n');
}

function fallbackPatches(records) {
    const games = records.games;
    const patches = [];

    // Check boss difficulty
    const bossRounds = games.flatMap(g => (g.log || []).filter(r => r.round?.endsWith('-7')));
    for (const r of bossRounds) {
        if (r.requiredDPS > 0 && r.dps / r.requiredDPS < 0.2) {
            patches.push({
                target: `${r.round} 보스`,
                field: 'hp',
                current: r.requiredDPS,
                suggested: Math.round(r.requiredDPS * 0.6),
                reason: `DPS 달성률 ${((r.dps / r.requiredDPS) * 100).toFixed(0)}%`,
                impact: '클리어율 상승',
            });
        }
    }

    return {
        diagnosis: '룰 기반 분석 (LLM API 미설정)',
        patches: patches.slice(0, 5),
        priority: patches.length > 3 ? 'high' : 'medium',
    };
}

// ── Inject LLM Analysis into Report ──

export function generateLLMReportSection(analysis, patches) {
    if (!analysis && !patches) return '';

    let html = '<h2>🧠 AI 분석 (LLM)</h2>';

    if (typeof analysis === 'string') {
        // Convert markdown to simple HTML
        const htmlContent = analysis
            .replace(/### (.+)/g, '<h4>$1</h4>')
            .replace(/## (.+)/g, '<h3>$1</h3>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/- (.+)/g, '<li>$1</li>')
            .replace(/```json([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
            .replace(/`(.+?)`/g, '<code>$1</code>')
            .replace(/\n\n/g, '<br><br>');
        html += `<div class="llm-analysis">${htmlContent}</div>`;
    }

    if (patches?.patches?.length > 0) {
        html += '<h3>🔧 밸런스 패치 제안</h3>';
        html += '<table><tr><th>대상</th><th>파라미터</th><th>현재</th><th>제안</th><th>근거</th></tr>';
        for (const p of patches.patches) {
            html += `<tr><td>${p.target}</td><td>${p.field}</td><td>${p.current}</td><td><strong>${p.suggested}</strong></td><td>${p.reason}</td></tr>`;
        }
        html += '</table>';
    }

    return html;
}

// ── CLI Entry Point ──

if (process.argv[1]?.endsWith('llm-advisor.mjs')) {
    const records = JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf-8'));

    console.log('🤖 CRD Autobot — LLM 밸런스 분석\n');

    const analysis = await postGameAnalysis(records);
    const patches = await suggestPatches(records);
    const strategy = await improveStrategy(records);

    console.log('\n════════════════════════════════════');
    console.log('📋 분석 결과:');
    console.log('════════════════════════════════════');
    console.log(typeof analysis === 'string' ? analysis : JSON.stringify(analysis, null, 2));

    if (patches) {
        console.log('\n🔧 패치 제안:');
        console.log(JSON.stringify(patches, null, 2));
    }

    if (strategy) {
        console.log('\n📈 조정된 전략:');
        console.log(JSON.stringify(strategy, null, 2));
    }
}
