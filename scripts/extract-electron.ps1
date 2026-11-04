$zip = "$env:LOCALAPPDATA\electron\Cache\electron-v38.8.6-win32-x64.zip"
$dest = "E:\persuanew\Persua2\openperssua\scripts\electron-dev"
if (-not (Test-Path "$dest\electron.exe")) {
    Expand-Archive -Path $zip -DestinationPath $dest -Force
}
Write-Output ("electron.exe: " + (Test-Path "$dest\electron.exe"))
