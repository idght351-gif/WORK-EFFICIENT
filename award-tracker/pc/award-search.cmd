@echo off
rem ============================================================
rem  Air France award seat search (Claude Code + Claude in Chrome)
rem  Double-click this file (or its desktop shortcut) to start.
rem  It runs only when you click it. Nothing runs on a schedule.
rem ============================================================
cd /d "%~dp0..\.."
echo Before starting: open a Chrome Incognito window (Ctrl+Shift+N) and log in to Air France there.
echo.
echo [1/2] Getting the latest routes and playbook...
git pull --autostash
echo [2/2] Starting Claude Code with Chrome...
claude --chrome "Use the award-search skill now: run the Air France Flying Blue award seat search exactly as written in award-tracker/playbook/PLAYBOOK.md, then finish and publish. Talk to me in Korean."
echo.
echo Finished. You can close this window.
pause
