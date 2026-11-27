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

    'gemini' => [
        'api_key' => env('GEMINI_API_KEY'),
        'model' => env('GEMINI_MODEL', 'gemini-3.5-flash'),
        // Chat request timeout in seconds. Capped at 15.
        'timeout' => min((int) env('GEMINI_TIMEOUT_SECONDS', 15), 15),
    ],

    // Shared secret for service to service calls (X-Internal-Token). Read through config so it still
    // works when `php artisan config:cache` is on (env() returns null outside config files then).
    'internal' => [
        'token' => env('INTERNAL_TOKEN', ''),
    ],

    // The AI chat reads a customer's equipment and software from ticket-service.
    'ticket_service' => [
        'url' => env('TICKET_SERVICE_URL', 'http://ticket-service:8000/api'),
    ],

    // Knowledge Base embedding and retrieval settings.
    'kb' => [
        'embedding_model' => env('KB_EMBEDDING_MODEL', 'gemini-embedding-001'),
        'embedding_dims' => (int) env('KB_EMBEDDING_DIMS', 768),
        'embedding_timeout' => (int) env('KB_EMBEDDING_TIMEOUT_SECONDS', 20),
        'min_score' => (float) env('KB_MIN_SCORE', 0.55),
    ],

    'clamav' => [
        'host' => env('CLAMAV_HOST', 'clamav'),
        'port' => (int) env('CLAMAV_PORT', 3310),
    ],


    // Refuse customer tokens on staff gateway traffic (X-Ticketing-Edge: staff).
    'edge' => [
        'enforce' => (bool) env('TICKETING_EDGE_ENFORCE', false),
    ],

];
