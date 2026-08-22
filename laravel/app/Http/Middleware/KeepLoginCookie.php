<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

/** Drop Set-Cookie after /api/v1 so a 502 cannot overwrite the lobby login. */
class KeepLoginCookie
{
    public function handle(Request $request, Closure $next)
    {
        $response = $next($request);
        foreach ($response->headers->getCookies() as $cookie) {
            $response->headers->removeCookie($cookie->getName(), $cookie->getPath(), $cookie->getDomain());
        }
        return $response;
    }
}
