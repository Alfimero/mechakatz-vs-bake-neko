@echo off
cd /d "%~dp0"
REM ============================================================
REM El hub AUTODETECTA la red WiFi a la que esta conectada esta PC
REM y genera el QR solo. No necesitas configurar nada al cambiar
REM de venue: solo conecta el host a la WiFi del lugar.
REM
REM Para FORZAR una red manual (p.ej. si el host va por cable),
REM descomenta y edita estas lineas (AUTH: WPA, WEP o NOPASS):
REM   set MECHA_WIFI_SSID=NombreDeLaRed
REM   set MECHA_WIFI_PASS=elpassword
REM   set MECHA_WIFI_AUTH=WPA
REM
REM Para apagar la autodeteccion sin fijar red: set MECHA_WIFI_AUTODETECT=false
REM ============================================================

echo Starting MechaKatz remote hub on port 8765...
node mecha_remote_hub.js
pause
