<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

/**
 * Guard for the PRS facing /internal/prs routes only: the caller must send X-Internal-Secret equal
 * to PRS_INTERNAL_SECRET (services.prs.secret), or X-Internal-Token equal to INTERNAL_TOKEN for a
 * same-cluster caller. Compared with hash_equals; an unset expected value never matches.
 *
 * PRS gets its own secret rather than sharing INTERNAL_SERVICE_SECRET with SERMS so either
 * subsystem can be rotated or revoked without taking the other down, and so an inbound request can
 * be attributed to one subsystem. Other /internal routes keep VerifyInternalToken or
 * VerifySermsInternalAccess, neither of which accepts the PRS secret.
 */
class VerifyPrsInternalAccess
{
    public function handle(Request $request, Closure $next)
    {
        $token = (string) $request->header('X-Internal-Token', '');
        $secret = (string) $request->header('X-Internal-Secret', '');

        $allowed = $this->matches((string) config('services.prs.secret', ''), $secret)
            || $this->matches((string) env('INTERNAL_TOKEN', ''), $token);

        if (!$allowed) {
            return response()->json([
                'status' => 'error',
                'code' => 'UNAUTHORIZED',
                'message' => 'Invalid or missing internal credentials.',
            ], 401);
        }

        return $next($request);
    }

    private function matches(string $expected, string $provided): bool
    {
        return $expected !== '' && $provided !== '' && hash_equals($expected, $provided);
    }
}
