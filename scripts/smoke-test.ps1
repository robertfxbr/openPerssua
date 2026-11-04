Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$p = Start-Process 'E:\persuanew\Persua2\openperssua\release\win-unpacked\OpenPerssua.exe' -PassThru
Start-Sleep 12
$alive = -not $p.HasExited
Write-Output "alive=$alive"
if ($alive) {
    Stop-Process -Id $p.Id -Force
    Write-Output "processo encerrado apos teste"
}
$logDir = "$env:APPDATA\openperssua\logs"
if (Test-Path $logDir) { Get-ChildItem $logDir | ForEach-Object { Write-Output "LOG: $($_.FullName)"; Get-Content $_.FullName -Tail 15 } }
Write-Output "teste concluido"
