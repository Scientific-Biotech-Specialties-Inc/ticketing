<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Spec 0051 (AC-4): email sent to each manager when CS routes a ticket to their department.
 * Inserted only when missing, so a superadmin's edits are never overwritten.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('email_templates')->insertOrIgnore([
            'event_key' => 'ticket_department_routed',
            'event_label' => 'Ticket Routed to Department',
            'is_enabled' => true,
            'subject' => 'Ticket #{ticket_number} Was Routed to {department_name}',
            'body' => '<p>Dear {agent_name},</p><p>Ticket <strong>#{ticket_number}</strong> was routed to the <strong>{department_name}</strong> department by {routed_by}. Please accept it, assign it to people in your department, or return it to Customer Service.</p><p><strong>Subject:</strong> {ticket_subject}<br><strong>Category:</strong> {ticket_category}<br><strong>Priority:</strong> {ticket_priority}</p><p>Open your Department queue to act on it.</p><p>Best regards,<br>{from_name}</p>',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        DB::table('email_templates')->where('event_key', 'ticket_department_routed')->delete();
    }
};
