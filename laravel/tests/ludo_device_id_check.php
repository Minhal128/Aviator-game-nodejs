<?php
/**
 * Smoke: site deviceId `tl1` must pass Ludo room identity guard (min-8 was rejecting it).
 * Run: php laravel/tests/ludo_device_id_check.php
 */
declare(strict_types=1);

$guards = file_get_contents(dirname(__DIR__, 2) . '/ludo/ludo-royale/server/src/rooms/guards.ts');
if ($guards === false || !str_contains($guards, 'SITE_DEVICE_ID_RE') || !str_contains($guards, 'tl\\d{1,18}')) {
    fwrite(STDERR, "FAIL guards.ts missing SITE_DEVICE_ID_RE\n");
    exit(1);
}
$config = file_get_contents(dirname(__DIR__, 2) . '/ludo/ludo-royale/client/src/game/net/config.ts');
if ($config === false || !str_contains($config, ':8107')) {
    fwrite(STDERR, "FAIL client config missing local :8107\n");
    exit(1);
}
$overlay = file_get_contents(dirname(__DIR__, 2) . '/ludo/ludo-royale/client/src/meta/overlay.ts');
if ($overlay === false || str_contains($overlay, 'openDailyPanel') || str_contains($overlay, 'buildEventsRow')) {
    fwrite(STDERR, "FAIL overlay still wires daily/events\n");
    exit(1);
}
echo "OK ludo deviceId + local WS + no daily events\n";
