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


    // Shared service to service secret sent as X-Internal-Secret (spec 0044). Guards the CRMS
    // machine sync endpoint and is forwarded to customer-service's customers/provision.
    'internal' => [
        'secret' => env('INTERNAL_SERVICE_SECRET', env('INTERNAL_TOKEN', '')),
    ],

    // Spec 3.1: CMS (Contract Management System) is the source of truth for customers' equipment.
    // TS pulls it read only (GET). Both values live in .env only; blank disables the sync.
    'cms_ts' => [
        'base_url' => env('CMS_TS_BASE_URL', ''),
        'key' => env('CMS_TS_INTEGRATION_KEY', ''),
        'connect_timeout' => (int) env('CMS_TS_CONNECT_TIMEOUT', 3),
        'timeout' => (int) env('CMS_TS_TIMEOUT', 5),
        'per_page' => (int) env('CMS_TS_PER_PAGE', 200),
        'max_pages' => (int) env('CMS_TS_MAX_PAGES', 100),
        // New customers get customer-service's welcome email (temporary password) only when true.
        'send_welcome_email' => filter_var(env('CMS_TS_SEND_WELCOME_EMAIL', false), FILTER_VALIDATE_BOOLEAN),
    ],

    'customer' => [
        'url' => env('CUSTOMER_SERVICE_URL', 'http://customer-service:8000'),
        'timeout' => (int) env('CUSTOMER_SERVICE_TIMEOUT', 10),
    ],

    // Spec 0044: refuse customer tokens on staff gateway traffic (X-Ticketing-Edge: staff).
    'edge' => [
        'enforce' => (bool) env('TICKETING_EDGE_ENFORCE', false),
    ],

];
