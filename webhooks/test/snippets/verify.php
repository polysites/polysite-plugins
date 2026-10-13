<?php
// Verifying a Polysite webhook in PHP. $rawBody is the request body exactly as received: file_get_contents('php://input').
function verify_polysite(string $secret, string $rawBody, array $headers, int $tolerance = 300, ?int $now = null): bool {
    $timestamp = $headers['X-Polysite-Timestamp'] ?? null;   // $_SERVER['HTTP_X_POLYSITE_TIMESTAMP'] in plain PHP
    $signature = $headers['X-Polysite-Signature'] ?? null;   // $_SERVER['HTTP_X_POLYSITE_SIGNATURE']
    if (!$timestamp || !$signature) return false;
    if (abs(($now ?? time()) - (int)$timestamp) > $tolerance) return false; // too old (or from the future): a replay
    $expected = 'sha256=' . hash_hmac('sha256', $timestamp . '.' . $rawBody, $secret);
    return hash_equals($expected, $signature);
}

// Self-check used by the plugin's tests: php verify.php <secret> <timestamp> <body> <signature>
if (isset($argv[4])) {
    [, $secret, $ts, $body, $sig] = $argv;
    $h = ['X-Polysite-Timestamp' => $ts, 'X-Polysite-Signature' => $sig];
    echo (verify_polysite($secret, $body, $h, 300, (int)$ts + 5) ? 'ok' : 'fail') . "\n";
    echo (verify_polysite($secret, $body . ' ', $h, 300, (int)$ts + 5) ? 'BAD' : 'tamper-rejected') . "\n";
    echo (verify_polysite($secret, $body, $h, 300, (int)$ts + 3600) ? 'BAD' : 'replay-rejected') . "\n";
}
