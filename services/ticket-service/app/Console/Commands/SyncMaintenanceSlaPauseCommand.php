<?php

namespace App\Console\Commands;

use App\Services\MaintenanceSlaPauseService;
use Illuminate\Console\Command;

/**
 * Keeps SLA clocks in step with system maintenance: pauses open tickets while the system is
 * Under Maintenance, resumes them once it is Operational again. Does nothing when the status
 * cannot be read, so an unreachable configuration-service never ends a pause early.
 */
class SyncMaintenanceSlaPauseCommand extends Command
{
    protected $signature = 'tickets:sync-maintenance-sla';

    protected $description = 'Pause SLA clocks during system maintenance and resume them afterwards';

    public function handle(MaintenanceSlaPauseService $service): int
    {
        $status = $service->fetchSystemStatus();
        if ($status === null) {
            $this->warn('System status unavailable; SLA maintenance pause left unchanged.');
            return Command::SUCCESS;
        }

        if ($service->isUnderMaintenance($status)) {
            $count = $service->pauseOpenTickets();
            $this->info("Under Maintenance: paused {$count} ticket SLA clock(s).");
        } else {
            $count = $service->resumeMaintenancePausedTickets();
            $this->info("Operational: resumed {$count} ticket SLA clock(s).");
        }

        return Command::SUCCESS;
    }
}
