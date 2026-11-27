<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * customer-service could not be reached or answered with an error. The code carries its HTTP
 * status when it answered, 0 when it was unreachable. Callers answer 502 to the browser.
 */
class CustomerServiceUnavailableException extends RuntimeException
{
}
