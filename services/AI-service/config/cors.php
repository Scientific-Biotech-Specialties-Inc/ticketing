<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Cross-Origin Resource Sharing (CORS) Configuration
    |--------------------------------------------------------------------------
    |
    | Here you may configure your settings for cross-origin resource sharing
    | or "CORS". This determines what cross-origin operations may execute
    | in web browsers. You are free to adjust these settings as needed.
    |
    | To learn more: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
    |
    */

    'paths' => ['api/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['*'],

    /*
     * Allowed browser origins. Production is same origin (each portal's nginx proxies /api/), so
     * production allows only what CORS_ALLOWED_ORIGINS lists (comma separated) and nothing by
     * default. Outside production the local dev origins below plus any localhost or private
     * network origin are allowed. Never use '*'.
     */
    'allowed_origins' => array_values(array_filter(array_map('trim', explode(',', (string) env(
        'CORS_ALLOWED_ORIGINS',
        env('APP_ENV') === 'production'
            ? ''
            : 'http://localhost:3000,http://localhost:5173,http://localhost:5176,http://localhost:5177,http://127.0.0.1:3000,http://127.0.0.1:5173,http://127.0.0.1:5176,http://127.0.0.1:5177'
    ))))),

    'allowed_origins_patterns' => env('APP_ENV') === 'production'
        ? []
        : ['#^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$#'],

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 0,

    'supports_credentials' => false,

];
