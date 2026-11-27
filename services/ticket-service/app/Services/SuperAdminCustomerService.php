<?php

namespace App\Services;

use App\Exceptions\CustomerItemConflictException;
use App\Exceptions\CustomerItemInsertException;
use App\Exceptions\CustomerServiceUnavailableException;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Super Admin Customers page: list customer items and create an item with its account.
 *
 * Writes only the machines table. Accounts and hospitals belong to customer-service and are read
 * or created through CustomerDirectoryClient. This page only inserts machines; it never moves,
 * updates or overwrites an existing one.
 */
class SuperAdminCustomerService
{
    public const TYPE_SERVICE = 'service';
    public const TYPE_SOFTWARE = 'software';

    private const SOFTWARE_SERIAL_ATTEMPTS = 3;

    public function __construct(
        private readonly CustomerDirectoryClient $directory,
        private readonly CrmsMachineSyncService $machineSync,
        private readonly CustomerAssetService $assets,
    ) {
    }

    public function searchOrganizations(string $search, int $limit): array
    {
        return $this->directory->searchOrganizations($search, $limit);
    }

    public function check(string $email, ?int $organizationId, ?string $organizationName): array
    {
        return $this->directory->lookup($this->normalizeEmail($email), $organizationId, $organizationName);
    }

    /**
     * Create one item, plus its account when mode is "new".
     *
     * @param  array  $input  validated request input
     * @return array{item: array, account_status: string, welcome_email_sent: bool}
     *
     * @throws CustomerItemConflictException for email_exists, hospital_has_accounts, serial_taken, attach_mismatch
     * @throws CustomerServiceUnavailableException when customer-service fails
     */
    public function create(array $input, int|string|null $actorId): array
    {
        $isSoftware = $input['asset_type'] === CustomerAssetService::TYPE_SOFTWARE;
        $email = $this->normalizeEmail($input['email']);
        $serial = $isSoftware ? null : trim((string) $input['serial_number']);

        // Refuse a taken serial before any account is created for it.
        if ($serial !== null) {
            $this->assertSerialFree($serial);
        }

        $organizationId = isset($input['organization_id']) ? (int) $input['organization_id'] : null;
        $organizationName = isset($input['organization_name']) ? trim((string) $input['organization_name']) : null;
        $lookup = $this->directory->lookup($email, $organizationId, $organizationName);
        $match = $lookup['email_match'];

        if ($input['mode'] === 'attach') {
            if (!$match || (int) $match['client_id'] !== (int) $input['attach_client_id']) {
                throw new CustomerItemConflictException('attach_mismatch', 'This email no longer belongs to the selected account.', [
                    'account' => $match,
                ]);
            }
            $clientId = (int) $match['client_id'];
            $accountStatus = 'attached';
            $welcomeSent = false;
        } else {
            if ($match) {
                throw $this->emailExists($match);
            }
            if (!empty($lookup['organization_accounts']) && empty($input['confirm_same_hospital'])) {
                throw $this->hospitalHasAccounts($lookup);
            }

            $clientName = $lookup['organization']['name'] ?? $organizationName;
            $provisioned = $this->directory->provision(
                (string) $clientName,
                $email,
                $lookup['organization']['id'] ?? $organizationId
            );

            // Someone created this email between the check and now: send the admin to attach.
            if ($provisioned['status'] !== 'created') {
                $fresh = $this->directory->lookup($email, null, null);
                throw $this->emailExists($fresh['email_match'] ?? ['client_id' => $provisioned['id'], 'email' => $email]);
            }

            $clientId = $provisioned['id'];
            $accountStatus = 'created';
            $welcomeSent = $provisioned['welcome_email_sent'];
        }

        try {
            $machineId = $this->insertMachine($input, $clientId, $isSoftware, $serial);
        } catch (CustomerItemConflictException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::error('superadmin customer item insert failed', [
                'actor_id' => $actorId,
                'client_id' => $clientId,
                'account_status' => $accountStatus,
                'error' => $e->getMessage(),
            ]);
            throw new CustomerItemInsertException($clientId, $accountStatus, $e);
        }

        Log::info('superadmin customer item created', [
            'actor_id' => $actorId,
            'client_id' => $clientId,
            'machine_id' => $machineId,
            'account_status' => $accountStatus,
        ]);

        return [
            'item' => $this->findRow($machineId),
            'account_status' => $accountStatus,
            'welcome_email_sent' => $welcomeSent,
        ];
    }

