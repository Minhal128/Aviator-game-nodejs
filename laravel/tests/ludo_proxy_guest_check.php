<?php
/**
 * Smoke: proxy POST /api/v1/auth/guest must return JSON fast (not hang / 419 / 417).
 * Run: php laravel/tests/ludo_proxy_guest_check.php
 */
declare(strict_types=1);

$ctx = stream_context_create([
    'http' => [
        'method' => 'POST',
        'header' => "Content-Type: application/json\r\nAccept: application/json\r\n",
        'content' => json_encode(['deviceId' => 'tlproxycheck1'], JSON_THROW_ON_ERROR),
        'timeout' => 8,
        'ignore_errors' => true,
    ],
]);
$t0 = microtime(true);
$raw = @file_get_contents('http://127.0.0.1:8000/api/v1/auth/guest', false, $ctx);
$ms = (int) round((microtime(true) - $t0) * 1000);
$headers = $http_response_header ?? [];
$statusLine = $headers[0] ?? '';
if ($raw === false) {
    fwrite(STDERR, "FAIL proxy guest hung/unreachable ({$ms}ms)\n");
    exit(1);
}
if (str_contains($statusLine, '419') || str_contains($statusLine, '417')) {
    fwrite(STDERR, "FAIL $statusLine\n");
    exit(1);
}
$data = json_decode($raw, true);
if (!is_array($data) || empty($data['access'])) {
    fwrite(STDERR, "FAIL body=$raw\n");
    exit(1);
}
echo "OK proxy guest auth {$ms}ms\n";
