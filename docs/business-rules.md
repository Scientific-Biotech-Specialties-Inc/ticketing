# Business Rules & Workflow Engine

This document defines the core business logic, status state machines, service level agreement (SLA) calculations, and role-based permissions governing the **Enterprise Ticketing System**.

---

## Ticket Lifecycle State Machine

The lifecycle of a ticket follows a deterministic state transition model. Each status transition is validated, audited, and broadcast in real-time.

```
[Customer Submits] --> (1: Open) -------------------------> (9: Discarded)
                         | (CS Triaged)                         ^
                         v                                      |
[Internal Ticket]  --> (2: Pending Assignment) -----------------+
                         | (Technician Accepts)
                         v
                       (3: In Progress) <------+ (Resumed / Rework)
                         |          ^          |
           (Needs Parts) |          |          +---------+
                         v          |                    |
                       (4: On Hold)-+                    |
                         |                               |
          (Submit Proof) v                               |
                       (5: Proof Submitted)              |
                         |                 \             |
         (Review: Accept)|                  \ (Review: Reject)
                         v                   v           |
                       (7: Resolved)      (6: Proof Rejected)
                         |
          (Feedback/Done)v
                       (8: Closed)
```

### State Definitions

| Status | Code | Description | Allowed Actions |
| :--- | :--- | :--- | :--- |
| **Open** | `1` | Newly created by customer; awaiting CS review. | Assign, Discard, Update info. |
| **Pending Assignment** | `2` | Triaged and queued; waiting for engineer assignment or acceptance. | Assign technician, Accept ticket. |
| **In Progress** | `3` | Engineer actively working on issue. | Log work, Put on hold, Request reassignment, Submit proof. |
| **On Hold** | `4` | Work paused (pending spare parts, site access, customer reply). | Resume work (moves back to In Progress). SLA clock paused. |
| **Proof Submitted** | `5` | Engineer finished work and provided verification evidence. | Review proof, Approve (Resolve), Reject proof. |
| **Proof Rejected** | `6` | Verification proof insufficient or rejected by customer/CS. | Technician prompted to address rejection and resubmit. |
| **Resolved** | `7` | Solution verified and approved. | Submit CSAT survey, Reopen (if permitted), Close. |
| **Closed** | `8` | Finalized ticket; no further state modifications allowed. | Read-only access, export PDF, audit viewing. |
| **Discarded** | `9` | Marked invalid, duplicate, or cancelled by CS/Admin. | Read-only audit access. |

---

## Role-Based Access Control (RBAC) Matrix

The system enforces granular permissions based on four primary user personas:

| Action / Capability | Customer | Employee (Technician) | CS Agent | SuperAdmin |
| :--- | :---: | :---: | :---: | :---: |
| **Create Customer Ticket** | ✅ | ❌ | ✅ | ✅ |
| **Create Internal Ticket** | ❌ | ✅ | ✅ | ✅ |
| **View All Incoming Tickets** | ❌ | ❌ | ✅ | ✅ |
| **View Assigned Tickets** | ❌ | ✅ (Own Only) | ✅ | ✅ |
| **Accept / Claim Ticket** | ❌ | ✅ | ❌ | ✅ |
| **Submit Work Log** | ❌ | ✅ | ❌ | ✅ |
| **Submit Proof of Completion** | ❌ | ✅ | ❌ | ❌ |
| **Approve / Reject Proof** | ✅ (Own Ticket) | ❌ | ✅ | ✅ |
| **Request Reassignment** | ❌ | ✅ | ❌ | ❌ |
| **Approve Reassignment** | ❌ | ❌ | ✅ | ✅ |
| **Discard Ticket** | ❌ | ❌ | ✅ | ✅ |
| **Manage SLA & Escalation Rules** | ❌ | ❌ | ❌ | ✅ |
| **Manage Equipment & Master Data** | ❌ | ❌ | ❌ | ✅ |
| **View Predictive Analytics** | ❌ | ❌ | ✅ | ✅ |

---

## Service Level Agreement (SLA) Engine

### 1. SLA Calculation Parameters
SLAs are calculated dynamically upon ticket ingestion based on four dimensional attributes:
1. **Department**: (e.g., Hardware, Software, Network, Facilities).
2. **Machine / Equipment Category**: Critical enterprise servers vs. peripheral workstations.
3. **Problem Category**: Complete outage, degraded performance, general inquiry.
4. **Ticket Priority**: `Critical`, `High`, `Medium`, `Low`.

### 2. SLA Metrics Tracked
* **Response Time Target (MTTR - Response)**: Maximum time allowed from ticket creation to initial technician assignment and acknowledgement (`first_response_at`).
* **Resolution Time Target (MTTR - Resolution)**: Maximum time allowed from ticket creation to final resolution (`resolved_at`).
* **SLA Breach Detection**:
  * If `current_time > target_response_deadline` and `first_response_at` is null $\rightarrow$ Flag `response_breached = 1`.
  * If `current_time > target_resolution_deadline` and `resolved_at` is null $\rightarrow$ Flag `resolution_breached = 1`.

### 3. SLA Clock Pausing (`On Hold`)
When a ticket transitions to `On Hold` (status `4`), the SLA resolution clock is temporarily frozen to avoid penalizing technicians for external dependencies (e.g., waiting for parts shipment). The paused duration is accumulated in `tickets.sla_paused_total_seconds` and appended to the resolution deadline upon resumption.

---

## Proof of Completion Verification Workflow

To guarantee operational accountability, technicians cannot directly close tickets without empirical evidence:

```
[Technician]                          [attachment-service]        [ticket-service]            [Approver: Customer/CS]
      |                                        |                          |                                 |
  (1) |--- POST /upload (Photo Proof) -------->|                          |                                 |
      |<-- Return attachment UUID & URL -------|                          |                                 |
      |                                                                   |                                 |
  (2) |--- POST /tickets/{id}/employee-update --------------------------->|                                 |
      |    (status="Proof Submitted", proof_attachment_id, remarks)       |--- Real-time WebSocket Event -->|
      |                                                                   |    (Proof Awaiting Review)      |
      |                                                                   |                                 |
  (3) |                                                                   |<-- PATCH /tickets/{id} ---------|
      |                                                                   |    (review="Accepted"/"Reject") |
      |                                                                   |                                 |
      |                                                                   |-- Case A: Accepted:             |
      |                                                                   |   - Transition to "Resolved"    |
      |                                                                   |   - Set resolved_at timestamp   |
      |                                                                   |                                 |
      |                                                                   |-- Case B: Rejected:             |
      |<-- Push Notification: Rework Needed ------------------------------|   - Transition to "Proof Reject"|
      |                                                                   |   - Store rejection_reason      |
```

---

## Reassignment Protocol

1. **Request Initiation**: An assigned technician may request ticket reassignment if:
   * Issue requires specialized skills outside their scope.
   * Shift or location constraints prevent physical attendance.
2. **Pending State**: The ticket remains in `InProgress` or `Pending Assignment`, and a record is created in `reassignment_requests` with `status = 'pending'`.
3. **Supervisory Review**: A Customer Support (CS) lead or SuperAdmin reviews the request:
   * **Approved**: The current assignment record is marked inactive, the new employee is linked in `ticket_assignments`, and a `TicketChanged` event is broadcast.
   * **Rejected**: The request is marked `rejected` with explanation remarks, and the ticket remains with the original technician.
