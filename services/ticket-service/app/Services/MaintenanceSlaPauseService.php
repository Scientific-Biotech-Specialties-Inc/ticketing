<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Pauses every open ticket's SLA clock while the system is Under Maintenance and resumes it
 * when maintenance ends. Reuses SLAService::pauseClock()/resumeClock(), so resumed tickets get
 * their due dates pushed forward by the time spent in maintenance, exactly like an On Hold pause.
 *
 * Only tickets this service paused carry sla_paused_by_maintenance, so tickets that were already
 * On Hold keep their own pause untouched.
 */
class MaintenanceSlaPauseService
{
    /** Ticket statuses whose SLA clock no longer runs. */
    private const FINISHED_STATUSES = ['closed', 'resolved', 'discarded', 'cancelled'];

    public function __construct(private SLAService $slaService)
    {
    }

    /**
     * Live system status from configuration-service, uncached. Returns null when the status
     * cannot be read, so callers never pause or resume on a guess.
     */
    public function fetchSystemStatus(): ?string
    {
        try {
            $configUrl = env('CONFIGURATION_SERVICE_URL', 'http://configuration-service:8000');
            $response = Http::timeout(3)->get("{$configUrl}/api/ticket-configurations/system-status");
            if (!$response->successful()) {
                return null;
            }
            $json = $response->json();
            $status = $json['status'] ?? $json['value']['status'] ?? null;

            return is_string($status) ? $status : null;
        } catch (\Throwable $e) {
            Log::warning('MaintenanceSlaPause: could not read system status: ' . $e->getMessage());
            return null;
        }
    }

    public function isUnderMaintenance(?string $status): bool
    {
        return $status !== null && strtolower(trim($status)) === 'under maintenance';
    }

    /**
     * Pause the clock of every open ticket that is not already paused. Idempotent, so tickets
     * created during maintenance are picked up on the next run.
     *
     * @return int number of tickets paused
     */
    public function pauseOpenTickets(): int
    {
        $paused = 0;

        DB::table('tickets as t')
            ->leftJoin('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->whereNull('t.sla_paused_at')
            ->whereNull('t.resolved_at')
            ->whereNull('t.closed_at')
            ->where(function ($q) {
                $q->whereNull('ts.status_name')
                    ->orWhereNotIn(DB::raw('LOWER(ts.status_name)'), self::FINISHED_STATUSES);
            })
            ->select('t.ticket_ID')
            ->chunkById(200, function ($tickets) use (&$paused) {
                foreach ($tickets as $ticket) {
                    $id = (int) $ticket->ticket_ID;
                    if ($this->slaService->pauseClock($id)) {
                        DB::table('tickets')->where('ticket_ID', $id)->update(['sla_paused_by_maintenance' => true]);
                        $paused++;
                    }
                }
            }, 't.ticket_ID', 'ticket_ID');

        return $paused;
    }

    /**
     * Resume every ticket that maintenance paused. A ticket moved to On Hold meanwhile stays
     * paused (its hold owns the clock now); only the maintenance flag is cleared.
     *
     * @return int number of tickets resumed
     */
    public function resumeMaintenancePausedTickets(): int
    {
        $resumed = 0;

        DB::table('tickets as t')
            ->leftJoin('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->where('t.sla_paused_by_maintenance', true)
            ->select('t.ticket_ID', 't.ticket_status_ID', 'ts.status_name')
            ->chunkById(200, function ($tickets) use (&$resumed) {
                foreach ($tickets as $ticket) {
                    $id = (int) $ticket->ticket_ID;
                    $statusName = strtolower(trim((string) ($ticket->status_name ?? '')));
                    $isOnHold = in_array($statusName, ['on hold', 'on-hold', 'paused'], true)
                        || (int) $ticket->ticket_status_ID === 11;

                    if (!$isOnHold && $this->slaService->resumeClock($id)) {
                        $resumed++;
                    }
                    DB::table('tickets')->where('ticket_ID', $id)->update(['sla_paused_by_maintenance' => false]);
                }
            }, 't.ticket_ID', 'ticket_ID');

        return $resumed;
    }
}
