<?php

namespace App\Console;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;

class Kernel extends ConsoleKernel
{
    /**
     * Define the application's command schedule.
     */
    protected function schedule(Schedule $schedule): void
    {
        // Moved from ticket-service, name unchanged so forecast_job_runs.job_name history stays continuous.
        // Precompute the longest horizon the UI offers (30 days) so both the 7 and 30 day views are served from fresh rows.
        // Run by the analytics-scheduler container (php artisan schedule:work).
        $schedule->command('tickets:calculate-forecasts', ['--horizon' => 30])->dailyAt('02:00')->onOneServer()->runInBackground();
    }

    /**
     * Register the commands for the application.
     */
    protected function commands(): void
    {
        $this->load(__DIR__.'/Commands');

        require base_path('routes/console.php');
    }
}
