<?php

namespace App\Http\Middleware;

use Illuminate\Foundation\Http\Middleware\VerifyCsrfToken as Middleware;

class VerifyCsrfToken extends Middleware
{
    /**
     * The URIs that should be excluded from CSRF verification.
     *
     * @var array<int, string>
     */
    protected $except = [
        'game/server/tick',
        // Glamour Spins posts from inside the C3 runtime, it has no CSRF token
        'game/slot-api',
        // Ludo client → Laravel proxy → ludo-api (Bearer JWT, no Laravel form CSRF)
        'api/v1/*',
    ];
}
