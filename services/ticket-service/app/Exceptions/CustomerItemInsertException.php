<?php

namespace App\Exceptions;

use RuntimeException;
use Throwable;

/**
 * The item could not be saved after the account step. A newly created account is kept: it is
 * reusable, so a retry finds the email and attaches the item to it.
 */
class CustomerItemInsertException extends RuntimeException
{
    public function __construct(
        public readonly int $clientId,
        public readonly string $accountStatus,
        ?Throwable $previous = null,
    ) {
        parent::__construct('The item could not be saved.', 0, $previous);
    }
}
