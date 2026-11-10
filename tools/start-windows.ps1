$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
function Find-SoundboardWindow {
    $candidates = Get-CimInstance Win32_Process -Filter "Name='Theater Soundboard.exe' OR Name='electron.exe'" |
        Where-Object { $_.CommandLine -notmatch '--inspect|--type=|\.files-test-data|\.smoke-data|\.drag-test-data|smoke\.cjs' }
    foreach ($candidate in $candidates) {
        $process = Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue
        if ($process -and $process.MainWindowHandle -ne 0 -and $process.MainWindowTitle -like '*Soundboard*') { return $process }
    }
}
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SoundboardWindow {
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hwnd, int command);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
}
'@
function Show-Soundboard($process) {
    if ([SoundboardWindow]::IsIconic($process.MainWindowHandle)) {
        [void][SoundboardWindow]::ShowWindowAsync($process.MainWindowHandle, 9)
    }
    [void](New-Object -ComObject WScript.Shell).AppActivate([int]$process.Id)
    [void][SoundboardWindow]::SetForegroundWindow($process.MainWindowHandle)
    Write-Output "Soundboard geoeffnet (PID $($process.Id))."
}
try {
    $running = Find-SoundboardWindow
    if ($running) { Show-Soundboard $running; exit 0 }
    $portable = Get-ChildItem -LiteralPath (Join-Path $projectRoot 'releases') -Filter 'Theater Soundboard *.exe' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $unpacked = Join-Path $projectRoot 'releases\win-unpacked\Theater Soundboard.exe'
    $electron = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
    if ($portable) { Start-Process -FilePath $portable.FullName -ArgumentList '--disable-gpu' -WorkingDirectory $projectRoot }
    elseif (Test-Path -LiteralPath $unpacked) { Start-Process -FilePath $unpacked -ArgumentList '--disable-gpu' -WorkingDirectory $projectRoot }
    elseif (Test-Path -LiteralPath $electron) { Start-Process -FilePath $electron -ArgumentList ('"' + $projectRoot + '"'), '--disable-gpu' -WorkingDirectory $projectRoot }
    else { throw 'Keine Windows-App gefunden. Die EXE aus GitHub Releases in releases ablegen.' }
    for ($attempt = 0; $attempt -lt 100; $attempt++) {
        Start-Sleep -Milliseconds 250
        $running = Find-SoundboardWindow
        if ($running) { Show-Soundboard $running; exit 0 }
    }
    throw 'Innerhalb von 25 Sekunden wurde kein Soundboard-Fenster geoeffnet.'
} catch {
    $logDirectory = Join-Path $projectRoot 'logs'
    New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
    $_ | Out-String | Set-Content -LiteralPath (Join-Path $logDirectory 'windows-start-error.txt') -Encoding UTF8
    Write-Host ('Start fehlgeschlagen: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'Details stehen unter logs\windows-start-error.txt.'
    exit 1
}