    /**
     * One page of customer items (one row per machine) with account email and hospital.
     *
     * @return array{data: array, meta: array}
     */
    public function list(array $filters): array
    {
        $page = max(1, (int) ($filters['page'] ?? 1));
        $perPage = min(100, max(1, (int) ($filters['per_page'] ?? 10)));
        $today = $this->today();
        $statusSql = $this->contractStatusSql();

        $query = $this->baseQuery();

        if (!empty($filters['branch_id']) && $filters['branch_id'] !== 'all') {
            $query->where('m.branch_id', $filters['branch_id']);
        }

        if (!empty($filters['type'])) {
            $filters['type'] === self::TYPE_SOFTWARE
                ? $query->where('m.asset_type', CustomerAssetService::TYPE_SOFTWARE)
                : $query->where('m.asset_type', '!=', CustomerAssetService::TYPE_SOFTWARE);
        }

        if (!empty($filters['contract_status'])) {
            $query->whereRaw("({$statusSql}) = ?", [$today, $today, $filters['contract_status']]);
        }

        $directoryAvailable = true;
        $search = trim((string) ($filters['search'] ?? ''));
        if ($search !== '') {
            $clientIds = [];
            try {
                $clientIds = $this->directory->searchClientIds($search);
            } catch (CustomerServiceUnavailableException $e) {
                // Hospital and email search needs customer-service; item name and serial still work.
                $directoryAvailable = false;
            }

            $like = '%' . addcslashes($search, '%_\\') . '%';
            $query->where(function ($q) use ($like, $clientIds) {
                $q->where('m.machine_name', 'like', $like)
                    ->orWhere('m.serial_number', 'like', $like);
                if ($clientIds !== []) {
                    $q->orWhereIn('m.client_ID', $clientIds);
                }
            });
        }

        $total = (clone $query)->count();
        $rows = $query
            ->orderByDesc('m.created_at')
            ->orderByDesc('m.machine_ID')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get();

        $accounts = [];
        try {
            $accounts = $this->directory->accountsByIds($rows->pluck('client_ID')->all());
        } catch (CustomerServiceUnavailableException $e) {
            // Show the rows anyway; the page marks hospital and email as unavailable.
            $directoryAvailable = false;
        }

        return [
            'data' => $rows->map(fn ($row) => $this->present($row, $accounts[(int) $row->client_ID] ?? null))->values()->all(),
            'meta' => [
                'total' => $total,
                'page' => $page,
                'per_page' => $perPage,
                'directory_available' => $directoryAvailable,
            ],
        ];
    }

    private function insertMachine(array $input, int $clientId, bool $isSoftware, ?string $serial): int
    {
        $row = [
            'client_ID' => $clientId,
            'machine_name' => trim((string) $input['item_name']),
            'brand' => isset($input['brand']) && trim((string) $input['brand']) !== '' ? trim((string) $input['brand']) : null,
            'asset_type' => $isSoftware ? CustomerAssetService::TYPE_SOFTWARE : CustomerAssetService::TYPE_EQUIPMENT,
            'category_ID' => $isSoftware ? $this->assets->softwareMachineCategoryId() : $this->machineSync->defaultCategoryId(),
            'branch_id' => $input['branch_id'],
            'status' => 'Active',
            'created_at' => now(),
            'updated_at' => now(),
        ];

        if (!$isSoftware) {
            try {
                return (int) DB::table('machines')->insertGetId($row + ['serial_number' => $serial]);
            } catch (QueryException $e) {
                // Another request registered this serial after the first check.
                if ($this->isUniqueViolation($e)) {
                    $this->assertSerialFree($serial);
                }
                throw $e;
            }
        }

        for ($attempt = 1; ; $attempt++) {
            try {
                return (int) DB::table('machines')->insertGetId($row + ['serial_number' => $this->softwareSerial($clientId)]);
            } catch (QueryException $e) {
                if (!$this->isUniqueViolation($e) || $attempt >= self::SOFTWARE_SERIAL_ATTEMPTS) {
                    throw $e;
                }
            }
        }
    }

    /**
     * SW-<client_ID>-<8 uppercase letters or digits>. The 8 characters are never one of the
     * starter software codes, so these serials cannot collide with seeded starter items.
     */
    private function softwareSerial(int $clientId): string
    {
        $starterCodes = array_map(
            fn ($s) => strtoupper((string) ($s['code'] ?? '')),
            (array) config('assets.seed_software', [])
        );

        do {
            $code = substr(preg_replace('/[^A-Z0-9]/', '', Str::upper(Str::random(16))), 0, 8);
        } while (strlen($code) < 8 || in_array($code, $starterCodes, true));

        return "SW-{$clientId}-{$code}";
    }

