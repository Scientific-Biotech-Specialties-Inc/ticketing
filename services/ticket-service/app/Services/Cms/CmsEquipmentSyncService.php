<?php

namespace App\Services\Cms;

use App\Exceptions\CustomerProvisioningException;
use App\Services\CrmsMachineSyncService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Spec 3.1: pulls customers' equipment from the CMS (source of truth) into ticket-service machines.
 *
 * - Upserts on equipment_uid, falling back to serial_number (links machines the CRMS push created).
 * - Customers are found or created through customer-service (REST); a CMS customer without a valid
 *   email cannot get a portal account, so that row is skipped and counted, never half written.
 * - Incremental by default (updated_since cursor). A full run also marks machines the CMS no longer
 *   lists as cms_contract_active = false; machines are never deleted (tickets reference them).
 * - When the CMS is unreachable nothing local changes; the failure is recorded for the UI banner.
 */
class CmsEquipmentSyncService
{
    public const STATUS_KEY = 'cms_ts:status';
    public const CURSOR_KEY = 'cms_ts:cursor';
    private const LOCK_KEY = 'cms_ts:sync-lock';

    /** CMS lifecycle values that mean the contract no longer covers the machine. */
    private const INACTIVE_LIFECYCLES = ['expired', 'inactive', 'terminated', 'cancelled', 'canceled'];

    public function __construct(private CmsTsClient $client, private CrmsMachineSyncService $machines)
    {
    }

    /**
     * @return array{outcome:string, mode?:string, message?:string, summary?:array<string, mixed>}
     *         outcome: synced, partial (page limit hit), failed, not_configured or busy
     */
    public function run(bool $full = false, bool $includePending = false): array
    {
        if (!$this->client->isConfigured()) {
            $this->recordStatus(false, 'not_configured', 'CMS integration is not configured.');

            return ['outcome' => 'not_configured', 'message' => 'CMS integration is not configured.'];
        }

        $lock = Cache::lock(self::LOCK_KEY, 600);
        if (!$lock->get()) {
            return ['outcome' => 'busy', 'message' => 'A CMS sync is already running.'];
        }

        try {
            return $this->runLocked($full, $includePending);
        } finally {
            $lock->release();
        }
    }

    /**
     * Last recorded sync state, safe for any signed in user (no internal error details).
     *
     * @return array{configured:bool, reachable:?bool, reason:?string, message:?string, last_attempt_at:?string, last_success_at:?string, summary:?array}
     */
    public function status(): array
    {
        $stored = Cache::get(self::STATUS_KEY, []);

        return [
            'configured' => $this->client->isConfigured(),
            'reachable' => $stored['reachable'] ?? null,
            'reason' => $stored['reason'] ?? null,
            'message' => $stored['message'] ?? null,
            'last_attempt_at' => $stored['last_attempt_at'] ?? null,
            'last_success_at' => $stored['last_success_at'] ?? null,
            'summary' => $stored['summary'] ?? null,
        ];
    }

