# Database Schema & State Management

This document details the multi-database data architecture powering the **Enterprise Ticketing System**, spanning relational MySQL 8 tables, MongoDB 7 chat documents, and Redis in-memory caching schemas.

---

## Data Layer Architecture

```
 [clients] --------+ (1:N client_id)
                   |
 [employees] ------+ (1:N requested_by)
                   |
                   v
             +-----------+
             |  tickets  |
             +-----+-----+
                   |
     +-------------+-------------+-------------+-------------+
     | (1:N)       | (1:1)       | (1:N)       | (1:N)       | (1:N)
     v             v             v             v             v
[ticket_      [sla_         [proof_of_    [ticket_      [work_
 assignments]  trackings]    completion]   audit_logs]   logs]
```

### Relational Foreign Key Summary:
* `tickets.client_id` $\rightarrow$ `clients.id` (Nullable for internal tickets)
* `tickets.requested_by` $\rightarrow$ `employees.id` (Nullable for customer tickets)
* `tickets.department_id` $\rightarrow$ `departments.id`
* `tickets.ticket_priority_id` $\rightarrow$ `ticket_priorities.id`
* `tickets.ticket_status_id` $\rightarrow$ `ticket_statuses.id`
* `ticket_assignments.ticket_id` $\rightarrow$ `tickets.id` (Cascade Delete)
* `ticket_assignments.employee_id` $\rightarrow$ `employees.id`
* `proof_of_completion.ticket_id` $\rightarrow$ `tickets.id`
* `ticket_audit_logs.ticket_id` $\rightarrow$ `tickets.id` (Nullable, Non-cascading)

---

## 1. Relational Database Schema (MySQL 8)

### Primary Core Tables

#### `tickets`
The central operational entity storing ticket metadata and state.
* `id` (`BIGINT UNSIGNED`, PK, Auto-Increment)
* `ticket_number` (`VARCHAR(64)`, Unique Index)
* `title` (`VARCHAR(255)`)
* `description` (`TEXT`)
* `client_id` (`BIGINT UNSIGNED`, Nullable, FK to `clients.id`)
* `requested_by` (`BIGINT UNSIGNED`, Nullable, FK to `employees.id` for internal tickets)
* `is_internal` (`TINYINT(1)`, Default: `0`)
* `department_id` (`BIGINT UNSIGNED`, FK to `departments.id`)
* `machine_category_id` (`BIGINT UNSIGNED`, Nullable)
* `problem_category_id` (`BIGINT UNSIGNED`, Nullable)
* `ticket_type_id` (`BIGINT UNSIGNED`, Nullable)
* `ticket_priority_id` (`BIGINT UNSIGNED`, FK to `ticket_priorities.id`)
* `ticket_status_id` (`BIGINT UNSIGNED`, FK to `ticket_statuses.id`)
* `target_response_time` (`DATETIME`, Nullable, Calculated SLA target)
* `target_resolution_time` (`DATETIME`, Nullable, Calculated SLA target)
* `first_response_at` (`DATETIME`, Nullable)
* `resolved_at` (`DATETIME`, Nullable)
* `closed_at` (`DATETIME`, Nullable)
* `created_at`, `updated_at` (`TIMESTAMP`, Indexed)

#### `ticket_assignments`
Tracks technician allocations over the lifetime of a ticket.
* `id` (`BIGINT UNSIGNED`, PK)
* `ticket_id` (`BIGINT UNSIGNED`, FK to `tickets.id`, Cascade Delete)
* `employee_id` (`BIGINT UNSIGNED`, FK to `employees.id`)
* `assigned_by` (`BIGINT UNSIGNED`, Nullable)
* `is_active` (`TINYINT(1)`, Default: `1`, Compound Index with `employee_id`)
* `accepted_at` (`DATETIME`, Nullable)
* `created_at`, `updated_at` (`TIMESTAMP`)

#### `proof_of_completion`
Mandatory verification evidence submitted by technicians prior to resolution.
* `id` (`BIGINT UNSIGNED`, PK)
* `ticket_id` (`BIGINT UNSIGNED`, FK to `tickets.id`)
* `employee_id` (`BIGINT UNSIGNED`, FK to `employees.id`)
* `remarks` (`TEXT`)
* `attachment_id` (`VARCHAR(64)`, UUID reference to attachment)
* `review_status` (`ENUM('pending', 'approved', 'rejected')`, Default: `'pending'`)
* `reviewed_by` (`BIGINT UNSIGNED`, Nullable)
* `rejection_reason` (`TEXT`, Nullable)
* `created_at`, `updated_at` (`TIMESTAMP`)

