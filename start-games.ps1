# Start Aviator lobby + Chicken Road (PHP) + Ludo API/Game
# Usage: powershell -File start-games.ps1

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ludo = Join-Path $root "ludo\ludo-royale"

Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root'; php -S 127.0.0.1:8000 server.php"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$ludo\server'; npx tsx src/api.entry.ts"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$ludo\server'; npx tsx src/game.entry.ts"

Write-Host "Started:"
Write-Host "  Lobby / Aviator / Chicken: http://127.0.0.1:8000/"
Write-Host "  Ludo (after login):        http://127.0.0.1:8000/ludo/"
Write-Host "  Chicken (after login):     http://127.0.0.1:8000/chicken-road/"
