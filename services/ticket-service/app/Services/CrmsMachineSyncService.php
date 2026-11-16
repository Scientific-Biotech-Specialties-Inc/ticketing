<?php

namespace App\Services;

use App\Exceptions\CustomerProvisioningException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Registers a customer's machine pushed from the CRMS (customer relationship management system).
 *
 * One record carries: machine name, brand, serial number, customer name, customer email, SBSI branch.
 *
 * - The customer account is owned by customer-service, so it is found or created through its
 *   internal customers/provision endpoint (REST only, no access to its tables). A new customer
 *   receives the usual welcome email with a temporary password from customer-service.
 * - The machine is upserted by serial number. The CRMS is the source of truth, so a known serial
 *   takes the incoming name, brand, owner and branch.
 */
class CrmsMachineSyncService
{
    public const DEFAULT_CATEGORY = 'Uncategorized';

    /** Normalized legacy branch name => normalized current name ("Main Office" is now "SBSI Makati Branch"). */
    private const LEGACY_BRANCH_NAMES = [
        'mainoffice' => 'makati',
        'northluzonhub' => 'isabela',
        'cebucityoffice' => 'cebu',
    ];

    /**
     * Shared by the CRMS push (POST /internal/crms/machines) and the CMS pull (cms:sync, spec 3.1).
     *
     * @param  array{machine_name:string, brand:?string, serial_number:string, customer_name:string, customer_email:string, branch?:string, customer_contact_number?:?string, customer_address?:?string}  $record
     * @param  object|null  $branch  resolved SBSI branch; null leaves the machine without a branch
     * @param  array<string, mixed>  $extra  more machines columns to write (CMS keys, model, contract data)
     * @param  string|null  $equipmentUid  CMS equipment_uid, matched before serial_number when given
     * @return array{status:string, machine_ID:int, client_ID:int, customer_status:string, branch_id:?string, serial_number:string}
     *
     * @throws CustomerProvisioningException when customer-service cannot provision the customer
     */
    public function sync(array $record, ?object $branch, array $extra = [], ?string $equipmentUid = null): array
    {
        $serial = trim($record['serial_number']);
        [$clientId, $customerStatus] = $this->provisionCustomer(
            trim($record['customer_name']),
            strtolower(trim($record['customer_email'])),
            array_filter([
                'contact_number' => $record['customer_contact_number'] ?? null,
                'address' => $record['customer_address'] ?? null,
            ], fn ($value) => is_string($value) && trim($value) !== '') + (
                // Only sent when the caller decides; customer-service defaults to sending it.
                array_key_exists('send_welcome_email', $record) ? ['send_welcome_email' => (bool) $record['send_welcome_email']] : []
            )
        );

        $attributes = [
            'machine_name' => trim($record['machine_name']),
            'brand' => isset($record['brand']) && trim((string) $record['brand']) !== '' ? trim($record['brand']) : null,
            'client_ID' => $clientId,
            'branch_id' => $branch?->slug,
        ] + $extra;

        if ($equipmentUid !== null) {
            $attributes['equipment_uid'] = $equipmentUid;
        }

        [$status, $machineId] = DB::transaction(function () use ($serial, $attributes, $equipmentUid) {
            $existing = $equipmentUid !== null
                ? DB::table('machines')->where('equipment_uid', $equipmentUid)->lockForUpdate()->first()
                : null;

            if ($existing) {
                // The CMS is the source of truth: a corrected serial on a known contract follows it.
                $attributes['serial_number'] = $serial;
            } else {
                $existing = DB::table('machines')->where('serial_number', $serial)->lockForUpdate()->first();
            }

            if (!$existing) {
                $id = DB::table('machines')->insertGetId($attributes + [
                    'serial_number' => $serial,
                    'category_ID' => $this->defaultCategoryId(),
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                return ['created', (int) $id];
            }

            $changed = array_filter(
                $attributes,
                fn ($value, $key) => (string) ($existing->{$key} ?? '') !== (string) ($value ?? ''),
                ARRAY_FILTER_USE_BOTH
            );

            if ($changed === []) {
                return ['unchanged', (int) $existing->machine_ID];
            }

            if (array_key_exists('client_ID', $changed)) {
                Log::info('CRMS sync moved a machine to another customer', [
                    'machine_ID' => $existing->machine_ID,
                    'from_client_ID' => $existing->client_ID,
                    'to_client_ID' => $attributes['client_ID'],
                ]);
            }

            DB::table('machines')->where('machine_ID', $existing->machine_ID)
                ->update($changed + ['updated_at' => now()]);

            return ['updated', (int) $existing->machine_ID];
        });

        return [
            'status' => $status,
            'machine_ID' => $machineId,
            'client_ID' => $clientId,
            'customer_status' => $customerStatus,
            'branch_id' => $branch?->slug,
            'serial_number' => $serial,
        ];
    }

    /**
     * Matches a CRMS branch value against ticket-service's branches by slug, code or name.
     * "SBSI Makati Branch", "Makati", "MKT" and "sbsi-makati-branch" all find the Makati branch.
     */
    public function resolveBranch(string $value): ?object
    {
        $needle = $this->normalizeBranch($value);
        if ($needle === '') {
            return null;
        }
        // The CMS still uses pre-rename branch names (see 2026_11_12_000001_seed_sbsi_branches).
        $needle = self::LEGACY_BRANCH_NAMES[$needle] ?? $needle;

        $branches = DB::table('branches')->orderByDesc('is_active')->orderBy('id')->get(['id', 'slug', 'name', 'code', 'is_active']);

        foreach ($branches as $branch) {
            $candidates = [
                strtolower((string) $branch->slug),
                strtolower((string) $branch->code),
                $this->normalizeBranch((string) $branch->name),
                $this->normalizeBranch((string) $branch->slug),
            ];
            if (in_array(strtolower(trim($value)), $candidates, true) || in_array($needle, $candidates, true)) {
                return $branch;
            }
        }

        return null;
    }

    private function normalizeBranch(string $value): string
    {
        $value = strtolower(trim($value));
        $value = preg_replace('/\b(sbsi|branch)\b/', ' ', $value);

        return preg_replace('/[^a-z0-9]+/', '', (string) $value);
    }

    /**
     * @return array{0:int, 1:string} client id and "created" or "exists"
     */
    private function provisionCustomer(string $name, string $email, array $contact = []): array
    {
        $base = rtrim((string) config('services.customer.url'), '/');

        try {
            $response = Http::acceptJson()
                ->timeout((int) config('services.customer.timeout', 10))
                ->withHeaders(['X-Internal-Secret' => (string) config('services.internal.secret', '')])
                ->post($base . '/api/customers/provision', [
                    'client_name' => $name,
                    'email' => $email,
                ] + $contact);
        } catch (\Throwable $e) {
            Log::error('CRMS sync: customer-service unreachable', ['error' => $e->getMessage()]);
            throw new CustomerProvisioningException('Customer service is unreachable.');
        }

        $id = (int) $response->json('id', 0);
        if (!$response->successful() || $id <= 0) {
            Log::error('CRMS sync: customer provisioning failed', [
                'status' => $response->status(),
                'body' => mb_substr($response->body(), 0, 500),
            ]);
            throw new CustomerProvisioningException('Customer provisioning failed.', $response->status());
        }

        return [$id, (string) $response->json('status', 'exists')];
    }

    private function defaultCategoryId(): int
    {
        $id = DB::table('machine_categories')->where('category_name', self::DEFAULT_CATEGORY)->value('category_ID');
        if ($id) {
            return (int) $id;
        }

        return (int) DB::table('machine_categories')->insertGetId([
            'category_name' => self::DEFAULT_CATEGORY,
            'description' => 'Machines registered from the CRMS without a category.',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
