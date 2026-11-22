<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'mailgun' => [
        'domain' => env('MAILGUN_DOMAIN'),
        'secret' => env('MAILGUN_SECRET'),
        'endpoint' => env('MAILGUN_ENDPOINT', 'api.mailgun.net'),
        'scheme' => 'https',
    ],

    'postmark' => [
        'token' => env('POSTMARK_TOKEN'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'attachment' => [
        'url' => env('ATTACHMENT_SERVICE_URL', 'http://attachment-service:8000'),
    ],


    // Spec 0044: refuse customer tokens on staff gateway traffic (X-Ticketing-Edge: staff).
    'edge' => [
        'enforce' => (bool) env('TICKETING_EDGE_ENFORCE', false),
    ],

    // Branch given to a new ticket when neither the request nor the selected equipment names one.
    // SBSI Makati until equipment arrives from the equipment system with its real branch (that wins).
    // Set TICKET_DEFAULT_BRANCH to empty to leave such tickets without a branch.
    'tickets' => [
        'default_branch' => env('TICKET_DEFAULT_BRANCH', 'sbsi-makati-branch'),
    ],

    // TS <-> SERMS reimbursement integration. TS sends X-Internal-Secret on calls to SERMS, and accepts
    // the same secret from SERMS on /internal routes. SERMS_INTERNAL_SECRET overrides the shared
    // INTERNAL_SERVICE_SECRET when the SERMS secret differs (for example a local tunnel).
    'serms' => [
        'url' => rtrim((string) env('SERMS_API_URL', ''), '/'),
        'prefix' => '/' . trim((string) env('SERMS_API_PREFIX', '/api'), '/'),
        'secret' => (string) env('SERMS_INTERNAL_SECRET', env('INTERNAL_SERVICE_SECRET', '')),
        'timeout' => (int) env('SERMS_TIMEOUT', 15),
    ],

];