#### SLA timing (no separate table)
SLA deadlines and pause time are stored on `tickets`: `response_due_at`, `resolution_due_at`,
`first_response_at`, `response_sla_status`, `resolution_sla_status`, `sla_status`, `sla_started_at`,
`sla_paused_at`, `sla_paused_total_seconds`. Per-assignment timing is in `ticket_assignment_periods`.
The old `sla_trackings` table was never used and was dropped
(see `docs/database-cleanup-plan.md`).

#### `ticket_audit_logs`
Immutable compliance and change-tracking ledger.
* `id` (`BIGINT UNSIGNED`, PK)
* `ticket_id` (`BIGINT UNSIGNED`, Nullable, Non-cascading FK)
* `user_id` (`BIGINT UNSIGNED`)
* `user_type` (`VARCHAR(50)`, e.g., `'employee'`, `'client'`)
* `action` (`VARCHAR(100)`, e.g., `'STATUS_UPDATED'`, `'ASSIGNED'`, `'PROOF_SUBMITTED'`)
* `old_values` (`JSON`, Nullable)
* `new_values` (`JSON`, Nullable)
* `ip_address` (`VARCHAR(45)`, Nullable)
* `user_agent` (`TEXT`, Nullable)
* `created_at` (`TIMESTAMP`)

---

## 2. Document Database Schema (MongoDB 7)

High-throughput, unconstrained chat messages are persisted in MongoDB to prevent high-frequency write contention on the primary relational database.

### Database: `ticketing_messaging`
### Collection: `messages`

```json
{
  "_id": ObjectId("66e3a47f12e09a34b21901a1"),
  "ticket_id": 1042,
  "sender_id": 14,
  "sender_name": "Jane Doe",
  "sender_type": "employee",
  "message": "Replacement hydraulic pressure seal installed. Running test cycle.",
  "edit_history": [
    {
      "previous_message": "Replacement seal installed.",
      "edited_at": ISODate("2026-09-13T02:00:00Z")
    }
  ],
  "deleted_by": [],
  "created_at": ISODate("2026-09-13T01:55:00Z"),
  "updated_at": ISODate("2026-09-13T02:00:00Z")
}
```

### MongoDB Indexes:
* `{ "ticket_id": 1 }`: Fast retrieval of conversation threads by ticket ID.
* `{ "created_at": -1 }`: Chronological message ordering and pagination.

---

## 3. Redis In-Memory Cache Schema & Key Conventions

Redis is used for caching, session stores, and pub/sub. The default cache prefix is `laravel_cache:`.

### Key Convention Taxonomy

| Pattern | Type | TTL | Purpose |
| :--- | :--- | :--- | :--- |
| `cs_dashboard_counts` | String / JSON | 300s | Global counts of unassigned, overdue, and urgent tickets |
| `customer_dashboard_counts_{client_id}` | String / JSON | 300s | Ticket counts specific to a tenant |
| `ticket_form_options_cache` | String / JSON | 3600s | Cached dropdown options (departments, categories, priorities) |
| `cs_incoming_tickets_{page}_{filter}` | String / JSON | 120s | Cached pages of incoming support tickets |
| `employee_jwt_blacklist_{jti}` | String / Flag | Token TTL | Revoked employee JWT tokens |

### Cache Invalidation Strategy
To prevent stale reads across distributed updates, `TicketController` utilizes an iterator-based non-blocking `SCAN` routine to flush related cache keys without blocking the Redis single-threaded event loop:

```php
$patterns = [
    '*cs_incoming_tickets_*',
    '*cs_dashboard_recent_*',
    '*customer_dashboard_recent_*',
    '*customer_dashboard_counts_*'
];

foreach ($patterns as $pattern) {
    // Non-blocking SCAN in chunks of 100 keys
    do {
        $keys = $redis->scan($iterator, ['match' => $pattern, 'count' => 100]);
        foreach ($keys as $key) {
            $redis->del($key);
        }
    } while ($iterator > 0);
}
```
