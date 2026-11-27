<?php

namespace App\Console;

use App\Models\AuditRetentionSetting;
use Cron\CronExpression;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;
use Illuminate\Support\Facades\Schema;
use Throwable;

class Kernel extends ConsoleKernel
{
    /**
     * Define the application's command schedule.
     */
    protected function schedule(Schedule $schedule): void
    {
        $schedule->command('tickets:auto-close-internal')->everyFiveMinutes();
        $schedule->command('tickets:check-sla-alerts')->everyMinute();
        // Spec 0031 AC-13: the only employee directory sync; request paths never call the auth module for it.
        $schedule->command('employees:sync-directory')->everyMinute()->withoutOverlapping();
        // tickets:calculate-forecasts moved to analytics-service (spec 0050 slice 1), run by analytics-scheduler.

        $purgeCron = '0 2 * * *';
        try {
            if (Schema::hasTable('audit_retention_settings')) {
                $configuredCron = trim((string) AuditRetentionSetting::query()->value('purge_schedule'));
                if ($configuredCron !== '' && CronExpression::isValidExpression($configuredCron)) {
                    $purgeCron = $configuredCron;
                }
            }
        } catch (Throwable $e) {
            $purgeCron = '0 2 * * *';
        }

        $schedule->command('tickets:purge-expired-audit-logs')->cron($purgeCron);

        // notifications:purge moved to notification-service, which owns the notifications table.
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
