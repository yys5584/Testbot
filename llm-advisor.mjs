/**
 * CRD Autobot v3 — LLM Advisor (Gemini 1.5 Pro)
 * 
 * Google Gemini 1.5 Pro 기반 게임 분석 + 밸런스 패치 제안
 * 
 * 기능:
 * A. postGameAnalysis()  — 게임 후 밸런스 분석
 * B. suggestPatches()    — 파라미터 변경 제안
 * C. improveStrategy()   — AI 전략 자가 개선
 * 
 * 환경변수: GEMINI_API_KEY (.env 파일)
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

// 1. 숨겨둔 .env 파일에서 환경변수(API 키)를 안전하게 불러옵니다.
dotenv.config();

if (!process.env.GEMINI_API_KEY) {
    console.warn("  ⚠️ .env 파일에 GEMINI_API_KEY가 없습니다 — 폴백 모드로 실행");
}

// 2. Gemini 클라이언트 초기화 (싱글톤)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ── Config ──

const RECORDS_FILE = path.resolve('ai-records.json');
const LLM_LOG_DIR = path.resolve('llm-logs');
if (!fs.existsSync(LLM_LOG_DIR)) fs.mkdirSync(LLM_LOG_DIR, { recursive: true });

// ── LLM Call (Gemini) ──

async function callLLM(messages, { temperature = 0.3, maxTokens = 2000 } = {}) {
    try {
        const systemMsg = messages.find(m => m.role === 'system')?.content || '';
        const userMsg = messages.filter(m => m.role !== 'system').map(m => m.content).join('\n\n');

        const model = genAI.getGenerativeModel({
            model: 'gemini-1.5-pro',
            systemInstruction: systemMsg,
            generationConfig: { temperature, maxOutputTokens: maxTokens },
        });

        const result = await model.generateContent(userMsg);
        return result.response.text() || null;
    } catch (e) {
        console.error(`  ❌ Gemini API 오류: ${e.message}`);
        return null;
    }
}

// ── Game State Summarizer ──

/**
 * 📊 1. 통계 데이터 압축기 (LLM 토큰 최적화 및 환각 방지)
 */
function compressDataForLLM(records) {
    const { games, unitScores, learnedParams } = records;
    if (!games || games.length === 0) return "데이터 부족";

    const totalGames = games.length;
    const avgRound = learnedParams?.avgRoundReached || 0;

    const validUnits = Object.entries(unitScores || {})
        .filter(([_, s]) => s.gamesPlayed >= 5)
        .sort((a, b) => b[1].avgScore - a[1].avgScore);

    const opUnits = validUnits.slice(0, 5).map(([name, s]) =>
        `- ${name} (픽률: ${((s.gamesPlayed / totalGames) * 100).toFixed(0)}%, 도달 라운드: ${s.avgScore.toFixed(1)})`
    );

    const trapUnits = validUnits.slice(-5).reverse().map(([name, s]) =>
        `- ${name} (픽률: ${((s.gamesPlayed / totalGames) * 100).toFixed(0)}%, 도달 라운드: ${s.avgScore.toFixed(1)})`
    );

    const synergyStats = Object.entries(learnedParams?.synergyScores || {})
        .sort((a, b) => (b[1].total / b[1].count) - (a[1].total / a[1].count))
        .map(([name, data]) =>
            `- [${name}] 평균 도달: ${(data.total / data.count).toFixed(1)}R (사용: ${data.count}번)`
        );

    return `
[누적 시뮬레이션 통계]
- 총 테스트 판수: ${totalGames}판
- 전체 평균 도달 라운드: ${avgRound.toFixed(1)}R

[🏆 1티어 (OP) 유닛 Top 5]
${opUnits.join('\n') || '데이터 부족'}

[💀 함정 (Trap) 유닛 Top 5]
${trapUnits.join('\n') || '데이터 부족'}

[🔗 시너지 파워 랭킹]
${synergyStats.join('\n') || '데이터 부족'}
    `.trim();
}

// ── Feature A: Post-Game Analysis ──

/**
 * 🧠 2. 수석 기획자(LLM) 분석 요청 함수
 */
