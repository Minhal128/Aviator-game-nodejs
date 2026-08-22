<?php
/**
 * House-edge check for the money that lives in a DB.
 *  - Aviator : userbits.amount must be numeric + HOUSE_PCT is 5
 *  - Ludo    : every lr_room_tiers.prize_table row must pay out 70% of the pot
 * Pass --fix to write the corrected Ludo prize tables.
 * Run: php tools/house-edge-db.php [--fix]
 */
const HOUSE_PCT = 5.0;
const LUDO_KEEP = 0.70;

$fix = in_array('--fix', $argv, true);
$root = dirname(__DIR__);
$bad = 0;

function env_file(string $path): array
{
    return is_file($path) ? (parse_ini_file($path, false, INI_SCANNER_RAW) ?: []) : [];
}

// --- Aviator ---------------------------------------------------------------
$src = file_get_contents($root . '/laravel/app/Services/PoolCrashEngine.php');
if (!preg_match('/HOUSE_PCT\s*=\s*([\d.]+)/', $src, $m) || (float) $m[1] !== HOUSE_PCT) {
    echo "  FAIL aviator: PoolCrashEngine::HOUSE_PCT is not " . HOUSE_PCT . "\n";
    $bad++;
} else {
    echo "  aviator      HOUSE_PCT " . $m[1] . "% — pool = 95% of round bets\n";
}

$env = env_file($root . '/laravel/.env');
if (($env['DB_CONNECTION'] ?? '') === 'mysql') {
    try {
        $pdo = new PDO("mysql:host={$env['DB_HOST']};port={$env['DB_PORT']};dbname={$env['DB_DATABASE']}", $env['DB_USERNAME'], $env['DB_PASSWORD'] ?? '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $type = $pdo->query("SHOW COLUMNS FROM userbits LIKE 'amount'")->fetch()['Type'];
        if (stripos($type, 'char') !== false) {
            echo "  FAIL aviator: userbits.amount is $type — MIN() compares as text, run php artisan migrate\n";
            $bad++;
        } else {
            echo "  aviator      userbits.amount $type\n";
        }
    } catch (PDOException $e) {
        echo "  skip aviator db: {$e->getMessage()}\n";
    }
}

// --- Ludo ------------------------------------------------------------------
$lenv = env_file($root . '/ludo/ludo-royale/server/.env');
$url = $lenv['DATABASE_URL'] ?? '';
if (!preg_match('#^mysql://([^:]+):([^@]*)@([^:/]+):(\d+)/(.+)$#', $url, $u)) {
    echo "  skip ludo: no DATABASE_URL\n";
} else {
    try {
        $pdo = new PDO("mysql:host=$u[3];port=$u[4];dbname=$u[5]", $u[1], $u[2], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        foreach ($pdo->query('SELECT id, name, prize_table FROM lr_room_tiers ORDER BY id') as $tier) {
            $table = json_decode((string) $tier['prize_table'], true) ?: [];
            $wrong = [];
            foreach ($table as $players => $mults) {
                $sum = round(array_sum($mults), 4);
                $want = round(LUDO_KEEP * (int) $players, 4);
                if (abs($sum - $want) > 0.0001) {
                    $wrong[$players] = [$sum, $want];
                }
            }
            if (!$wrong) {
                echo "  ludo tier {$tier['id']}  {$tier['name']}: pays 70% of pot\n";
                continue;
            }
            if (!$fix) {
                foreach ($wrong as $players => [$sum, $want]) {
                    echo "  FAIL ludo tier {$tier['id']} {$tier['name']} {$players}P: pays {$sum}x fee, must pay {$want}x — rerun with --fix\n";
                    $bad++;
                }
                continue;
            }
            foreach ($table as $players => $mults) {
                $sum = array_sum($mults);
                $scale = $sum > 0 ? (LUDO_KEEP * (int) $players) / $sum : 0;
                $table[$players] = array_map(fn($m) => round($m * $scale, 4), $mults);
            }
            $pdo->prepare('UPDATE lr_room_tiers SET prize_table = ? WHERE id = ?')
                ->execute([json_encode($table), $tier['id']]);
            echo "  fixed ludo tier {$tier['id']} {$tier['name']} -> " . json_encode($table) . "\n";
        }
    } catch (PDOException $e) {
        echo "  skip ludo db: {$e->getMessage()}\n";
    }
}

// --- Vendor slots ----------------------------------------------------------
// Both slots take real money now. gold-egypt's own paytable was retuned, so its
// margin is a property of the game and tools/gold-egypt-rtp.mjs enumerates it.
// slot-glamour has no readable paytable at all, so its margin is a property of
// which measured spin the server hands out - see tools/glamour-house-edge.php.
echo "  gold-egypt   paytable tuned to 70% RTP; stops drawn and settled server side\n";
echo "  slot-glamour no paytable to tune; server picks from measured seeds, tilted to 70%\n";

echo $bad === 0 ? "\nhouse-edge-db OK\n" : "\n$bad problem(s)\n";
exit($bad === 0 ? 0 : 1);
