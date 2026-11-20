<?php

/*
 * Spec 0047 (AC-2): starter software every customer gets until the equipment system sends real
 * software. Seeded rows use the hidden serial code SW-<client_ID>-<code>, which is never shown.
 */
return [

    'seed_software' => [
        ['code' => 'LIS', 'name' => 'Laboratory Information System (LIS)'],
        ['code' => 'ECS', 'name' => 'Equipment Control Software'],
        ['code' => 'HIS', 'name' => 'Hospital Information System (HIS)'],
    ],

    // Machine statuses a customer may still choose (null / empty status is always allowed).
    'pickable_statuses' => ['active'],

];
