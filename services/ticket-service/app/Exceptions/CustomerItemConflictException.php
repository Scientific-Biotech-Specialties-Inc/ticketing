<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * A Super Admin create was refused for a reason the page can act on: the email already has an
 * account, the hospital already has accounts, the serial is taken, or the attach target does not
 * match. Answered as 409 with `code` and the data the matching modal needs.
 */
class CustomerItemConflictException extends RuntimeException
{
    public function __construct(
        public readonly string $conflictCode,
        string $message,
        public readonly array $data = [],
    ) {
        parent::__construct($message);
    }
}
