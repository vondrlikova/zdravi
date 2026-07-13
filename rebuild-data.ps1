# Regeneruje data-bundle.js ze souborů v adresáři data/
# Spusť pravým tlačítkem → "Spustit pomocí PowerShellu" (nebo v terminálu: powershell -File rebuild-data.ps1)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$foods     = Get-Content -Path "data\foods.json"         -Raw -Encoding UTF8
$herbs     = Get-Content -Path "data\herbs.json"         -Raw -Encoding UTF8
$profile   = Get-Content -Path "data\profile-seed.json"  -Raw -Encoding UTF8
$timeline  = Get-Content -Path "data\timeline-seed.json" -Raw -Encoding UTF8
$shortcuts = Get-Content -Path "data\shortcuts.json"     -Raw -Encoding UTF8

$bundle = @"
// Auto-generated data bundle - combines all data/*.json into globals
// so the app works when opened directly from file:// (no server needed)
window.__APP_DATA__ = {
  foods: $foods,
  herbs: $herbs,
  profile: $profile,
  timeline: $timeline,
  shortcuts: $shortcuts
};
"@

$bundle | Out-File -FilePath "data-bundle.js" -Encoding utf8
Write-Host "data-bundle.js byl regenerovan." -ForegroundColor Green
