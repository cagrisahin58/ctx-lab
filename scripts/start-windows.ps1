[CmdletBinding()]
param(
  [int]$Port = 5173,
  [int]$RunnerPort = 5174,
  [switch]$NoBrowser,
  [switch]$SkipInstall,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) {
  $npm = Get-Command npm -ErrorAction SilentlyContinue
}
if (-not $npm) {
  throw "npm bulunamadı. Önce Node.js LTS kurulu olmalı."
}

if (-not $SkipInstall -and -not (Test-Path (Join-Path $repoRoot "node_modules"))) {
  Write-Host "Bağımlılıklar kuruluyor: npm ci"
  & $npm.Source ci
}

$url = "http://127.0.0.1:$Port"
Write-Host "ctx-lab hazır: $url"
Write-Host "ctx-lab runner: http://127.0.0.1:$RunnerPort"

if ($DryRun) {
  & $npm.Source run runner:check
  Write-Host "Dry-run tamamlandı; dev server başlatılmadı."
  exit 0
}

$runnerArgs = "/c `"$($npm.Source)`" run runner -- --port $RunnerPort"
Start-Process -FilePath "cmd.exe" -ArgumentList $runnerArgs -WorkingDirectory $repoRoot -WindowStyle Hidden | Out-Null

if (-not $NoBrowser) {
  Start-Job -ScriptBlock {
    param($targetUrl)
    Start-Sleep -Seconds 2
    Start-Process $targetUrl
  } -ArgumentList $url | Out-Null
}

& $npm.Source run dev -- --host 127.0.0.1 --port $Port --strictPort
