Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Get-Process -Name OpenPerssua -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 1
Start-Process "$env:LOCALAPPDATA\Programs\OpenPerssua\OpenPerssua.exe"
Start-Sleep 5
$p = Get-Process -Name OpenPerssua -ErrorAction SilentlyContinue | Select-Object -First 1
Write-Output ("app vivo: " + [bool]$p)
