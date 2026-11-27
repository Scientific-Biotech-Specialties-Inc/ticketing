<?php

namespace App\Services;

use App\Exceptions\CustomerServiceUnavailableException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * REST calls to customer-service for hospitals and customer accounts.
 *
 * ticket-service never reads or writes the clients or customer_organizations tables itself; it
 * asks customer-service over the internal network with the shared X-Internal-Secret header.
 * Any network error or non 2xx answer becomes CustomerServiceUnavailableException.
 */
class CustomerDirectoryClient
{
    /** @return array<int, array{id:int, name:string, account_count:int}> */
    public function searchOrganizations(string $search, int $limit = 20): array
    {
        return (array) $this->get('/api/internal/organizations', ['search' => $search, 'limit' => $limit])->json('data', []);
    }

    /**
     * The account owning this email and the chosen or typed hospital with its logins.
     *
     * @return array{email_match: ?array, organization: ?array, organization_accounts: array}
     */
    public function lookup(string $email, ?int $organizationId, ?string $organizationName): array
    {
        $query = array_filter([
            'email' => $email,
            'organization_id' => $organizationId,
            'organization_name' => $organizationId ? null : $organizationName,
        ], fn ($v) => $v !== null && $v !== '');

        $body = $this->get('/api/internal/customers/lookup', $query)->json();

        return [
            'email_match' => $body['email_match'] ?? null,
            'organization' => $body['organization'] ?? null,
            'organization_accounts' => $body['organization_accounts'] ?? [],
        ];
    }

    /**
     * Account email and hospital for these client ids, keyed by client id.
     *
     * @param  array<int, int>  $ids
     * @return array<int, array{client_id:int, email:string, client_name:string, organization_id:?int, organization_name:?string}>
     */
    public function accountsByIds(array $ids): array
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', $ids))));
        if ($ids === []) {
            return [];
        }

        $rows = (array) $this->get('/api/internal/customers/by-ids', ['ids' => implode(',', $ids)])->json('data', []);

        $byId = [];
        foreach ($rows as $row) {
            $byId[(int) $row['client_id']] = $row;
        }

        return $byId;
    }

    /**
     * Client ids whose email, account name or hospital matches the search (up to 500).
     *
     * @return array<int, int>
     */
    public function searchClientIds(string $search): array
    {
        $rows = (array) $this->get('/api/internal/customers/by-ids', ['search' => $search])->json('data', []);

        return array_map(fn ($row) => (int) $row['client_id'], $rows);
    }

    /**
     * Create (or find) the customer account through customer-service's normal provisioning path,
     * which sends the welcome email with the temporary password for a new account.
     *
     * @return array{id:int, status:string, organization_id:?int, welcome_email_sent:bool}
     */
    public function provision(string $clientName, string $email, ?int $organizationId): array
    {
        $payload = ['client_name' => $clientName, 'email' => $email];
        if ($organizationId) {
            $payload['organization_id'] = $organizationId;
        }

        $response = $this->send(fn (PendingRequest $http) => $http->post($this->url('/api/customers/provision'), $payload));

        $id = (int) $response->json('id', 0);
        if ($id <= 0) {
            throw new CustomerServiceUnavailableException('Customer provisioning returned no account id.');
        }

        $status = (string) $response->json('status', 'exists');

        return [
            'id' => $id,
            'status' => $status,
            'organization_id' => $response->json('organization_id'),
            'welcome_email_sent' => $status === 'created' && $response->json('welcome_email_sent', true) !== false,
        ];
    }

    private function get(string $path, array $query): Response
    {
        return $this->send(fn (PendingRequest $http) => $http->get($this->url($path), $query));
    }

    private function send(callable $call): Response
    {
        $http = Http::acceptJson()
            ->timeout((int) config('services.customer.timeout', 10))
            ->withHeaders(['X-Internal-Secret' => (string) config('services.internal.secret', '')]);

        try {
            $response = $call($http);
        } catch (\Throwable $e) {
            Log::error('customer-service unreachable', ['error' => $e->getMessage()]);
            throw new CustomerServiceUnavailableException('Customer service is unreachable.', 0, $e);
        }

        if (!$response->successful()) {
            Log::error('customer-service request failed', [
                'status' => $response->status(),
                'body' => mb_substr($response->body(), 0, 500),
            ]);
            throw new CustomerServiceUnavailableException('Customer service request failed.', $response->status());
        }

        return $response;
    }

    private function url(string $path): string
    {
        return rtrim((string) config('services.customer.url'), '/') . $path;
    }
}
