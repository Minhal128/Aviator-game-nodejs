# Verifies the 30% house margin across every game whose math we control.
# Usage: powershell -File check-house-edge.ps1 [-Fix]
param([switch]$Fix)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$fail = 0

Write-Host ""
Write-Host "== Aviator: pool crash engine ==" -ForegroundColor Cyan
php -d zend.assertions=1 -d assert.exception=1 "$root\laravel\tests\pool_crash_check.php"
if ($LASTEXITCODE -ne 0) { $fail++ }

Write-Host ""
Write-Host "== Chicken Road: step ladder RTP ==" -ForegroundColor Cyan
node "$root\tools\house-edge-check.mjs"
if ($LASTEXITCODE -ne 0) { $fail++ }

Write-Host ""
Write-Host "== Chicken Road: server side (RoadGame.php owns the crash lane) ==" -ForegroundColor Cyan
php "$root\tools\road-house-edge.php"
if ($LASTEXITCODE -ne 0) { $fail++ }

Write-Host ""
Write-Host "== Gold of Egypt: exact paytable RTP ==" -ForegroundColor Cyan
node "$root\tools\gold-egypt-rtp.mjs" --check
if ($LASTEXITCODE -ne 0) { $fail++ }

Write-Host ""
Write-Host "== Gold of Egypt: server settles what the enumerator says ==" -ForegroundColor Cyan
php "$root\tools\gold-egypt-server.php"
if ($LASTEXITCODE -ne 0) { $fail++ }

Write-Host ""
Write-Host "== Glamour Spins: the tilt on the measured seeds averages 70% ==" -ForegroundColor Cyan
php "$root\tools\glamour-house-edge.php"
if ($LASTEXITCODE -ne 0) { $fail++ }

# The two browser checks need the dev server and a Chromium; they are the slow
# part of the suite (a couple of minutes) and are skipped without playwright.
if ($env:TL_PLAYWRIGHT -or $env:NODE_PATH) {
    Write-Host ""
    Write-Host "== Glamour Spins: the measured table still replays in the browser ==" -ForegroundColor Cyan
    node "$root\tools\glamour-measure.mjs" --verify
    if ($LASTEXITCODE -ne 0) { $fail++ }

    Write-Host ""
    Write-Host "== Glamour Spins: a real click moves the wallet by what the screen shows ==" -ForegroundColor Cyan
    node "$root\tools\glamour-client.mjs"
    if ($LASTEXITCODE -ne 0) { $fail++ }
} else {
    Write-Host ""
    Write-Host "== Glamour Spins: browser checks skipped (set TL_PLAYWRIGHT to run them) ==" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "== Ludo prize tables + Aviator DB columns ==" -ForegroundColor Cyan
if ($Fix) { php "$root\tools\house-edge-db.php" --fix } else { php "$root\tools\house-edge-db.php" }
if ($LASTEXITCODE -ne 0) { $fail++ }

Write-Host ""
if ($fail -eq 0) {
    Write-Host "ALL HOUSE-EDGE CHECKS PASSED (30% margin)" -ForegroundColor Green
} else {
    Write-Host "$fail check(s) FAILED" -ForegroundColor Red
}
exit $fail