    private function runLocked(bool $full, bool $includePending): array
    {
        $cursor = Cache::get(self::CURSOR_KEY);
        $mode = ($full || !$cursor) ? 'full' : 'incremental';

        $query = array_filter([
            'include_pending' => $includePending ? 'true' : null,
            'updated_since' => $mode === 'incremental' ? $cursor : null,
        ]);

        $result = $this->client->fetchSync($query);
        if (!$result->ok) {
            $this->recordStatus(false, $result->reason, $result->message);

            return ['outcome' => 'failed', 'mode' => $mode, 'message' => $result->message];
        }

        $summary = ['received' => count($result->rows), 'created' => 0, 'updated' => 0, 'unchanged' => 0,
            'skipped' => 0, 'failed' => 0, 'deactivated' => 0, 'skipped_reasons' => []];
        $seen = [];
        $newestUpdate = $cursor;

        foreach ($result->rows as $row) {
            [$status, $uid, $reason] = $this->syncRow($row);
            if ($uid !== null) {
                $seen[] = $uid;
            }
            $summary[$status]++;
            if ($status === 'skipped') {
                $summary['skipped_reasons'][$reason] = ($summary['skipped_reasons'][$reason] ?? 0) + 1;
            }

            $updatedAt = $this->isoOrNull($row['updated_at'] ?? ($row['equipment']['updated_at'] ?? null));
            if ($updatedAt !== null && ($newestUpdate === null || strcmp($updatedAt, $newestUpdate) > 0)) {
                $newestUpdate = $updatedAt;
            }
        }

        if ($mode === 'full' && $result->complete) {
            $summary['deactivated'] = $this->deactivateUnlisted($seen);
        }

        // Advance the cursor only after a complete read with no failed rows, so a cut short run or a
        // row customer-service could not provision is read again next time (unchanged rows are no-ops).
        if ($result->complete && $summary['failed'] === 0 && $newestUpdate !== null) {
            Cache::forever(self::CURSOR_KEY, $newestUpdate);
        }

        $this->recordStatus(true, null, null, $summary);
        Log::info('CMS sync finished', ['mode' => $mode] + $summary);

        return ['outcome' => $result->complete ? 'synced' : 'partial', 'mode' => $mode, 'summary' => $summary];
    }

    /**
     * @return array{0:string, 1:?string, 2:?string} status, equipment_uid (when known), skip reason
     */
    private function syncRow(array $row): array
    {
        $equipment = is_array($row['equipment'] ?? null) ? $row['equipment'] : [];
        $customer = is_array($row['customer'] ?? null) ? $row['customer'] : [];

        $uid = $this->clean($row['equipment_uid'] ?? ($equipment['equipment_uid'] ?? null));
        $serial = $this->clean($equipment['serial_number'] ?? null);
        if ($uid === null || $serial === null) {
            return ['skipped', $uid, 'missing_equipment_uid_or_serial'];
        }

        $email = $this->clean($customer['customer_email'] ?? null);
        if ($email === null || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            return ['skipped', $uid, 'no_customer_email'];
        }

        $customerName = $this->clean($customer['customer_name'] ?? null);
        if ($customerName === null) {
            return ['skipped', $uid, 'no_customer_name'];
        }

        $branchName = $this->clean($row['sbsi_branch'] ?? ($equipment['sbsi_branch'] ?? null));
        $branch = $branchName !== null ? $this->machines->resolveBranch($branchName) : null;
        if ($branchName !== null && $branch === null) {
            Log::warning('CMS sync: unknown SBSI branch, machine saved without a branch', ['equipment_uid' => $uid, 'branch' => $branchName]);
        }

        $endDate = $this->dateOrNull($row['end_date'] ?? ($equipment['end_date'] ?? null));

        try {
            $outcome = $this->machines->sync([
                'machine_name' => $this->machineName($equipment, $serial),
                'brand' => $this->limit($this->clean($equipment['brand'] ?? null)),
                'serial_number' => $this->limit($serial),
                'customer_name' => $this->limit($customerName),
                'customer_email' => $email,
                'customer_contact_number' => $this->limit($this->clean($customer['contact_number'] ?? null), 50),
                'customer_address' => $this->limit($this->clean($customer['address'] ?? null), 500),
                // Off by default (CMS_TS_SEND_WELCOME_EMAIL): accounts are created silently and the
                // customer signs in through Forgot Password.
                'send_welcome_email' => (bool) config('services.cms_ts.send_welcome_email', false),
            ], $branch, [
                'model' => $this->limit($this->clean($equipment['model'] ?? null)),
                'cms_customer_uid' => $this->limit($this->clean($row['customer_uid'] ?? ($customer['customer_uid'] ?? null)), 64),
                'contract_code' => $this->limit($this->clean($row['contract_code'] ?? ($equipment['contract_code'] ?? null)), 64),
                'contract_end_date' => $endDate,
                // Integers, not booleans: the upsert compares as strings to detect changes.
                'cms_contract_active' => $this->contractActive($row, $endDate) ? 1 : 0,
            ], $this->limit($uid, 64));
        } catch (CustomerProvisioningException $e) {
            Log::warning('CMS sync: customer provisioning failed', ['equipment_uid' => $uid, 'error' => $e->getMessage()]);

            return ['failed', $uid, null];
        } catch (\Throwable $e) {
            Log::error('CMS sync: could not save machine', ['equipment_uid' => $uid, 'error' => $e->getMessage()]);

            return ['failed', $uid, null];
        }

        return [$outcome['status'], $uid, null];
    }

