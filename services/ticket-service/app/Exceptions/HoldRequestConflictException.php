<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * Spec 0048: thrown inside the hold transition's transaction when the hold request being
 * approved is no longer pending, so the whole transaction (ticket update, SLA pause, audit)
 * rolls back and the ticket is held at most once.
 */
class HoldRequestConflictException extends RuntimeException
{
    public function __construct(
        public readonly string $errorCode = 'HOLD_REQUEST_NOT_PENDING',
        string $message = 'This hold request has already been decided or cancelled.',
        public readonly int $httpStatus = 409
    ) {
        parent::__construct($message);
    }

    public function render($request)
    {
        return response()->json([
            'message' => $this->getMessage(),
            'code' => $this->errorCode,
        ], $this->httpStatus);
    }
}
