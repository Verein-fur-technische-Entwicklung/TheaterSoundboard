@echo off
setlocal
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
set "diagdir=%LOCALAPPDATA%\TheaterSoundboard-Diagnose"
if /I "%~1"=="/check-only" set "diagdir=%~dp0diagnose-test-output"
if not exist "%diagdir%" mkdir "%diagdir%"
if not exist "%diagdir%" (
  echo Diagnoseordner konnte nicht angelegt werden.
  pause
  exit /b 1
)
>"%diagdir%\Dateipruefung.txt" echo Theater Soundboard - Windows Startdiagnose
>>"%diagdir%\Dateipruefung.txt" ver
set "missing="
for %%F in ("Theater Soundboard.exe" "resources\app.asar" "icudtl.dat" "snapshot_blob.bin" "v8_context_snapshot.bin" "resources.pak" "ffmpeg.dll" "locales\en-US.pak") do (
  if exist "%%~F" (
    >>"%diagdir%\Dateipruefung.txt" echo OK: %%~F
  ) else (
    >>"%diagdir%\Dateipruefung.txt" echo FEHLT: %%~F
    set "missing=1"
  )
)
if /I "%~1"=="/check-only" exit /b 0
echo Bitte zuerst alle Soundboard-Fenster schliessen.
echo Danach eine Taste druecken, um den protokollierten Start auszufuehren.
pause >nul
if defined missing (
  echo Es fehlen Programmdateien. Details stehen in Dateipruefung.txt.
  start "" "%diagdir%"
  pause
  exit /b 1
)
echo Wenn das Fenster leer bleibt: etwa 20 Sekunden warten und es dann schliessen.
start "" /wait "%~dp0Theater Soundboard.exe" --enable-logging=file "--log-file=%diagdir%\chromium-start.log" >"%diagdir%\console.log" 2>&1
set "appExit=%errorlevel%"
>>"%diagdir%\Dateipruefung.txt" echo App-Exitcode: %appExit%
echo Diagnose abgeschlossen. Der Ordner mit den Protokollen wird geoeffnet.
start "" "%diagdir%"
exit /b %appExit%
