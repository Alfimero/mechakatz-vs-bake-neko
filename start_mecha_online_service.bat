@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "PYTHON_EXE=py"
set "PYTHON_ARGS=-3.11"
where py >nul 2>&1
if not errorlevel 1 goto :python_selected
set "PYTHON_EXE=python"
set "PYTHON_ARGS="
where python >nul 2>&1
if not errorlevel 1 goto :python_selected
if exist "%LocalAppData%\Programs\Python\Python311\python.exe" set "PYTHON_EXE=%LocalAppData%\Programs\Python\Python311\python.exe"
:python_selected

echo ============================================================
echo  MechaKatz Online Session Orchestrator
echo  Local: http://127.0.0.1:8787
echo ============================================================
echo.
rem Si no se define una URL publica, anuncia la IPv4 de la interfaz con
rem gateway. Esto evita que los QR apunten a 127.0.0.1 (localhost del telefono).
if not defined MECHA_PUBLIC_URL (
  for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$out = ipconfig; foreach ($line in $out) { if ($line -match '((\d{1,3}\.){3}\d{1,3})') { $ip = $Matches[1]; if ($ip -notmatch '^(127|169\.254)\.') { $ip; break } } }"`) do if not defined MECHA_LAN_IP set "MECHA_LAN_IP=%%I"
  if defined MECHA_LAN_IP set "MECHA_PUBLIC_URL=http://!MECHA_LAN_IP!:8787"
)
if defined MECHA_PUBLIC_URL echo Enlaces anunciados: !MECHA_PUBLIC_URL!
echo.
echo Para Internet configura una URL HTTPS publica, secretos persistentes,
echo MECHA_HOST_KEY, MECHA_ALLOW_OPEN_CREATE=false y TURN.
echo.

rem Las salas viven en RAM: mantener exactamente un worker.
"%PYTHON_EXE%" %PYTHON_ARGS% -m uvicorn online_service.app:app --host 0.0.0.0 --port 8787 --workers 1
if errorlevel 1 (
  echo.
  echo ERROR: no se pudo iniciar el servicio online.
  echo Instala dependencias con: "!PYTHON_EXE!" !PYTHON_ARGS! -m pip install -r online_service\requirements.txt
)
pause
endlocal
