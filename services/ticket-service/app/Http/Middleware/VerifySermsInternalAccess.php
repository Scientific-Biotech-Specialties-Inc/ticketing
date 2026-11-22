<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

/**
 * Guard for the SERMS facing /internal routes only: the caller must send X-Internal-Token equal to
 * INTERNAL_TOKEN, or X-Internal-Secret equal to INTERNAL_SERVICE_SECRET (or the SERMS secret,
 * services.serms.secret). Compared with hash_equals; an unset expected value never matches.
 * Other /internal routes keep using VerifyInternalToken, which does not accept the SERMS secret.
 */
class VerifySermsInternalAccess
{
    public function handle(Request $request, Closure $next)
    {
        $token = (string) $request->header('X-Internal-Token', '');
        $secret = (string) $request->header('X-Internal-Secret', '');

        $allowed = $this->matches((string) env('INTERNAL_TOKEN', ''), $token)
            || $this->matches((string) env('INTERNAL_SERVICE_SECRET', ''), $secret)
            || $this->matches((string) config('services.serms.secret', ''), $secret);

        if (!$allowed) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return $next($request);
    }

    private function matches(string $expected, string $provided): bool
    {
        return $expected !== '' && $provided !== '' && hash_equals($expected, $provided);
    }
}
