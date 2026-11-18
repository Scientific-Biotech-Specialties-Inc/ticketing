<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * Decides which branch a new ticket belongs to.
 *
 * Tickets with no branch only appear under Main Branch, so branch staff never saw customer tickets.
 * Order of precedence (first one that names a real branch wins):
 *   1. A branch sent explicitly with the request.
 *   2. The branch of the selected equipment (machines.branch_id). Equipment synced from the
 *      equipment system will carry its real branch, and from then on this rule takes over.
 *   3. The requesting employee's branch (internal tickets only).
 *   4. The configured default branch (services.tickets.default_branch, SBSI Makati for now).
 *
 * Always returns a branch slug (tickets.branch_id stores slugs) or null when nothing matches.
 */
class TicketBranchResolver
{
    public function resolve(?string $explicitBranch, $machineId, $requesterBranch = null): ?string
    {
        $candidates = [$explicitBranch];

        if (!empty($machineId)) {
            $candidates[] = DB::table('machines')->where('machine_ID', (int) $machineId)->value('branch_id');
        }

        $candidates[] = $requesterBranch;
        $candidates[] = config('services.tickets.default_branch');

        foreach ($candidates as $candidate) {
            $slug = $this->toSlug($candidate);
            if ($slug !== null) {
                return $slug;
            }
        }

        return null;
    }

    /** Accepts a branch id, slug, code or name and returns the branch slug, or null if no such branch. */
    private function toSlug($value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        $raw = trim((string) $value);
        $lower = strtolower($raw);

        $branch = DB::table('branches')
            ->where('slug', $lower)
            ->orWhere('id', ctype_digit($raw) ? (int) $raw : -1)
            ->orWhereRaw('LOWER(code) = ?', [$lower])
            ->orWhereRaw('LOWER(name) = ?', [$lower])
            ->first(['slug']);

        return $branch->slug ?? null;
    }
}
