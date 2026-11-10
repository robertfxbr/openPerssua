Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$exe = "$env:LOCALAPPDATA\Programs\Teka\Teka.exe"
Get-Process -Name Teka -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 1
$app = Start-Process $exe -PassThru
Start-Sleep 6

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bmp.Size)
$bmp.Save('E:\persuanew\Persua2\openperssua\screenshot-v012.png')
$g.Dispose(); $bmp.Dispose()
Write-Output ("vivo=" + (-not $app.HasExited) + " screenshot ok")