export async function postGameAnalysis(records) {
    const statsSummary = compressDataForLLM(records);
    console.log("  📊 LLM에게 전달할 통계 요약 생성 완료");

    const prompt = `
아래 통계를 바탕으로 마크다운(Markdown) 형식의 [정밀 밸런스 리포트]를 작성하십시오.
추상적인 조언은 배제하고, "어떤 시너지를 몇 % 너프해야 하는지", "어떤 유닛의 골드 비용을 올려야 하는지" 구체적인 수치를 제안해야 합니다.

${statsSummary}

### 작성 양식 (반드시 아래 포맷을 지킬 것):
## 📈 메타 분석 요약
(현재 어떤 시너지와 유닛이 OP이고, 어떤 것이 버려지고 있는지 3줄 요약)

## ⚖️ 긴급 밸런스 패치 제안 (Action Item)
1. **[너프 필요]**: (OP 유닛/시너지 이름) - (이유 및 구체적인 너프 수치 제안)
2. **[버프 필요]**: (함정 유닛/시너지 이름) - (이유 및 구체적인 버프 수치 제안)
3. **[경제 시스템]**: (현재 유저들이 이자 시스템을 어떻게 활용하고 있는지, 30골드 제한이 적절한지 분석)

## 💡 수석 기획자의 코멘트
(해시드 심사역들이 좋아할 만한 Web3 내러티브적 관점에서의 메타 해석 한 마디)
`;

    console.log("  🚀 Gemini 1.5 Pro에게 밸런스 분석을 요청합니다. (철통 보안 적용됨)...");

    try {
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-pro",
            systemInstruction: "당신은 해시드(Hashed)의 투자를 받은 Web3 오토배틀러 디펜스 게임의 수석 밸런스 기획자입니다.",
            generationConfig: { temperature: 0.3 },
        });

        const result = await model.generateContent(prompt);
        const reportMarkdown = result.response.text();

        console.log("  ✅ Gemini 밸런스 리포트 생성 완료!\n");

        const logFile = path.join(LLM_LOG_DIR, `analysis-${Date.now()}.md`);
        fs.writeFileSync(logFile, reportMarkdown, 'utf-8');
        console.log(`  📄 분석 저장: ${logFile}`);
        return reportMarkdown;

    } catch (error) {
        console.error("  ❌ Gemini API 호출 실패:", error.message);
        return fallbackAnalysis(records);
    }
}

// ── Feature B: Balance Patch Suggestions ──

export async function suggestPatches(records) {
    console.log('\n🔧 Gemini 밸런스 패치 제안...');

    const statsSummary = compressDataForLLM(records);

    const messages = [
        {
            role: 'system',
            content: `당신은 게임 밸런스 디자이너입니다. 플레이 데이터를 보고 구체적인 파라미터 패치를 JSON 으로만 제안하세요.

반드시 아래 JSON 형식으로만 응답:
{
  "diagnosis": "한 줄 진단",
  "patches": [
    {"target": "유닛/보스/시스템", "field": "파라미터", "current": 현재값, "suggested": 제안값, "reason": "근거", "impact": "예상 영향"}
  ],
  "priority": "high/medium/low"
}`
        },
        { role: 'user', content: statsSummary }
    ];

    const result = await callLLM(messages, { temperature: 0.3, maxTokens: 1500 });

    if (result) {
        try {
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
    console.log('\n📈 Gemini 전략 자가 개선...');

    const currentStrategy = records.strategy;

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
        { role: 'user', content: compressDataForLLM(records) }
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

    return null;
}

// ── Fallbacks (no API key) ──

function fallbackAnalysis(records) {
    const games = records.games;
    const lines = [];

    lines.push('## 밸런스 진단 (룰 기반 분석)');
    lines.push('');

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

    const avgGoldPerRound = allRounds.reduce((s, r) => s + (r.gold || 0), 0) / allRounds.length;
    lines.push(`### 경제 분석`);
    lines.push(`- 평균 잔여 골드: ${avgGoldPerRound.toFixed(1)}G`);
    lines.push('');

    const synergyCount = {};
    for (const g of games) {
        for (const s of (g.synergies || [])) {
            synergyCount[s] = (synergyCount[s] || 0) + 1;
        }
    }
    lines.push('### 시너지 활성 빈도');
    if (Object.keys(synergyCount).length === 0) {
        lines.push('- ⚠️ 시너지 활성 없음');
    } else {
        for (const [s, c] of Object.entries(synergyCount).sort((a, b) => b[1] - a[1])) {
            lines.push(`- ${s}: ${c}회`);
        }
    }

    lines.push('');
    lines.push('### 📋 패치 제안');
    if (criticalRounds.some(r => r.round === '2-7' || r.round?.endsWith('-7'))) {
        lines.push('- 보스 HP 하향 필요 (DPS 달성률 < 15%)');
    }

    return lines.join('\n');
}

function fallbackPatches(records) {
    const games = records.games;
    const patches = [];

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
        diagnosis: '룰 기반 분석 (Gemini API 오류 폴백)',
        patches: patches.slice(0, 5),
        priority: patches.length > 3 ? 'high' : 'medium',
    };
}

// ── Inject LLM Analysis into Report ──

export function generateLLMReportSection(analysis, patches) {
    if (!analysis && !patches) return '';

    let html = '<h2>🧠 AI 분석 (Gemini 1.5 Pro)</h2>';

    if (typeof analysis === 'string') {
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

    console.log('🤖 CRD Autobot — Gemini 1.5 Pro 밸런스 분석\n');

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
