param(
  [ValidateSet("prod", "dev")]
  [string]$Mode = "prod",
  [switch]$Build,
  [switch]$SkipDaemonCheck,
  [int]$ServerPort = 3000,
  [int]$WebPort = 5173,
  [string]$ServerUrl = "",
  [string]$DaemonUrl = "",
  [string]$McpBridgeBin = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$serverEntry = Join-Path $repoRoot "packages\server\dist\index.js"
$webDistDir = Join-Path $repoRoot "packages\web\dist"
$defaultMcpBridge = Join-Path $repoRoot "packages\paseo-client\dist\mcp-bridge\index.js"

if ([string]::IsNullOrWhiteSpace($DaemonUrl)) {
  if (-not [string]::IsNullOrWhiteSpace($env:PASEO_DAEMON_URL)) {
    $DaemonUrl = $env:PASEO_DAEMON_URL
  } else {
    $DaemonUrl = "ws://127.0.0.1:6767/ws"
  }
}

if ([string]::IsNullOrWhiteSpace($McpBridgeBin)) {
  if (-not [string]::IsNullOrWhiteSpace($env:CREWDEN_MCP_BRIDGE_BIN)) {
    $McpBridgeBin = $env:CREWDEN_MCP_BRIDGE_BIN
  } else {
    $McpBridgeBin = $defaultMcpBridge
  }
}

if ([string]::IsNullOrWhiteSpace($ServerUrl)) {
  if (-not [string]::IsNullOrWhiteSpace($env:CREWDEN_SERVER_URL)) {
    $ServerUrl = $env:CREWDEN_SERVER_URL
  } else {
    $ServerUrl = "http://127.0.0.1:$ServerPort"
  }
}

function Write-Info([string]$text) { Write-Host "[crewden] $text" -ForegroundColor Cyan }
function Write-WarnText([string]$text) { Write-Host "[crewden] $text" -ForegroundColor Yellow }
function Write-Ok([string]$text) { Write-Host "[crewden] $text" -ForegroundColor Green }

function Ensure-Command([string]$name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $name"
  }
}

function Invoke-Step([string]$title, [scriptblock]$action) {
  Write-Info $title
  & $action
}

function Wait-HttpReady([string]$url, [int]$timeoutSeconds = 30) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $null = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
      return
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  throw "Timeout waiting for $url"
}

function Test-TcpEndpoint([string]$url, [int]$timeoutMs = 1200) {
  try {
    $uri = [Uri]$url
    $port =
      if ($uri.Port -gt 0) { $uri.Port }
      elseif ($uri.Scheme -eq "wss") { 443 }
      else { 80 }
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
      $async = $client.BeginConnect($uri.Host, $port, $null, $null)
      if (-not $async.AsyncWaitHandle.WaitOne($timeoutMs, $false)) {
        return $false
      }
      $client.EndConnect($async) | Out-Null
      return $true
    } finally {
      $client.Dispose()
    }
  } catch {
    return $false
  }
}

Ensure-Command "node"
Ensure-Command "pnpm"

$env:PASEO_DAEMON_URL = $DaemonUrl
$env:CREWDEN_MCP_BRIDGE_BIN = $McpBridgeBin
$env:CREWDEN_SERVER_URL = $ServerUrl
$env:PORT = "$ServerPort"

if (-not $SkipDaemonCheck) {
  if (Test-TcpEndpoint $DaemonUrl) {
    Write-Ok "Paseo daemon reachable at $DaemonUrl"
  } else {
    Write-WarnText "Paseo daemon not reachable at $DaemonUrl (agents will not run until daemon is up)"
  }
}

if ($Build) {
  Invoke-Step "Installing dependencies (pnpm install)" { pnpm install }
  if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }

  Invoke-Step "Building server" { pnpm --filter @crewden/server build }
  if ($LASTEXITCODE -ne 0) { throw "server build failed" }

  Invoke-Step "Building MCP bridge" { pnpm --filter @crewden/paseo-client build }
  if ($LASTEXITCODE -ne 0) { throw "paseo-client build failed" }

  $env:VITE_API_BASE = $ServerUrl
  Invoke-Step "Building web with VITE_API_BASE=$ServerUrl" { pnpm --filter @crewden/web build }
  if ($LASTEXITCODE -ne 0) { throw "web build failed" }
}

if (-not (Test-Path $McpBridgeBin)) {
  throw "MCP bridge binary not found: $McpBridgeBin. Build it with: pnpm --filter @crewden/paseo-client build"
}

if ($Mode -eq "prod") {
  if (-not (Test-Path $serverEntry)) {
    throw "Server dist not found: $serverEntry. Run this script with -Build or build server first."
  }
  if (-not (Test-Path $webDistDir)) {
    throw "Web dist not found: $webDistDir. Run this script with -Build or build web first."
  }
}

$serverProcess = $null
$webProcess = $null

try {
  if ($Mode -eq "prod") {
    Write-Info "Starting server (prod)"
    $serverProcess = Start-Process -FilePath "node" -ArgumentList @($serverEntry) -WorkingDirectory $repoRoot -PassThru

    Wait-HttpReady "$ServerUrl/api/channels" 30

    Write-Info "Starting web preview (prod)"
    $webCmd = "pnpm --filter @crewden/web exec vite preview --host 0.0.0.0 --port $WebPort --strictPort"
    $webProcess = Start-Process -FilePath "cmd.exe" -ArgumentList @("/d", "/c", $webCmd) -WorkingDirectory $repoRoot -PassThru
  } else {
    Write-Info "Starting server (dev)"
    $serverCmd = "pnpm --filter @crewden/server dev"
    $serverProcess = Start-Process -FilePath "cmd.exe" -ArgumentList @("/d", "/c", $serverCmd) -WorkingDirectory $repoRoot -PassThru

    Wait-HttpReady "$ServerUrl/api/channels" 30

    Write-Info "Starting web dev server"
    $webCmd = "pnpm --filter @crewden/web dev --host 0.0.0.0 --port $WebPort --strictPort"
    $webProcess = Start-Process -FilePath "cmd.exe" -ArgumentList @("/d", "/c", $webCmd) -WorkingDirectory $repoRoot -PassThru
  }

  Write-Ok "Crewden is up"
  Write-Host "  Server: $ServerUrl" -ForegroundColor Green
  Write-Host "  Web:    http://127.0.0.1:$WebPort" -ForegroundColor Green
  Write-Host "  Mode:   $Mode" -ForegroundColor Green
  Write-Host "Press Ctrl+C to stop both processes."

  Wait-Process -Id $serverProcess.Id, $webProcess.Id
} finally {
  foreach ($proc in @($webProcess, $serverProcess)) {
    if ($null -ne $proc) {
      try {
        if (-not $proc.HasExited) {
          Stop-Process -Id $proc.Id -Force
        }
      } catch {
      }
    }
  }
}
