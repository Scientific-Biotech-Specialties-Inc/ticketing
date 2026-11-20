<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

/**
 * Department track of a problem category (service, it, others), from the category alone.
 *
 * Same rules as EmployeeDirectoryController::resolveCategoryTrack (configured category_track_rules
 * first, then keywords) but it reads only the category name, never the ticket title or description,
 * so an internal ticket's department follows the category the employee picked.
 */
class CategoryTrack
{
    public const SERVICE_DEPARTMENT_ID = 1;
    public const IT_DEPARTMENT_ID = 2;

    public function forName(string $categoryName): string
    {
        $key = strtolower(trim($categoryName));
        $configured = $this->rules()[$key] ?? null;
        if (is_string($configured) && in_array(strtolower($configured), ['service', 'it', 'others'], true)) {
            return strtolower($configured);
        }

        if (preg_match('/\b(it|information technology|software|network|system|server|database|computer|login|password|wifi|bug|api)\b/i', $key)) {
            return 'it';
        }
        if (preg_match('/\b(service|biomedical|machine|hardware|device|calibration|repair|equipment|imaging|clinical|maintenance|failure)\b/i', $key)) {
            return 'service';
        }

        return 'others';
    }

    public function forCategoryId(int $categoryId): string
    {
        $name = (string) (DB::table('problem_categories')->where('problem_category_ID', $categoryId)->value('category_name') ?? '');

        return $this->forName($name);
    }

    /** IT categories go to the IT department; everything else to Service (equipment required). */
    public function departmentIdFor(int $categoryId): int
    {
        return $this->forCategoryId($categoryId) === 'it' ? self::IT_DEPARTMENT_ID : self::SERVICE_DEPARTMENT_ID;
    }

    /** @return array<string, string> lowercased category name => track */
    protected function rules(): array
    {
        return Cache::remember('config:category_track_rules', 60, function () {
            try {
                $configUrl = env('CONFIGURATION_SERVICE_URL', 'http://configuration-service:8000');
                $res = Http::timeout(2)->get("{$configUrl}/api/ticket-configurations/category_track_rules");
                if ($res->successful()) {
                    $rules = $res->json('value') ?? $res->json();
                    if (is_array($rules)) {
                        return array_change_key_case($rules, CASE_LOWER);
                    }
                }
            } catch (\Throwable $e) {
                // Keyword rules below still decide.
            }
            return [];
        });
    }
}
