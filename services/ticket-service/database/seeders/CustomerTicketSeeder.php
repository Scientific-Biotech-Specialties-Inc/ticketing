<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Carbon;

class CustomerTicketSeeder extends Seeder
{
    public function run(): void
    {
        $now = Carbon::now();

        // 1. Get client ID for customer@gmail.com
        $client = DB::table('clients')->where('email', 'customer@gmail.com')->first();
        if (!$client) {
            $clientId = DB::table('clients')->insertGetId([
                'client_name' => 'Customer One',
                'address' => 'Quezon City',
                'contact_number' => '09123456781',
                'email' => 'customer@gmail.com',
                'status' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        } else {
            $clientId = $client->id;
        }

        // 2. Remove discarded tickets for customer@gmail.com (ticket_status_ID = 9)
        $discardedTicketIds = DB::table('tickets')
            ->where('created_by', $clientId)
            ->where('ticket_status_ID', 9)
            ->pluck('ticket_ID');

        if ($discardedTicketIds->isNotEmpty()) {
            DB::table('ticket_assignments')->whereIn('ticket_ID', $discardedTicketIds)->delete();
            DB::table('notifications')->whereIn('ticket_id', $discardedTicketIds)->delete();
            DB::table('work_logs')->whereIn('ticket_id', $discardedTicketIds)->delete();
            DB::table('internal_notes')->whereIn('ticket_id', $discardedTicketIds)->delete();
            DB::table('ticket_remarks')->whereIn('ticket_id', $discardedTicketIds)->delete();
            DB::table('ticket_attachments')->whereIn('ticket_id', $discardedTicketIds)->delete();
            DB::table('reassignment_requests')->whereIn('ticket_id', $discardedTicketIds)->delete();
            DB::table('tickets')->whereIn('ticket_ID', $discardedTicketIds)->delete();
        }

        // 3. Seed/ensure Medical Equipment machines for client
        $machines = [
            [
                'machine_ID' => 2,
                'category_ID' => 2,
                'client_ID' => $clientId,
                'machine_name' => 'Bedside Monitor VS-900',
                'serial_number' => 'MON-500-A11',
                'model' => 'VS-900',
                'brand' => 'Philips',
                'status' => 'active',
                'purchase_date' => $now->copy()->subYear(),
                'last_maintenance_date' => $now->copy()->subDays(14),
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'machine_ID' => 1,
                'category_ID' => 1,
                'client_ID' => $clientId,
                'machine_name' => 'MRI 3T Scanner Magnetom',
                'serial_number' => 'MRI-3T-B02',
                'model' => 'Magnetom Vida',
                'brand' => 'Siemens',
                'status' => 'active',
                'purchase_date' => $now->copy()->subYears(2),
                'last_maintenance_date' => $now->copy()->subDays(30),
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'machine_ID' => 12,
                'category_ID' => 2,
                'client_ID' => $clientId,
                'machine_name' => 'Mechanical Ventilator Evita V800',
                'serial_number' => 'VENT-800-C33',
                'model' => 'Evita V800',
                'brand' => 'Dräger',
                'status' => 'active',
                'purchase_date' => $now->copy()->subMonths(8),
                'last_maintenance_date' => $now->copy()->subDays(20),
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'machine_ID' => 13,
                'category_ID' => 2,
                'client_ID' => $clientId,
                'machine_name' => 'Infusion Pump Plum 360',
                'serial_number' => 'PUMP-360-D44',
                'model' => 'Plum 360',
                'brand' => 'ICU Medical',
                'status' => 'active',
                'purchase_date' => $now->copy()->subMonths(6),
                'last_maintenance_date' => $now->copy()->subDays(10),
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'machine_ID' => 14,
                'category_ID' => 1,
                'client_ID' => $clientId,
                'machine_name' => 'Ultrasound System EPIQ 7',
                'serial_number' => 'US-EPIQ-E55',
                'model' => 'EPIQ 7',
                'brand' => 'Philips',
                'status' => 'active',
                'purchase_date' => $now->copy()->subYear(),
                'last_maintenance_date' => $now->copy()->subDays(45),
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'machine_ID' => 15,
                'category_ID' => 1,
                'client_ID' => $clientId,
                'machine_name' => 'CT Scanner Somatom Force',
                'serial_number' => 'CT-SOM-F66',
                'model' => 'Somatom Force',
                'brand' => 'Siemens',
                'status' => 'active',
                'purchase_date' => $now->copy()->subYears(3),
                'last_maintenance_date' => $now->copy()->subDays(15),
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'machine_ID' => 16,
                'category_ID' => 2,
                'client_ID' => $clientId,
                'machine_name' => 'Defibrillator Lifepak 20e',
                'serial_number' => 'DEFIB-20E-G77',
                'model' => 'Lifepak 20e',
                'brand' => 'Physio-Control',
                'status' => 'active',
                'purchase_date' => $now->copy()->subMonths(18),
                'last_maintenance_date' => $now->copy()->subDays(5),
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'machine_ID' => 17,
                'category_ID' => 2,
                'client_ID' => $clientId,
                'machine_name' => 'Dialysis Machine 5008S',
                'serial_number' => 'DIAL-5008-H88',
                'model' => '5008S CorDiax',
                'brand' => 'Fresenius',
                'status' => 'active',
                'purchase_date' => $now->copy()->subYear(),
                'last_maintenance_date' => $now->copy()->subDays(12),
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'machine_ID' => 18,
                'category_ID' => 2,
                'client_ID' => $clientId,
                'machine_name' => 'Anesthesia Workstation Perseus',
                'serial_number' => 'ANES-A500-I99',
                'model' => 'Perseus A500',
                'brand' => 'Dräger',
                'status' => 'active',
                'purchase_date' => $now->copy()->subMonths(14),
                'last_maintenance_date' => $now->copy()->subDays(25),
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'machine_ID' => 19,
                'category_ID' => 2,
                'client_ID' => $clientId,
                'machine_name' => 'ECG Monitor PageWriter TC70',
                'serial_number' => 'ECG-TC70-J00',
                'model' => 'PageWriter TC70',
                'brand' => 'Philips',
                'status' => 'active',
                'purchase_date' => $now->copy()->subMonths(10),
                'last_maintenance_date' => $now->copy()->subDays(8),
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ];

        foreach ($machines as $m) {
            DB::table('machines')->upsert($m, ['machine_ID'], ['category_ID', 'client_ID', 'machine_name', 'serial_number', 'model', 'brand', 'status', 'purchase_date', 'last_maintenance_date', 'updated_at']);
        }

        // 4. Seed Medical Equipment Tickets for customer@gmail.com (Open, In Progress, Closed)
        // Status 1: Open, Status 2: In Progress, Status 4: Closed
        $ticketsToSeed = [
            // --- OPEN TICKETS ---
            [
                'machine_ID' => 2, // Bedside Monitor
                'problem_category_ID' => 1,
                'created_by' => $clientId,
                'assigned_to' => null,
                'ticket_type_ID' => 2,
                'is_internal' => 0,
                'priority_ID' => 3, // High
                'ticket_status_ID' => 1, // Open
                'sla_ID' => 1,
                'title' => 'Bedside Monitor SpO2 Sensor Intermittent Error',
                'description' => 'The pulse oximetry sensor on Bedside Monitor (VS-900) frequently disconnects during monitoring in ICU Room 3. Needs immediate sensor replacement or cable check.',
                'created_at' => $now->copy()->subHours(5),
                'updated_at' => $now->copy()->subHours(5),
            ],
            [
                'machine_ID' => 12, // Ventilator
                'problem_category_ID' => 2,
                'created_by' => $clientId,
                'assigned_to' => null,
                'ticket_type_ID' => 2,
                'is_internal' => 0,
                'priority_ID' => 4, // Critical
                'ticket_status_ID' => 1, // Open
                'sla_ID' => 2,
                'title' => 'Mechanical Ventilator Flow Sensor Recalibration Required',
                'description' => 'Dräger Evita V800 ventilator showing warning code W-104 indicating inspiratory flow sensor drift. Annual calibration verification is overdue.',
                'created_at' => $now->copy()->subHours(3),
                'updated_at' => $now->copy()->subHours(3),
            ],
            [
                'machine_ID' => 13, // Infusion Pump
                'problem_category_ID' => 1,
                'created_by' => $clientId,
                'assigned_to' => null,
                'ticket_type_ID' => 2,
                'is_internal' => 0,
                'priority_ID' => 2, // Medium
                'ticket_status_ID' => 1, // Open
                'sla_ID' => 1,
                'title' => 'Infusion Pump Plum 360 Door Latch Malfunction',
                'description' => 'Door latch lever on Plum 360 infusion pump feels loose and triggers door open alarm unexpectedly during IV administration.',
                'created_at' => $now->copy()->subHours(12),
                'updated_at' => $now->copy()->subHours(12),
            ],
            [
                'machine_ID' => 17, // Dialysis Machine
                'problem_category_ID' => 1,
                'created_by' => $clientId,
                'assigned_to' => null,
                'ticket_type_ID' => 2,
                'is_internal' => 0,
                'priority_ID' => 3, // High
                'ticket_status_ID' => 1, // Open
                'sla_ID' => 1,
                'title' => 'Dialysis Machine Temperature Control Warning',
                'description' => 'Fresenius 5008S CorDiax unit reporting dialysate temperature deviation above 37.5C limit. Machine halted self-test phase.',
                'created_at' => $now->copy()->subHours(2),
                'updated_at' => $now->copy()->subHours(2),
            ],

            // --- IN PROGRESS (ONGOING) TICKETS ---
            [
                'machine_ID' => 1, // MRI 3T Scanner
                'problem_category_ID' => 1,
                'created_by' => $clientId,
                'assigned_to' => 2, // Mark Reyes
                'ticket_type_ID' => 2,
                'is_internal' => 0,
                'priority_ID' => 4, // Critical
                'ticket_status_ID' => 2, // In Progress
                'sla_ID' => 2,
                'title' => 'MRI 3T Scanner Helium Cooling Pressure Alarm',
                'description' => 'Magnetom Vida 3T MRI unit compressor room temp spiked, warning code H-201 active. Engineer dispatched to check cold head cooling circuit.',
                'first_response_at' => $now->copy()->subHours(20),
                'created_at' => $now->copy()->subHours(24),
                'updated_at' => $now->copy()->subHours(4),
            ],
            [
                'machine_ID' => 14, // Ultrasound
                'problem_category_ID' => 2,
                'created_by' => $clientId,
                'assigned_to' => 4, // Bernadette Gonzaga
                'ticket_type_ID' => 2,
                'is_internal' => 0,
                'priority_ID' => 2, // Medium
                'ticket_status_ID' => 2, // In Progress
                'sla_ID' => 1,
                'title' => 'Ultrasound System EPIQ 7 Transducer Probe 2 Calibration',
                'description' => 'Cardiac array probe X5-1 presenting artifact lines on B-mode imaging. Technician currently testing replacement transducer cable assembly.',
                'first_response_at' => $now->copy()->subHours(15),
                'created_at' => $now->copy()->subHours(18),
                'updated_at' => $now->copy()->subHours(2),
            ],
            [
                'machine_ID' => 15, // CT Scanner
                'problem_category_ID' => 1,
                'created_by' => $clientId,
                'assigned_to' => 1008, // Elena Rostova
                'ticket_type_ID' => 2,
                'is_internal' => 0,
                'priority_ID' => 3, // High
                'ticket_status_ID' => 2, // In Progress
                'sla_ID' => 1,
                'title' => 'CT Scanner Somatom Force Gantry Alignment Fault',
                'description' => 'Dual source CT gantry rotation noisy and failed homing routine. Radiology maintenance specialist inspecting motor drive belt assembly.',
                'first_response_at' => $now->copy()->subHours(10),
                'created_at' => $now->copy()->subHours(14),
                'updated_at' => $now->copy()->subHours(1),
            ],
            [
                'machine_ID' => 18, // Anesthesia Workstation
                'problem_category_ID' => 1,
                'created_by' => $clientId,
                'assigned_to' => 1004, // Sarah Jenkins
                'ticket_type_ID' => 2,
                'is_internal' => 0,
                'priority_ID' => 3, // High
                'ticket_status_ID' => 2, // In Progress
                'sla_ID' => 1,
                'title' => 'Anesthesia Workstation O2 Flush Valve Stiffness',
                'description' => 'Perseus A500 oxygen flush mechanical valve sticking. Biomedical engineering replacement valve kit requested and technician working on site.',
                'first_response_at' => $now->copy()->subHours(8),
                'created_at' => $now->copy()->subHours(10),
                'updated_at' => $now->copy()->subHours(3),
            ],

            // --- CLOSED TICKETS ---
            [
                'machine_ID' => 16, // Defibrillator
                'problem_category_ID' => 1,
                'created_by' => $clientId,
                'assigned_to' => 2, // Mark Reyes
                'ticket_type_ID' => 2,
                'is_internal' => 0,
                'priority_ID' => 2, // Medium
                'ticket_status_ID' => 4, // Closed
                'sla_ID' => 1,
                'title' => 'Defibrillator Lifepak 20e Internal Battery Replacement',
                'description' => 'Routine self-test flagged battery capacity below 80%. Main rechargeable battery pack replaced and post-maintenance shock delivery test verified successfully.',
                'first_response_at' => $now->copy()->subDays(3)->addHours(1),
                'resolved_at' => $now->copy()->subDays(2),
                'closed_at' => $now->copy()->subDays(2),
                'created_at' => $now->copy()->subDays(3),
                'updated_at' => $now->copy()->subDays(2),
            ],
            [
                'machine_ID' => 19, // ECG Monitor
                'problem_category_ID' => 1,
                'created_by' => $clientId,
                'assigned_to' => 3, // John Dela Cruz
                'ticket_type_ID' => 2,
                'is_internal' => 0,
                'priority_ID' => 1, // Low
                'ticket_status_ID' => 4, // Closed
                'sla_ID' => 1,
                'title' => 'ECG PageWriter TC70 Thermal Printer Roller Cleaning',
                'description' => 'Paper feed jam and faint print lines during 12-lead printouts. Printer thermal head cleaned, roller replaced, and test printout confirmed clear.',
                'first_response_at' => $now->copy()->subDays(5)->addHours(2),
                'resolved_at' => $now->copy()->subDays(4),
                'closed_at' => $now->copy()->subDays(4),
                'created_at' => $now->copy()->subDays(5),
                'updated_at' => $now->copy()->subDays(4),
            ],
            [
                'machine_ID' => 2, // Bedside Monitor
                'problem_category_ID' => 2,
                'created_by' => $clientId,
                'assigned_to' => 4, // Bernadette Gonzaga
                'ticket_type_ID' => 2,
                'is_internal' => 0,
                'priority_ID' => 2, // Medium
                'ticket_status_ID' => 4, // Closed
                'sla_ID' => 1,
                'title' => 'Bedside Monitor Annual Preventive Maintenance & Inspection',
                'description' => 'Scheduled PM check completed. NIBP cuff pressure test passed, NIBP module calibrated, software updated to v3.4.',
                'first_response_at' => $now->copy()->subDays(7)->addHours(1),
                'resolved_at' => $now->copy()->subDays(6),
                'closed_at' => $now->copy()->subDays(6),
                'created_at' => $now->copy()->subDays(7),
                'updated_at' => $now->copy()->subDays(6),
            ],
            [
                'machine_ID' => 13, // Infusion Pump
                'problem_category_ID' => 2,
                'created_by' => $clientId,
                'assigned_to' => 1004, // Sarah Jenkins
                'ticket_type_ID' => 2,
                'is_internal' => 0,
                'priority_ID' => 1, // Low
                'ticket_status_ID' => 4, // Closed
                'sla_ID' => 1,
                'title' => 'Infusion Pump Software Firmware Update to v4.1',
                'description' => 'Firmware upgrade applied across Plum 360 unit. Wireless network authentication certificate refreshed and test infusion verified.',
                'first_response_at' => $now->copy()->subDays(10)->addHours(3),
                'resolved_at' => $now->copy()->subDays(9),
                'closed_at' => $now->copy()->subDays(9),
                'created_at' => $now->copy()->subDays(10),
                'updated_at' => $now->copy()->subDays(9),
            ],
        ];

        foreach ($ticketsToSeed as $t) {
            DB::table('tickets')->insert($t);
        }
    }
}
