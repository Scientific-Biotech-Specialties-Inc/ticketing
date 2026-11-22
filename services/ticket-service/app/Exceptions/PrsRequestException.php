<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * A PRS ticket push that cannot be accepted, carrying the HTTP status and machine readable code the
 * PRS side branches on. Thrown by PrsTicketService; rendered by InternalPrsController.
 */
class PrsRequestException extends RuntimeException
{
    /** @param array<string, mixed> $context */
    public function __construct(
        string $message,
        public readonly string $code_ = 'INVALID_REQUEST',
        public readonly int $status = 422,
        public readonly array $context = []
    ) {
        parent::__construct($message);
    }
}
