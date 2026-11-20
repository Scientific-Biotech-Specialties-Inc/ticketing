<?php

namespace App\Console\Commands;

use App\Services\CustomerAssetService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Spec 0047 (AC-2, AC-13): give every customer the starter software and, optionally, link
 * existing tickets that have no item to one of their customer's seeded software items.
 *
 * Dry run by default: nothing changes unless --apply is passed.
 *
 *   php artisan assets:seed-customer-software
 *   php artisan assets:seed-customer-software --apply --link-ticket=8:LIS
 */
class SeedCustomerSoftware extends Command
{
    protected $signature = 'assets:seed-customer-software
                            {--apply : Write the changes (without it, only print what would change)}
                            {--link-ticket=* : Link a ticket to its customer\'s seeded software, as TICKET_ID:CODE (e.g. 8:LIS)}';

    protected $description = 'Seed the starter software for every customer and link listed tickets to it (dry run unless --apply).';

    public function handle(CustomerAssetService $assets): int
    {
        $apply = (bool) $this->option('apply');
        $this->info($apply ? 'Applying changes.' : 'Dry run: nothing will be changed. Add --apply to write.');

        $links = [];
        foreach ((array) $this->option('link-ticket') as $raw) {
            if (!preg_match('/^(\d+):([A-Za-z]+)$/', trim((string) $raw), $m)) {
                $this->error("Invalid --link-ticket value '{$raw}'. Use TICKET_ID:CODE, e.g. 8:LIS.");
                return self::FAILURE;
            }
            $links[] = ['ticket_id' => (int) $m[1], 'code' => strtoupper($m[2])];
        }

        $knownCodes = array_map(fn ($i) => strtoupper((string) $i['code']), (array) config('assets.seed_software', []));
        foreach ($links as $link) {
            if (!in_array($link['code'], $knownCodes, true)) {
                $this->error("Unknown software code '{$link['code']}'. Known codes: " . implode(', ', $knownCodes) . '.');
                return self::FAILURE;
            }
        }

        $total = 0;
        foreach (DB::table('clients')->orderBy('id')->pluck('id') as $clientId) {
            $added = $assets->seedMissing((int) $clientId, !$apply);
            if ($added) {
                $total += count($added);
                $this->line("  customer {$clientId}: " . ($apply ? 'added ' : 'would add ') . implode(', ', $added));
            }
        }
        $this->info(($apply ? 'Software items added: ' : 'Software items to add: ') . $total);

        foreach ($links as $link) {
            $ticket = DB::table('tickets')->where('ticket_ID', $link['ticket_id'])->first(['ticket_ID', 'created_by', 'is_internal', 'machine_ID']);
            if (!$ticket || (int) $ticket->is_internal !== 0) {
                $this->error("Ticket {$link['ticket_id']} is not a customer ticket.");
                return self::FAILURE;
            }

            $serial = CustomerAssetService::seedSerial((int) $ticket->created_by, $link['code']);
            $machineId = DB::table('machines')
                ->where('serial_number', $serial)
                ->where('client_ID', (int) $ticket->created_by)
                ->value('machine_ID');

            if (!$machineId && $apply) {
                $this->error("Ticket {$link['ticket_id']}: its customer has no {$serial} item.");
                return self::FAILURE;
            }

            $category = $assets->categoryIdFor(CustomerAssetService::TYPE_SOFTWARE);
            $this->line("  ticket {$link['ticket_id']}: " . ($apply ? 'linked to ' : 'would link to ') . $serial
                . ($ticket->machine_ID ? " (replacing machine {$ticket->machine_ID})" : ''));

            if ($apply) {
                DB::table('tickets')->where('ticket_ID', $link['ticket_id'])->update([
                    'machine_ID' => (int) $machineId,
                    'problem_category_ID' => $category,
                    'updated_at' => now(),
                ]);
            }
        }

        return self::SUCCESS;
    }
}
