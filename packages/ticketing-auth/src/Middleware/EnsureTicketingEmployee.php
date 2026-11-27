<?php

namespace Ticketing\Auth\Middleware;

use Closure;
use Illuminate\Http\Request;
use Ticketing\Auth\Access\TicketingAccess;

/**
 * Spec 0045 (AC-12, AC-13): server side requestor guard for work queue routes.
 *
 * Runs after the JWT middleware. A staff member who is not a designated ticketing employee gets
 * 403. Superadmin and admin roles pass. Customers (Client users) are left to the route's own
 * checks, because these routes are staff only already. The flag is read from the database on
 * every request, never from the cached session.
 */
class EnsureTicketingEmployee
{
    public function handle(Request $request, Closure $next)
    {
        $user = $request->user();

        if (!$user || (class_exists('App\Models\Client') && $user instanceof \App\Models\Client)) {
            return $next($request);
        }

        if (TicketingAccess::isAdmin($user)) {
            return $next($request);
        }

        $empId = (int) ($user->emp_id ?? $user->id ?? 0);
        if ($empId > 0 && TicketingAccess::isTicketingEmployee($empId)) {
            return $next($request);
        }

        return response()->json([
            'message' => TicketingAccess::NOT_TICKETING_MESSAGE,
            'code' => 'NOT_TICKETING_EMPLOYEE',
        ], 403);
    }
}
