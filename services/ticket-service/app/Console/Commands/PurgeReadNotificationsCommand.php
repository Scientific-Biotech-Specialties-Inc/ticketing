<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class PurgeReadNotificationsCommand extends Command
{
    /**
     * Read notifications are deleted in batches of this size so a large backlog never
     * holds one long lock on the shared notifications table.
     */
    private const BATCH_SIZE = 1000;

    /**
     * Retention below this is refused, so a bad env value cannot wipe recent history.
     */
    private const MIN_RETENTION_DAYS = 7;

    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'notifications:purge
        {--days= : Override ticketing.notifications.retention_days}
        {--dry-run : Report how many rows would be deleted without deleting them}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Delete read in-app notifications older than the retention window, in batches. Unread notifications are kept.';

    /**
     * Execute the console command.
     */
    public function handle(): int
    {
        $days = (int) ($this->option('days') ?? config('ticketing.notifications.retention_days', 90));

        if ($days < self::MIN_RETENTION_DAYS) {
            $this->error('Retention must be at least ' . self::MIN_RETENTION_DAYS . " days (got {$days}). Nothing was deleted.");
            return Command::FAILURE;
        }

        $cutoff = now()->subDays($days);
        $expired = fn () => DB::table('notifications')
            ->where('is_read', true)
            ->where('created_at', '<', $cutoff);

        if ($this->option('dry-run')) {
            $this->info("Dry run: {$expired()->count()} read notifications older than {$days} days would be deleted.");
            return Command::SUCCESS;
        }

        $deleted = 0;
        do {
            $batch = $expired()->orderBy('id')->limit(self::BATCH_SIZE)->delete();
            $deleted += $batch;
        } while ($batch === self::BATCH_SIZE);

        $this->info("Deleted {$deleted} read notifications older than {$days} days.");

        return Command::SUCCESS;
    }
}
