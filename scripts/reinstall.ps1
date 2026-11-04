Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$dir = "$env:LOCALAPPDATA\Programs\OpenPerssua"

# 1. Mata processos do app (segura arquivos e impede instalação parcial)
Get-Process | Where-Object { $_.Path -like '*OpenPerssua*' } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 2

# 2. Desinstala a versão anterior (NSIS não sobrescreve instalação existente direito)
$uninst = "$dir\Uninstall OpenPerssua.exe"
if (Test-Path $uninst) {
    Start-Process $uninst -ArgumentList '/S' -Wait
    Start-Sleep 3
}

# 3. Instala a nova versão
$setup = 'E:\persuanew\Persua2\openperssua\release\OpenPerssua Setup 0.2.7.exe'
$p = Start-Process $setup -ArgumentList '/S' -PassThru
$p.WaitForExit(180000) | Out-Null
$deadline = (Get-Date).AddSeconds(60)
while (-not (Test-Path "$dir\OpenPerssua.exe") -and (Get-Date) -lt $deadline) { Start-Sleep 2 }
Start-Sleep 3
if (Test-Path "$dir\resources\app\package.json") {
    Write-Output ("versao instalada: " + (Get-Content "$dir\resources\app\package.json" | Select-String '"version"').Line.Trim())
    Get-ChildItem "$dir\resources\app\dist\assets" | ForEach-Object { Write-Output ("asset: " + $_.Name) }
} else {
    Write-Output "FALHOU: instalacao nao encontrada"
}
