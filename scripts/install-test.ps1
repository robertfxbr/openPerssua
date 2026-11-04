Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$installer = 'E:\persuanew\Persua2\openperssua\release\OpenPerssua Setup 0.1.2.exe'
$p = Start-Process $installer -ArgumentList '/S' -PassThru
$p.WaitForExit(120000) | Out-Null
Start-Sleep 3
$installed = "$env:LOCALAPPDATA\Programs\OpenPerssua\OpenPerssua.exe"
if (Test-Path $installed) {
    Write-Output "INSTALADO: $installed"
    $app = Start-Process $installed -PassThru
    Start-Sleep 10
    Write-Output ("app_instalado_vivo=" + (-not $app.HasExited))
    if (-not $app.HasExited) { Stop-Process -Id $app.Id -Force }
} else {
    Write-Output "FALHOU: $installed nao encontrado"
}
