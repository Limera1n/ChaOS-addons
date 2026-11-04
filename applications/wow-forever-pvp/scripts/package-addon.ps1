$ErrorActionPreference = 'Stop'
$applicationRoot = Split-Path -Parent $PSScriptRoot
$addonDirectory = Join-Path $applicationRoot 'wow-addon\ChaOSWorldPvP'
$outputDirectory = Join-Path $applicationRoot 'data'
$metadata = Get-Content -LiteralPath (Join-Path $applicationRoot 'addon.json') -Raw | ConvertFrom-Json
if ($metadata.version -notmatch '^\d+\.\d+\.\d+$') {
    throw 'Invalid add-on version'
}
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$archivePath = Join-Path $outputDirectory ('ChaOSWorldPvP-' + $metadata.version + '.zip')
Compress-Archive -LiteralPath $addonDirectory -DestinationPath $archivePath -Force
Write-Output $archivePath
