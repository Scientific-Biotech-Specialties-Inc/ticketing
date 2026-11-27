<?php

namespace Tests\Unit;

use App\Services\SLAService;
use App\Services\TicketStateMachine;
use PHPUnit\Framework\TestCase;
use Ticketing\Reporting\SlaMetrics;
use Ticketing\Reporting\TicketStatusBuckets;

/**
 * The shared reporting package cannot reference ticket-service classes, so it carries its own copy of
 * the status ids and SLA constants. These assertions fail the moment the two drift apart (spec 0050 AC-13).
 */
class TicketStatusBucketsSyncTest extends TestCase
{
    public function test_package_status_ids_match_the_ticket_state_machine(): void
    {
        $this->assertSame(TicketStateMachine::STATUS_ID_RESOLVED, TicketStatusBuckets::STATUS_ID_RESOLVED);
        $this->assertSame(TicketStateMachine::STATUS_ID_CLOSED, TicketStatusBuckets::STATUS_ID_CLOSED);
        $this->assertSame(TicketStateMachine::STATUS_ID_DISCARDED, TicketStatusBuckets::STATUS_ID_DISCARDED);
    }

    public function test_sla_service_constants_come_from_the_shared_sla_clock(): void
    {
        $this->assertSame(SlaMetrics::SLA_SOURCE_COLUMNS, SLAService::SLA_SOURCE_COLUMNS);
        $this->assertSame(SlaMetrics::AT_RISK_MINUTES, SLAService::AT_RISK_MINUTES);
    }
}
