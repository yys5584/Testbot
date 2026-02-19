@echo off
chcp 65001 >nul
echo ============================================
echo  🤖 CRD Autobot — 밸런스 체크 QA 시작
echo ============================================
echo.

cd /d "%~dp0"

echo [1/3] 게임 서버 확인 중...
curl -s http://localhost:5173/ >nul 2>&1
if errorlevel 1 (
    echo ⚠️ 게임 서버가 꺼져있습니다. npm run dev 먼저 실행하세요.
    pause
    exit /b 1
)
echo ✅ 게임 서버 실행 중

echo.
echo [2/3] AI 5판 플레이 + 분석...
node ai-player.mjs
if errorlevel 1 (
    echo ⚠️ AI 플레이 중 오류 발생
)

echo.
echo [3/3] 리포트 열기...
start "" "%~dp0reports\latest.html"

echo.
echo ============================================
echo  ✅ 완료! 리포트가 브라우저에서 열립니다.
echo ============================================
pause
