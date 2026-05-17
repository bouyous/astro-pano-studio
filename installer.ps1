$ErrorActionPreference = "Stop"

$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$exeLauncher = Join-Path $project "AstroPanoStudio.exe"
$cmdLauncher = Join-Path $project "Astro Pano Studio.cmd"
$launcher = if (Test-Path $exeLauncher) { $exeLauncher } else { $cmdLauncher }
$desktop = [Environment]::GetFolderPath("Desktop")
$startMenu = Join-Path ([Environment]::GetFolderPath("Programs")) "Astro Pano Studio"
$shortcutTargets = @(
  Join-Path $desktop "Astro Pano Studio.lnk",
  Join-Path $startMenu "Astro Pano Studio.lnk"
)

if (!(Test-Path $launcher)) {
  throw "Lanceur introuvable: $launcher"
}

if (!(Test-Path $startMenu)) {
  New-Item -ItemType Directory -Path $startMenu | Out-Null
}

$shell = New-Object -ComObject WScript.Shell
foreach ($target in $shortcutTargets) {
  $shortcut = $shell.CreateShortcut($target)
  $shortcut.TargetPath = $launcher
  $shortcut.WorkingDirectory = $project
  $shortcut.Description = "Astro Pano Studio"
  $shortcut.Save()
}

Write-Host "Installation terminee."
Write-Host "Raccourci bureau: $($shortcutTargets[0])"
Write-Host "Menu demarrer: $($shortcutTargets[1])"
