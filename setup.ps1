param(
    [string]$Path
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  1. 正在安装 npm 依赖包...  " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

npm install asar chalk@4.1.2 fs path child_process readline-sync winreg @electron/fuses

if ($LASTEXITCODE -ne 0) {
    Write-Host "npm 依赖安装失败，请检查网络或 npm 环境！" -ForegroundColor Red
    pause
    exit $LASTEXITCODE
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  2. 配置 Typora 安装路径  " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if ([string]::IsNullOrWhiteSpace($Path)) {
    $Path = Read-Host "请输入 Typora 安装路径或 Typora.exe 的完整路径"
}

$pathInput = $Path.Trim('"', "'", " ").Trim()

if ([string]::IsNullOrWhiteSpace($pathInput)) {
    Write-Host "路径不能为空！" -ForegroundColor Red
    pause
    exit 1
}

$normalizedPath = $pathInput -replace '\\\\', '\' -replace '/', '\'

if (Test-Path $normalizedPath -PathType Leaf) {
    $typoraFolder = Split-Path -Path $normalizedPath -Parent
} else {
    if ($normalizedPath.EndsWith(".exe", [System.StringComparison]::OrdinalIgnoreCase)) {
        $typoraFolder = Split-Path -Path $normalizedPath -Parent
    } else {
        $typoraFolder = $normalizedPath
    }
}

$typoraFolder = $typoraFolder.TrimEnd('\')
$jsEscapedPath = $typoraFolder.Replace('\', '\\')

Write-Host "提取后的目录路径: $typoraFolder" -ForegroundColor Yellow
Write-Host "写入 start.js 的转义路径: $jsEscapedPath" -ForegroundColor Yellow

$startJsPath = Join-Path $PSScriptRoot "start.js"
if (-not (Test-Path $startJsPath)) {
    $startJsPath = "start.js"
}

if (-not (Test-Path $startJsPath)) {
    Write-Host "未能找到 start.js 文件！" -ForegroundColor Red
    pause
    exit 1
}

$lines = Get-Content -Path $startJsPath -Encoding UTF8
$updated = $false

$newLines = foreach ($line in $lines) {
    if ($line -match '^\s*const\s+Typora_Installation_Path\s*=') {
        "const Typora_Installation_Path = `"$jsEscapedPath`";"
        $updated = $true
    } else {
        $line
    }
}

if ($updated) {
    $newLines | Set-Content -Path $startJsPath -Encoding UTF8
    Write-Host "start.js 中的路径已成功更新！" -ForegroundColor Green
} else {
    Write-Host "未在 start.js 中找到 Typora_Installation_Path 的定义行！" -ForegroundColor Yellow
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  3. 正在启动 node start.js...  " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

node start.js