    private function assertSerialFree(string $serial): void
    {
        $owner = DB::table('machines')->where('serial_number', $serial)->value('client_ID');
        if ($owner === null) {
            return;
        }

        $hospital = null;
        try {
            $account = $this->directory->accountsByIds([(int) $owner])[(int) $owner] ?? null;
            $hospital = $account['organization_name'] ?? $account['client_name'] ?? null;
        } catch (CustomerServiceUnavailableException $e) {
            // Still refuse the serial; the message just cannot name the hospital.
        }

        $label = $hospital ?? 'another customer';
        throw new CustomerItemConflictException('serial_taken', "Serial {$serial} is already registered to {$label}", [
            'serial_number' => $serial,
            'hospital_name' => $hospital,
        ]);
    }

    private function emailExists(array $match): CustomerItemConflictException
    {
        return new CustomerItemConflictException('email_exists', 'This email already has an account.', ['account' => $match]);
    }

    private function hospitalHasAccounts(array $lookup): CustomerItemConflictException
    {
        $accounts = $lookup['organization_accounts'];

        return new CustomerItemConflictException('hospital_has_accounts', 'This hospital already has ' . count($accounts) . ' account(s).', [
            'organization' => $lookup['organization'],
            'accounts' => $accounts,
        ]);
    }

    private function findRow(int $machineId): array
    {
        $row = $this->baseQuery()->where('m.machine_ID', $machineId)->first();
        $accounts = [];
        try {
            $accounts = $this->directory->accountsByIds([(int) $row->client_ID]);
        } catch (CustomerServiceUnavailableException $e) {
            // The item is saved; only the display fields are missing.
        }

        return $this->present($row, $accounts[(int) $row->client_ID] ?? null);
    }

    private function baseQuery()
    {
        $today = $this->today();

        return DB::table('machines as m')
            ->leftJoin('branches as b', 'b.slug', '=', 'm.branch_id')
            ->select([
                'm.machine_ID', 'm.machine_name', 'm.asset_type', 'm.serial_number', 'm.brand',
                'm.branch_id', 'b.name as branch_name', 'm.client_ID', 'm.contract_code',
                'm.contract_end_date', 'm.created_at',
            ])
            ->selectRaw("({$this->contractStatusSql()}) as contract_status", [$today, $today]);
    }

    /**
     * active: the CMS says active and the end date is not past. expired: the CMS says inactive, or
     * the end date is past. none: no contract data. A row with no CMS flag but a future end date
     * has no stated status either, so it also reads as none.
     */
    private function contractStatusSql(): string
    {
        return "CASE
            WHEN m.cms_contract_active = 1 AND (m.contract_end_date IS NULL OR m.contract_end_date >= ?) THEN 'active'
            WHEN m.cms_contract_active = 0 OR m.contract_end_date < ? THEN 'expired'
            ELSE 'none'
        END";
    }

    private function present(object $row, ?array $account): array
    {
        $isSoftware = $row->asset_type === CustomerAssetService::TYPE_SOFTWARE;

        return [
            'machine_id' => (int) $row->machine_ID,
            'item_name' => $row->machine_name,
            'type' => $isSoftware ? self::TYPE_SOFTWARE : self::TYPE_SERVICE,
            'serial_number' => $isSoftware ? null : $row->serial_number,
            'brand' => $row->brand,
            'branch_id' => $row->branch_id,
            'branch_name' => $row->branch_name,
            'client_id' => (int) $row->client_ID,
            'email' => $account['email'] ?? null,
            'hospital_id' => $account['organization_id'] ?? null,
            'hospital_name' => $account ? ($account['organization_name'] ?? $account['client_name'] ?? null) : null,
            'contract_code' => $row->contract_code,
            'contract_end_date' => $row->contract_end_date ? Carbon::parse($row->contract_end_date)->toDateString() : null,
            'contract_status' => $row->contract_status,
            'created_at' => $row->created_at ? Carbon::parse($row->created_at)->toIso8601String() : null,
        ];
    }

    /** "Today" in the app timezone, used for contract status. */
    private function today(): string
    {
        return Carbon::now(config('app.timezone'))->toDateString();
    }

    private function normalizeEmail(string $email): string
    {
        return mb_strtolower(trim($email));
    }

    private function isUniqueViolation(QueryException $e): bool
    {
        return in_array((string) $e->getCode(), ['23000', '23505'], true)
            || str_contains(strtolower($e->getMessage()), 'unique');
    }
}
