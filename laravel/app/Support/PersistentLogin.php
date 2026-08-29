<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Http\Request;

final class PersistentLogin
{
    private const COOKIE_NAME = 'tl_login';
    private const COOKIE_MINUTES = 525600;

    public static function cookieFor(User $user, Request $request)
    {
        return cookie(
            self::COOKIE_NAME,
            self::tokenFor($user),
            self::COOKIE_MINUTES,
            '/',
            config('session.domain'),
            config('session.secure') ?? $request->isSecure(),
            true,
            false,
            config('session.same_site', 'lax')
        );
    }

    public static function forgetCookie()
    {
        return cookie()->forget(self::COOKIE_NAME, '/', config('session.domain'));
    }

    public static function userFrom(Request $request): ?User
    {
        $value = (string) $request->cookie(self::COOKIE_NAME, '');
        if (!preg_match('/^([1-9]\d*)\|([a-f0-9]{64})$/', $value, $parts)) {
            return null;
        }

        $user = User::find((int) $parts[1]);
        if (!$user || !hash_equals(self::signatureFor($user), $parts[2])) {
            return null;
        }

        return $user;
    }

    private static function tokenFor(User $user): string
    {
        return $user->id . '|' . self::signatureFor($user);
    }

    private static function signatureFor(User $user): string
    {
        return hash_hmac(
            'sha256',
            $user->id . '|' . $user->password,
            (string) config('app.key')
        );
    }
}
