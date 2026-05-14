[CmdletBinding()]
param(
  [int]$Port = 5173,
  [int]$RunnerPort = 5174,
  [switch]$Web,
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
  throw "npm bulunamadi. Once Node.js LTS kurulu olmali."
}

if (-not $SkipInstall -and -not (Test-Path (Join-Path $repoRoot "node_modules"))) {
  Write-Host "Bagimliliklar kuruluyor: npm ci"
  & $npm.Source ci
}

$url = "http://127.0.0.1:$Port"
$runnerUrl = "http://127.0.0.1:$RunnerPort"
$runnerToken = ""

if ($Web) {
  $runnerToken = [guid]::NewGuid().ToString("N")
  $env:CTX_LAB_RUNNER_TOKEN = $runnerToken
  $env:VITE_CTX_LAB_RUNNER_TOKEN = $runnerToken
  Write-Host "ctx-lab web hazir: $url"
  Write-Host "ctx-lab calistirici: $runnerUrl (token korumali)"
} else {
  Write-Host "ctx-lab masaustu kabugu baslatilacak."
  Write-Host "Vite dev server: $url"
}

if ($DryRun) {
  & $npm.Source run runner:check
  & $npm.Source run desktop:smoke
  Write-Host "Deneme kontrolu tamamlandi; masaustu smoke gecti."
  exit 0
}

if ($Web) {
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
  exit $LASTEXITCODE
}

$env:CTX_LAB_VITE_PORT = [string]$Port
& $npm.Source run desktop:dev
exit $LASTEXITCODE
