@echo off
rem ============================================================
rem  Teach Claude the Air France award search steps, one button at a time.
rem  Double-click this file (or its desktop shortcut) to start.
rem ============================================================
cd /d "%~dp0..\.."
echo [1/2] Getting the latest playbook...
git pull --autostash
echo [2/2] Starting Claude Code with Chrome...
claude --chrome "Use the award-teach skill now: I will teach you the Air France Flying Blue award search steps on screen, one button at a time. Fill in award-tracker/playbook/PLAYBOOK.md as we go. Talk to me in Korean."
echo.
echo Finished. You can close this window.
pause
