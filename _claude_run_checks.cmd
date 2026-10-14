@echo off
REM Runs the project checks and writes results to _claude_checks.log (created by Claude; safe to delete).
cd /d "%~dp0"
echo === npm test === > _claude_checks.log
call npm test >> _claude_checks.log 2>&1
echo EXIT npm test: %ERRORLEVEL% >> _claude_checks.log
echo === npm run build === >> _claude_checks.log
call npm run build >> _claude_checks.log 2>&1
echo EXIT npm run build: %ERRORLEVEL% >> _claude_checks.log
echo === npm run lint === >> _claude_checks.log
call npm run lint >> _claude_checks.log 2>&1
echo EXIT npm run lint: %ERRORLEVEL% >> _claude_checks.log
echo === DONE === >> _claude_checks.log
