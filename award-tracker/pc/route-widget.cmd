@echo off
rem Air France award seat search - route widget (pick route and months)
cd /d "%~dp0..\.."
start "" pythonw "%~dp0route_widget.pyw"
