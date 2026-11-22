<?php

namespace App\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * TS -> PRS status callback.
 *
 * When a ticket PRS raised changes state, we push the new state to PRS so it can update its own
 * equipment record without polling. Authenticated with PRS's own secret (services.prs.callback_secret)
 * sent as X-Internal-Secret — not the secret that guards our inbound /internal/prs routes.
 *
 * Every call returns ['ok' => bool, 'status' => int, 'body' => array]; status 0 means PRS could not
 * be reached (not configured, timeout, DNS, TLS). Callers decide whether to retry; the queued job
 * NotifyPrsTicketStatusChanged does.
 */
class PrsCallbackClient
{
    public function isConfigured(): bool
    {
        return config('services.prs.callback_url') !== ''
            && config('services.prs.callback_secret') !== '';
    }

    /**
     * Push a ticket's current state to PRS. Returns null when the callback is not configured or the
     * ticket did not originate in PRS, so callers can treat "nothing to do" differently from
     * "the call failed".
     *
     * @return array{ok: bool, status: int, body: array<string, mixed>}|null
     */
    public function notifyStatusChange(int $ticketId): ?array
    {
        if (!$this->isConfigured()) {
            return null;
        }

        $payload = $this->payloadFor($ticketId);
        if ($payload === null) {
            return null;
        }

        return $this->send($payload);
    }

    /**
     * The callback body. Null when this ticket was not raised by PRS — PRS has no record to update,
     * and the ledger join is what keeps us from leaking unrelated tickets to them.
     *
     * @return array<string, mixed>|null
     */
    public function payloadFor(int $ticketId): ?array
    {
        $row = DB::table('prs_ticket_requests as r')
            ->join('tickets as t', 't.ticket_ID', '=', 'r.ticket_ID')
            ->leftJoin('ticket_statuses as s', 's.ticket_status_ID', '=', 't.ticket_status_ID')
            ->leftJoin('ticket_priorities as p', 'p.priority_ID', '=', 't.priority_ID')
            ->where('r.ticket_ID', $ticketId)
            ->select(
                'r.prs_request_id',
                'r.prs_equipment_id',
                't.ticket_ID',
                't.ticket_number',
                't.resolved_at',
                't.closed_at',
                't.resolution_due_at',
                't.updated_at',
                's.status_name',
                'p.priority_name'
            )
            ->first();

        if (!$row) {
            return null;
        }

        return [
            'ticket_id' => (int) $row->ticket_ID,
            'ticket_number' => $row->ticket_number,
            'prs_request_id' => $row->prs_request_id,
            'prs_equipment_id' => $row->prs_equipment_id,
            'ticket_status' => $row->status_name,
            'priority' => $row->priority_name,
            'sla_due_at' => $this->iso($row->resolution_due_at),
            'resolved_at' => $this->iso($row->resolved_at),
            'closed_at' => $this->iso($row->closed_at),
            'updated_at' => $this->iso($row->updated_at),
        ];
    }

    /**
     * @param array<string, mixed> $payload
     * @return array{ok: bool, status: int, body: array<string, mixed>}
     */
    protected function send(array $payload): array
    {
        $url = config('services.prs.callback_url') . config('services.prs.callback_path');

        try {
            $response = Http::timeout(max(1, (int) config('services.prs.callback_timeout', 15)))
                ->acceptJson()
                ->withHeaders(['X-Internal-Secret' => (string) config('services.prs.callback_secret')])
                ->post($url, $payload);
        } catch (ConnectionException $e) {
            Log::warning('PrsCallbackClient: PRS unreachable: ' . $e->getMessage(), [
                'ticket_ID' => $payload['ticket_id'] ?? null,
            ]);

            return ['ok' => false, 'status' => 0, 'body' => ['message' => 'PRS could not be reached.']];
        }

        $body = $response->json();

        if (!$response->successful()) {
            Log::warning('PrsCallbackClient: PRS rejected the callback', [
                'ticket_ID' => $payload['ticket_id'] ?? null,
                'status' => $response->status(),
            ]);
        }

        return [
            'ok' => $response->successful(),
            'status' => $response->status(),
            'body' => is_array($body) ? $body : [],
        ];
    }

    protected function iso($value): ?string
    {
        if (empty($value)) {
            return null;
        }

        try {
            return \Illuminate\Support\Carbon::parse($value)->toIso8601String();
        } catch (\Throwable) {
            return null;
        }
    }
}
