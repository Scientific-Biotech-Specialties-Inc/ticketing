<?php

namespace App\Jobs;

use App\Services\PrsCallbackClient;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

/**
 * Pushes a PRS-raised ticket's new state to PRS, off the request path.
 *
 * Queued rather than called inline for two reasons: PRS is reached over a port-forwarded tunnel
 * that drops connections, so an inline call would stall a staff member's status change behind a
 * timeout; and a dropped call has to be retried, which a synchronous best-effort call cannot do.
 *
 * A ticket that did not come from PRS makes the client return null, and the job simply ends — the
 * state machine dispatches without having to know a ticket's origin.
 */
class NotifyPrsTicketStatusChanged implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /** Four attempts over roughly ten minutes, which covers a tunnel restart. */
    public int $tries = 4;

    /** @var int[] */
    public array $backoff = [30, 120, 600];

    public function __construct(public readonly int $ticketId) {}

    public function handle(PrsCallbackClient $client): void
    {
        $result = $client->notifyStatusChange($this->ticketId);

        // Not configured, or not a PRS ticket: nothing to deliver, nothing to retry.
        if ($result === null) {
            return;
        }

        if ($result['ok']) {
            return;
        }

        // A 4xx other than 408/429 means PRS rejected the payload itself; retrying sends the same
        // body to the same rejection, so fail permanently and leave it in failed_jobs for review.
        $status = $result['status'];
        if ($status >= 400 && $status < 500 && !in_array($status, [408, 429], true)) {
            Log::error('NotifyPrsTicketStatusChanged: PRS rejected the callback permanently', [
                'ticket_ID' => $this->ticketId,
                'status' => $status,
            ]);
            $this->fail(new \RuntimeException("PRS rejected the status callback with HTTP {$status}."));

            return;
        }

        // Unreachable (0) or 5xx: retry on the backoff schedule.
        throw new \RuntimeException("PRS status callback failed with HTTP {$status}.");
    }

    public function failed(\Throwable $e): void
    {
        Log::error('NotifyPrsTicketStatusChanged: giving up', [
            'ticket_ID' => $this->ticketId,
            'error' => $e->getMessage(),
        ]);
    }
}
