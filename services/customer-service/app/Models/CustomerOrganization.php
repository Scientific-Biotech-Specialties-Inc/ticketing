<?php

namespace App\Models;

use App\Support\OrganizationName;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * A hospital (customer organization). One hospital has many customer accounts (clients),
 * and normalized_name is unique so the same hospital is never stored twice.
 */
class CustomerOrganization extends Model
{
    protected $table = 'customer_organizations';

    protected $fillable = ['name', 'normalized_name'];

    public function clients(): HasMany
    {
        return $this->hasMany(Client::class, 'organization_id');
    }

    /** The hospital whose normalized name matches, or null. */
    public static function findByName(?string $name): ?self
    {
        $key = OrganizationName::normalize($name);

        return $key === '' ? null : static::where('normalized_name', $key)->first();
    }

    /**
     * The hospital for this name, created when missing. Two callers adding the same new hospital
     * at once end up on one row: a unique key clash means the other caller won, so read its row.
     */
    public static function resolveByName(string $name): ?self
    {
        $key = OrganizationName::normalize($name);
        if ($key === '') {
            return null;
        }

        try {
            return DB::transaction(fn () => static::firstOrCreate(
                ['normalized_name' => $key],
                ['name' => trim($name)]
            ));
        } catch (QueryException $e) {
            $existing = static::where('normalized_name', $key)->first();
            if ($existing) {
                return $existing;
            }
            throw $e;
        }
    }
}
