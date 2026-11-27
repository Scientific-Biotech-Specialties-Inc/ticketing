<?php

namespace App\Support;

/**
 * The one rule for comparing hospital (organization) names.
 *
 * Lowercase, turn every run of characters that are not letters or digits into a single space,
 * then trim. "St. Luke's  Medical" becomes "st luke s medical", so punctuation, case and extra
 * spaces never create a second hospital. Used for the unique key, search and matching; no other
 * service normalizes names on its own.
 */
final class OrganizationName
{
    public static function normalize(?string $name): string
    {
        $lower = mb_strtolower((string) $name, 'UTF-8');
        $spaced = preg_replace('/[^\p{L}\p{N}]+/u', ' ', $lower) ?? '';

        return trim($spaced);
    }
}
