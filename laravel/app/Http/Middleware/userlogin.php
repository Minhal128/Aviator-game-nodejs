<?php

namespace App\Http\Middleware;

use App\Support\PersistentLogin;
use Closure;
use Illuminate\Http\Request;

class userlogin
{
    /**
     * Handle an incoming request.
     *
     * @param  \Illuminate\Http\Request  $request
     * @param  \Closure(\Illuminate\Http\Request): (\Illuminate\Http\Response|\Illuminate\Http\RedirectResponse)  $next
     * @return \Illuminate\Http\Response|\Illuminate\Http\RedirectResponse
     */
    public function handle(Request $request, Closure $next)
    {
        if ($request->session()->has('userlogin')) {
            return $next($request);
        }

        $user = PersistentLogin::userFrom($request);
        if ($user) {
            $request->session()->regenerate();
            $request->session()->put('userlogin', $user);

            return $next($request);
        }

        return redirect('/')->withCookie(PersistentLogin::forgetCookie());
    }
}
