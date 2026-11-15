<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Allows a request only when it carries the shared service to service secret (spec 0044, AC-8).
 *
 * Used for internal only routes such as customer provisioning, which must never be reachable
 * by a browser. Fails closed: when the server has no secret configured, every request is refused.
 */
class VerifyInternalSecret
{
    public function handle(Request $request, Closure $next): Response
    {
        $expected = (string) config('services.internal.secret', '');

        if ($expected === '') {
            return response()->json(['message' => 'Internal endpoint is not configured.'], 503);
        }

        $provided = (string) $request->header('X-Internal-Secret', '');

        if ($provided === '' || !hash_equals($expected, $provided)) {
            return response()->json(['message' => 'Unauthorized.'], 401);
        }

        return $next($request);
    }
}
