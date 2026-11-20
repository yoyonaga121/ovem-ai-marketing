# OVEM B3 演示一键启动（Windows / PowerShell 7）
# 用法：在项目根目录执行  .\tools\demo-start.ps1
# 说明：只负责启动本地 fake Ark + Node 服务；不修改数据库、不发布。
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

function Test-Port($port) {
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  return [bool]$conn
}

function Start-LocalNode($name, $nodeArgs, $outLog, $errLog) {
  $p = Start-Process -FilePath "node" -ArgumentList $nodeArgs -WorkingDirectory $Root `
    -RedirectStandardOutput (Join-Path $Root $outLog) `
    -RedirectStandardError (Join-Path $Root $errLog) -PassThru
  Write-Host ("[start] {0} - PID {1}" -f $name, $p.Id) -ForegroundColor Cyan
  return $p
}

Write-Host "OVEM B3 demo - local fake Ark + Node" -ForegroundColor Green

if (-not (Test-Port 4399)) {
  Start-LocalNode "fake Ark" "tools/fake-ark.js" "fakeark.log" "fakeark.err" | Out-Null
  Start-Sleep -Milliseconds 700
} else {
  Write-Host "[reuse] fake Ark already on 4399" -ForegroundColor DarkGray
}

if (-not (Test-Port 4318)) {
  Start-LocalNode "Node server" "server/server.js" "server.log" "server.err" | Out-Null
  Start-Sleep -Seconds 2
} else {
  Write-Host "[reuse] Node server already on 4318" -ForegroundColor DarkGray
}

try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:4318/api/health" -TimeoutSec 5
  Write-Host ("[ok] {0} - live={1}" -f $health.version, $health.live) -ForegroundColor Green
} catch {
  Write-Host "[warn] health 未就绪，请看 server.err" -ForegroundColor Yellow
}

Write-Host "Open: http://127.0.0.1:4318/login.html" -ForegroundColor Cyan
Write-Host "Demo: docs/v3/B3_demo_script.md" -ForegroundColor Cyan