    /**
     * A full CMS read lists every live contract, so a CMS machine missing from it is no longer covered.
     */
    private function deactivateUnlisted(array $seen): int
    {
        if ($seen === []) {
            // An empty feed is far more likely a CMS fault than every contract ending at once.
            Log::warning('CMS sync: full read returned no equipment, nothing deactivated');

            return 0;
        }

        $affected = 0;
        DB::table('machines')
            ->whereNotNull('equipment_uid')
            ->where(fn ($q) => $q->whereNull('cms_contract_active')->orWhere('cms_contract_active', true))
            ->orderBy('machine_ID')
            ->select(['machine_ID', 'equipment_uid'])
            ->chunkById(500, function ($rows) use ($seen, &$affected) {
                $ids = $rows->reject(fn ($row) => in_array($row->equipment_uid, $seen, true))->pluck('machine_ID')->all();
                if ($ids !== []) {
                    $affected += DB::table('machines')->whereIn('machine_ID', $ids)
                        ->update(['cms_contract_active' => false, 'updated_at' => now()]);
                }
            }, 'machine_ID');

        return $affected;
    }

    private function contractActive(array $row, ?string $endDate): bool
    {
        $approval = strtolower((string) ($row['approval_status'] ?? 'approved'));
        $lifecycle = strtolower((string) ($row['lifecycle_status'] ?? 'active'));

        return $approval === 'approved'
            && !in_array($lifecycle, self::INACTIVE_LIFECYCLES, true)
            && ($endDate === null || $endDate >= now()->toDateString());
    }

    /**
     * CMS leaves equipment_name empty for software products, but customers pick machines by name.
     */
    private function machineName(array $equipment, string $serial): string
    {
        $name = $this->clean($equipment['equipment_name'] ?? null)
            ?? $this->clean(trim(($equipment['brand'] ?? '') . ' ' . ($equipment['model'] ?? '')))
            ?? $this->clean($equipment['item_code'] ?? null)
            ?? $serial;

        return $this->limit($name);
    }

    private function recordStatus(bool $reachable, ?string $reason, ?string $message, ?array $summary = null): void
    {
        $previous = Cache::get(self::STATUS_KEY, []);
        $now = now()->toIso8601String();

        Cache::forever(self::STATUS_KEY, [
            'reachable' => $reachable,
            'reason' => $reason,
            'message' => $message,
            'last_attempt_at' => $now,
            'last_success_at' => $reachable ? $now : ($previous['last_success_at'] ?? null),
            'summary' => $summary ?? ($previous['summary'] ?? null),
        ]);
    }

    private function clean(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }
        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }

    private function limit(?string $value, int $max = 255): ?string
    {
        return $value === null ? null : mb_substr($value, 0, $max);
    }

    private function dateOrNull(mixed $value): ?string
    {
        $value = $this->clean($value);
        if ($value === null) {
            return null;
        }

        try {
            return Carbon::parse($value)->toDateString();
        } catch (\Throwable) {
            return null;
        }
    }

    private function isoOrNull(mixed $value): ?string
    {
        $value = $this->clean($value);
        if ($value === null) {
            return null;
        }

        try {
            return Carbon::parse($value)->utc()->toIso8601String();
        } catch (\Throwable) {
            return null;
        }
    }
}
