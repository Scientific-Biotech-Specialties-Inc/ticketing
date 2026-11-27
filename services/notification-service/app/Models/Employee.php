<?php

namespace App\Models;

/**
 * Staff account resolved by VerifyEmployeeJwt (central SSO token). Same table as User; the
 * shared ticketing-auth middleware looks this class up by name.
 */
class Employee extends User
{
    public $timestamps = false;

    protected $table = 'employees';
    protected $primaryKey = 'emp_id';
}
