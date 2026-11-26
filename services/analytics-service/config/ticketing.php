<?php

/*
|--------------------------------------------------------------------------
| Ticketing domain settings read by the shared reporting package (spec 0050)
|--------------------------------------------------------------------------
|
| Same key and same env var as ticket-service's config/ticketing.php, so both
| services see the same technical department list (Ticketing\Reporting\TechnicalDepartments).
|
| technical_departments: the departments that actually handle tickets.
| Left unset (the default), the list is the active departments the
| superadmin manages in the `departments` table. Set
| TICKETING_TECHNICAL_DEPARTMENTS (comma separated) only to force a fixed
| list, for example "Service,IT,Field Support".
|
*/

$technicalDepartments = array_values(array_filter(array_map(
    'trim',
    explode(',', (string) env('TICKETING_TECHNICAL_DEPARTMENTS', ''))
), fn ($d) => $d !== ''));

return [
    'technical_departments' => $technicalDepartments !== [] ? $technicalDepartments : null,
];
