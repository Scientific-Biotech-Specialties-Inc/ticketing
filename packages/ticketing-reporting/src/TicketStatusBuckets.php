<?php

namespace Ticketing\Reporting;

/**
 * One definition of "active" and "closed" for every dashboard (CS, employee, customer, admin,
 * super admin), so the same ticket counts the same way no matter who is looking.
 *
 * Ids come from the ticket_statuses table and must match ticket-service's TicketStateMachine::STATUS_ID_*.
 * This package cannot reference ticket-service classes, so the ids live here as constants, and
 * ticket-service's TicketStatusBucketsSyncTest fails if the two ever drift apart. Never hard code
 * status ids in a dashboard query: a stale list once made SuperAdmin treat "Pending Assignment"
 * (10) as finished and "Discarded" (9) as active.
 */
final class TicketStatusBuckets
{
    public const STATUS_ID_RESOLVED = 3;
    public const STATUS_ID_CLOSED = 4;
    public const STATUS_ID_DISCARDED = 9;

    /** Work is over: Resolved, Closed, Discarded (Cancelled shares the Discarded id). */
    public const FINISHED_IDS = [self::STATUS_ID_RESOLVED, self::STATUS_ID_CLOSED, self::STATUS_ID_DISCARDED];

    /** Permanently done: Closed or Discarded. A Resolved ticket can still be reopened. */
    public const CLOSED_IDS = [self::STATUS_ID_CLOSED, self::STATUS_ID_DISCARDED];

    public static function isActive(int $statusId): bool
    {
        return !in_array($statusId, self::FINISHED_IDS, true);
    }
}
