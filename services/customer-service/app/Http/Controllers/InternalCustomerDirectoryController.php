<?php

namespace App\Http\Controllers;

use App\Models\Client;
use App\Models\CustomerOrganization;
use App\Support\OrganizationName;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

/**
 * Read only hospital and account lookups for other services (internal secret only).
 *
 * ticket-service uses these to search hospitals, check an email or hospital before creating an
 * account, and show account email and hospital next to its items, without reading customer
 * tables itself.
 */
class InternalCustomerDirectoryController extends Controller
{
    private const MAX_IDS = 100;
    private const MAX_SEARCH_IDS = 500;

    /** GET /api/internal/organizations?search=&limit= : hospitals whose normalized name contains the search. */
    public function organizations(Request $request): JsonResponse
    {
        $validator = Validator::make($request->query(), [
            'search' => 'required|string|min:1|max:255',
            'limit' => 'nullable|integer|min:1|max:20',
        ]);
        if ($validator->fails()) {
            return $this->invalid($validator->errors()->toArray());
        }

        $key = OrganizationName::normalize($request->query('search'));
        if ($key === '') {
            return response()->json(['data' => []]);
        }

        $compact = $this->compact($key);

        $rows = CustomerOrganization::query()
            ->whereRaw("REPLACE(normalized_name, ' ', '') LIKE ?", ['%' . $compact . '%'])
            ->withCount('clients')
            // Exact match first, then names that start with the search, then the rest.
            ->orderByRaw("CASE WHEN normalized_name = ? THEN 0 WHEN REPLACE(normalized_name, ' ', '') LIKE ? THEN 1 ELSE 2 END", [$key, $compact . '%'])
            ->orderBy('name')
            ->limit((int) $request->query('limit', 20))
            ->get();

        return response()->json([
            'data' => $rows->map(fn (CustomerOrganization $o) => [
                'id' => $o->id,
                'name' => $o->name,
                'account_count' => (int) $o->clients_count,
            ])->values(),
        ]);
    }

    /**
     * GET /api/internal/customers/lookup?email=&organization_id=|organization_name=
     *
     * The account that owns this email (trimmed, lowercased), and the chosen or typed hospital
     * with the logins it already has.
     */
    public function lookup(Request $request): JsonResponse
    {
        $validator = Validator::make($request->query(), [
            'email' => 'required|email|max:255',
            'organization_id' => 'nullable|integer',
            'organization_name' => 'nullable|string|max:255',
        ]);
        if ($validator->fails()) {
            return $this->invalid($validator->errors()->toArray());
        }

        $email = mb_strtolower(trim((string) $request->query('email')));
        $client = Client::query()->whereRaw('LOWER(email) = ?', [$email])->first();

        $organization = null;
        if ($request->filled('organization_id')) {
            $organization = CustomerOrganization::find((int) $request->query('organization_id'));
        } elseif ($request->filled('organization_name')) {
            $organization = CustomerOrganization::findByName($request->query('organization_name'));
        }

        $accounts = $organization
            ? Client::query()->where('organization_id', $organization->id)->orderBy('id')->get(['id', 'email'])
            : collect();

        return response()->json([
            'email_match' => $client ? [
                'client_id' => $client->id,
                'client_name' => $client->client_name,
                'email' => $client->email,
                'status' => $client->status ? 'active' : 'inactive',
                'organization_id' => $client->organization_id,
            ] : null,
            'organization' => $organization ? ['id' => $organization->id, 'name' => $organization->name] : null,
            'organization_accounts' => $accounts->map(fn (Client $c) => [
                'client_id' => $c->id,
                'email' => $c->email,
            ])->values(),
        ]);
    }

    /**
     * GET /api/internal/customers/by-ids?ids=1,2,3   (up to 100 ids)
     * GET /api/internal/customers/by-ids?search=text (up to 500 matching accounts)
     *
     * Account email and hospital for the given ids, or the accounts whose email, hospital or
     * account name matches the search.
     */
    public function byIds(Request $request): JsonResponse
    {
        $validator = Validator::make($request->query(), [
            'ids' => 'required_without:search|nullable|string|max:2000',
            'search' => 'required_without:ids|nullable|string|max:255',
        ]);
        if ($validator->fails()) {
            return $this->invalid($validator->errors()->toArray());
        }

        $query = Client::query()->with('organization:id,name');

        if ($request->filled('ids')) {
            $ids = collect(explode(',', (string) $request->query('ids')))
                ->map(fn ($id) => trim($id))
                ->filter(fn ($id) => ctype_digit($id))
                ->map(fn ($id) => (int) $id)
                ->unique()
                ->values();

            if ($ids->count() > self::MAX_IDS) {
                return $this->invalid(['ids' => ['At most ' . self::MAX_IDS . ' ids are allowed.']]);
            }

            $query->whereIn('id', $ids->all());
        } else {
            $this->applySearch($query, (string) $request->query('search'));
            $query->orderBy('id')->limit(self::MAX_SEARCH_IDS);
        }

        return response()->json([
            'data' => $query->get()->map(fn (Client $c) => [
                'client_id' => $c->id,
                'email' => $c->email,
                'client_name' => $c->client_name,
                'organization_id' => $c->organization_id,
                'organization_name' => $c->organization?->name,
            ])->values(),
        ]);
    }

    private function applySearch(Builder $query, string $search): void
    {
        $text = '%' . $this->escapeLike(mb_strtolower(trim($search))) . '%';
        $key = OrganizationName::normalize($search);

        $query->where(function (Builder $q) use ($text, $key) {
            $q->whereRaw('LOWER(email) LIKE ?', [$text])
                ->orWhereRaw('LOWER(client_name) LIKE ?', [$text]);

            if ($key !== '') {
                $q->orWhereHas('organization', fn (Builder $o) => $o->whereRaw("REPLACE(normalized_name, ' ', '') LIKE ?", ['%' . $this->compact($key) . '%']));
            }
        });
    }

    /**
     * The normalized name without spaces, for search only. Normalizing "St. Luke's" gives
     * "st luke s", so a search for "st lukes" must ignore spaces to find it.
     */
    private function compact(string $normalized): string
    {
        return str_replace(' ', '', $normalized);
    }

    private function escapeLike(string $value): string
    {
        return addcslashes($value, '%_\\');
    }

    private function invalid(array $errors): JsonResponse
    {
        return response()->json(['message' => 'Validation failed.', 'errors' => $errors], 422);
    }
}
