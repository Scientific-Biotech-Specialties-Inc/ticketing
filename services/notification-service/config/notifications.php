<?php

return [

    /*
    |--------------------------------------------------------------------------
    | In-app notification retention
    |--------------------------------------------------------------------------
    |
    | `notifications:purge` runs daily and deletes notifications that have been
    | read and are older than retention_days. Unread notifications are never purged.
    */
    'retention_days' => (int) env('NOTIFICATION_RETENTION_DAYS', 90),

];
