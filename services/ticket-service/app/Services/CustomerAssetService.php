<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * Spec 0047: a customer's equipment and software ("assets"), stored together in machines.
 *
 * - Pickable items: the customer's own rows whose status is active or empty (AC-1, AC-14).
 * - Seeding: three starter software items per customer, added only when missing (AC-2).
 * - Category rule: equipment means the Service category, software means Software (AC-5).
 */
class CustomerAssetService
{
    public const TYPE_EQUIPMENT = 'equipment';
    public const TYPE_SOFTWARE = 'software';

    /**
     * The customer's pickable items, seeding the starter software first when they have none.
     *
     * @return array<int, array{machine_ID:int, name:string, asset_type:string, serial_number:?string, category_name:string}>
     */
    public function listFor(int $clientId): array
    {
        $this->ensureSeeded($clientId);

        return $this->pickableQuery($clientId)
            ->orderByRaw("CASE WHEN asset_type = 'software' THEN 1 ELSE 0 END")
            ->orderBy('machine_name')
            ->get(['machine_ID', 'machine_name', 'asset_type', 'serial_number'])
            ->map(fn ($row) => $this->present($row))
            ->values()
            ->all();
    }

    /** The customer's pickable item with this id, or null when it is not theirs or not pickable. */
    public function findPickable(int $clientId, int $machineId): ?object
    {
        return $this->pickableQuery($clientId)
            ->where('machine_ID', $machineId)
            ->first(['machine_ID', 'machine_name', 'asset_type', 'serial_number', 'branch_id']);
    }

    /** Seeds the starter software only when the customer has no software at all (the lazy rule). */
    public function ensureSeeded(int $clientId): void
    {
        $hasSoftware = DB::table('machines')
            ->where('client_ID', $clientId)
            ->where('asset_type', self::TYPE_SOFTWARE)
            ->exists();

        if (!$hasSoftware) {
            $this->seedMissing($clientId);
        }
    }

    /**
     * Adds whichever starter software items this customer is missing (matched on the serial code).
     *
     * @return array<int, string> the serial codes that were added (or would be, when $dryRun)
     */
    public function seedMissing(int $clientId, bool $dryRun = false): array
    {
        if (!DB::table('clients')->where('id', $clientId)->exists()) {
            return [];
        }

        $categoryId = $this->softwareMachineCategoryId();
        if ($categoryId === null) {
            return [];
        }

        $added = [];
        foreach ((array) config('assets.seed_software', []) as $item) {
            $serial = self::seedSerial($clientId, (string) $item['code']);
            if (DB::table('machines')->where('serial_number', $serial)->exists()) {
                continue;
            }
            if (!$dryRun) {
                DB::table('machines')->insertOrIgnore([
                    'client_ID' => $clientId,
                    'asset_type' => self::TYPE_SOFTWARE,
                    'category_ID' => $categoryId,
                    'machine_name' => (string) $item['name'],
                    'serial_number' => $serial,
                    'status' => 'active',
                    'branch_id' => null,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
            $added[] = $serial;
        }

        return $added;
    }

    /** The active Service or Software problem category for this asset type, or null if missing. */
    public function categoryIdFor(string $assetType): ?int
    {
        $name = $assetType === self::TYPE_SOFTWARE ? 'software' : 'service';

        $base = DB::table('problem_categories')
            ->whereRaw('LOWER(category_name) = ?', [$name])
            ->where('is_active', true);

        $id = (clone $base)->whereNull('branch_id')->value('problem_category_ID')
            ?? $base->value('problem_category_ID');

        return $id !== null ? (int) $id : null;
    }

    public static function seedSerial(int $clientId, string $code): string
    {
        return 'SW-' . $clientId . '-' . strtoupper($code);
    }

    /** The label the customer sees: equipment shows its serial, software never does (AC-3). */
    public static function label(object $row): string
    {
        $isSoftware = ($row->asset_type ?? self::TYPE_EQUIPMENT) === self::TYPE_SOFTWARE;

        return $isSoftware || empty($row->serial_number)
            ? (string) $row->machine_name
            : $row->machine_name . ' - ' . $row->serial_number;
    }

    private function pickableQuery(int $clientId)
    {
        $statuses = array_map('strtolower', (array) config('assets.pickable_statuses', ['active']));

        return DB::table('machines')
            ->where('client_ID', $clientId)
            ->where(function ($q) use ($statuses) {
                $q->whereNull('status')
                  ->orWhere('status', '')
                  ->orWhereIn(DB::raw('LOWER(status)'), $statuses);
            });
    }

    private function present(object $row): array
    {
        $isSoftware = $row->asset_type === self::TYPE_SOFTWARE;

        return [
            'machine_ID' => (int) $row->machine_ID,
            'name' => (string) $row->machine_name,
            'asset_type' => $isSoftware ? self::TYPE_SOFTWARE : self::TYPE_EQUIPMENT,
            'serial_number' => $isSoftware ? null : $row->serial_number,
            'category_name' => $isSoftware ? 'Software' : 'Service',
            'label' => self::label($row),
        ];
    }

    private function softwareMachineCategoryId(): ?int
    {
        $id = DB::table('machine_categories')->where('category_name', 'Software')->value('category_ID');

        return $id !== null ? (int) $id : null;
    }
}
