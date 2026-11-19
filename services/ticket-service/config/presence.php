<?php

return [
    // How fresh an employee heartbeat must be (in seconds) to count as Online (spec 0035).
    'online_window_seconds' => (int) env('PRESENCE_ONLINE_WINDOW_SECONDS', 90),
];
