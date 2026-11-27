<?php

namespace App\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * HTTP client for the SERMS internal reimbursement API (TS -> SERMS).
 *
 * Every call returns ['ok' => bool, 'status' => int, 'body' => array]. status 0 means SERMS
 * could not be reached (not configured, timeout, DNS, TLS); callers map that to a 502.
 */
class SermsClient
{
    public function isConfigured(): bool
    {
        return config('services.serms.url') !== '' && config('services.serms.secret') !== '';
    }

    /**
     * POST /api/internal/ts/reimbursements (multipart).
     *
     * @param array<string, scalar|null> $fields
     * @param UploadedFile[] $receipts
     */
    public function submit(array $fields, array $receipts): array
    {
        if (!$this->isConfigured()) {
            return $this->unreachable('SERMS is not configured.');
        }

        $request = $this->request();
        foreach ($receipts as $file) {
            $request = $request->attach(
                'receipts[]',
                fopen($file->getRealPath(), 'r'),
                $file->getClientOriginalName(),
                ['Content-Type' => $file->getMimeType() ?: 'application/octet-stream']
            );
        }

        $payload = array_filter($fields, fn ($v) => $v !== null && $v !== '');

        return $this->send(fn () => $request->post($this->url('/internal/ts/reimbursements'), $payload));
    }

    /** GET {prefix}/internal/ts/reimbursements/by-ticket/{ticketId} */
    public function statusByTicket(int $ticketId): array
    {
        if (!$this->isConfigured()) {
            return $this->unreachable('SERMS is not configured.');
        }

        return $this->send(fn () => $this->request()->get($this->url("/internal/ts/reimbursements/by-ticket/{$ticketId}")));
    }

    private function request(): PendingRequest
    {
        return Http::timeout(max(1, (int) config('services.serms.timeout', 15)))
            ->acceptJson()
            ->withHeaders(['X-Internal-Secret' => (string) config('services.serms.secret')]);
    }

    private function url(string $path): string
    {
        $prefix = '/' . trim((string) config('services.serms.prefix', '/api'), '/');
        if ($prefix === '/') {
            $prefix = '';
        }

        return config('services.serms.url') . $prefix . '/' . ltrim($path, '/');
    }

    private function send(callable $call): array
    {
        try {
            $response = $call();
        } catch (ConnectionException $e) {
            Log::warning('SERMS unreachable: ' . $e->getMessage());
            return $this->unreachable('SERMS could not be reached. Please try again later.');
        }

        $body = $response->json();

        return [
            'ok' => $response->successful(),
            'status' => $response->status(),
            'body' => is_array($body) ? $body : [],
        ];
    }

    private function unreachable(string $message): array
    {
        return ['ok' => false, 'status' => 0, 'body' => ['message' => $message]];
    }
}
