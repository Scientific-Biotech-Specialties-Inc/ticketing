<?php

namespace App\Services\Cms;

/**
 * Outcome of a CMS read: the rows on success, or a reason code (not_configured, forbidden,
 * unreachable, bad_response) and a message that is safe to show any signed in user.
 */
final class CmsFetchResult
{
    /**
     * @param  array<int, array<string, mixed>>  $rows
     */
    private function __construct(
        public readonly bool $ok,
        public readonly array $rows = [],
        public readonly bool $complete = false,
        public readonly ?string $reason = null,
        public readonly ?string $message = null,
    ) {
    }

    public static function success(array $rows, bool $complete): self
    {
        return new self(true, $rows, $complete);
    }

    public static function failure(string $reason, string $message): self
    {
        return new self(false, reason: $reason, message: $message);
    }
}
