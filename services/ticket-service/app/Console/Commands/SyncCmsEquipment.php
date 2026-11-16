<?php

namespace App\Console\Commands;

use App\Services\Cms\CmsEquipmentSyncService;
use Illuminate\Console\Command;

/**
 * Spec 3.1: pulls customers' equipment from the CMS into machines.
 * Exits 0 even when the CMS is down, so a dead tunnel never fails the scheduler.
 */
class SyncCmsEquipment extends Command
{
    protected $signature = 'cms:sync
        {--full : Read everything and mark machines the CMS no longer lists as inactive}
        {--include-pending : Also pull contracts still pending approval (integration testing)}';

    protected $description = 'Sync customers\' equipment from the CMS (source of truth)';

    public function handle(CmsEquipmentSyncService $sync): int
    {
        $result = $sync->run((bool) $this->option('full'), (bool) $this->option('include-pending'));

        if (isset($result['summary'])) {
            $summary = $result['summary'];
            $reasons = $summary['skipped_reasons'];
            unset($summary['skipped_reasons']);

            $this->info("CMS sync ({$result['mode']}): {$result['outcome']}");
            $this->table(array_keys($summary), [array_values($summary)]);
            foreach ($reasons as $reason => $count) {
                $this->line("  skipped {$count}: {$reason}");
            }

            return self::SUCCESS;
        }

        $this->warn("CMS sync {$result['outcome']}: {$result['message']}");

        return self::SUCCESS;
    }
}
