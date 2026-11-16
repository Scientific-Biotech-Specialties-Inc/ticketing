<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * customer-service could not find or create the customer for a CRMS machine record.
 * The code carries customer-service's HTTP status when it answered, 0 when it was unreachable.
 */
class CustomerProvisioningException extends RuntimeException
{
}
