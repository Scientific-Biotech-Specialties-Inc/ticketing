-- Spec 0050 parity seed (AC-16). Loaded with FOREIGN_KEY_CHECKS=0 into empty tables by:
--   ticket-service  tests/Feature/ParityCaptureTest.php      (captures the golden files)
--   analytics       the slice parity tests                    (compares against them)
-- Time is frozen at 2026-11-20 10:00:00, so "Last 30 Days" is 2026-10-22 00:00 to 2026-11-20 23:59:59.
-- Rows are chosen to hit every SLA outcome (met, breached, open breach, on hold, not due, no SLA,
-- discarded, outside the window), two branches, two technical departments plus an inactive one,
-- a reassignment, inactive staff, CSAT ratings, forecasts and recurring trends.
-- Keep IDs stable: golden files are keyed to them. Ties in the reports sort by ID.

INSERT INTO ticket_statuses (ticket_status_ID, status_name, created_at, updated_at) VALUES
(1, 'Open', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(2, 'In Progress', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(3, 'Resolved', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(4, 'Closed', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(5, 'Escalated', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(6, 'Pending Evaluation', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(7, 'Pending', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(8, 'Reopened', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(9, 'Discarded', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(10, 'Pending Assignment', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(11, 'On Hold', '2026-01-01 00:00:00', '2026-01-01 00:00:00');

INSERT INTO ticket_priorities (priority_ID, priority_name, created_at, updated_at) VALUES
(1, 'Low', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(2, 'Medium', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(3, 'High', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(4, 'Critical', '2026-01-01 00:00:00', '2026-01-01 00:00:00');

INSERT INTO branches (id, slug, name, code, region, is_active, created_at, updated_at) VALUES
(1, 'main', 'Main Branch', 'MAIN', 'NCR', 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(2, 'north', 'North Branch', 'NORTH', 'Luzon', 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00');

-- Service and IT are active (the technical departments); Finance is inactive and must never appear.
INSERT INTO departments (id, name, code, is_active, created_at, updated_at) VALUES
(1, 'Service', 'SVC', 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(2, 'IT', 'IT', 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(3, 'Finance', 'FIN', 0, '2026-01-01 00:00:00', '2026-01-01 00:00:00');

INSERT INTO clients (id, client_name, address, contact_number, email, status, created_at, updated_at) VALUES
(1, 'Parity Clinic', '1 Main Street', '0000001', 'clinic@parity.test', 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(2, 'North Hospital', '2 North Road', '0000002', 'north@parity.test', 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00');

INSERT INTO problem_categories (problem_category_ID, category_name, is_active, is_system_default, created_at, updated_at) VALUES
(1, 'Hardware Failure', 1, 0, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(2, 'Software Error', 1, 0, '2026-01-01 00:00:00', '2026-01-01 00:00:00');

INSERT INTO machines (machine_ID, category_ID, client_ID, branch_id, machine_name, serial_number, model, brand, status, created_at, updated_at) VALUES
(1, 1, 1, 'main', 'Ultrasound X1', 'SN-PARITY-1', 'X1', 'Acme', 'active', '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(2, 1, 2, 'north', 'MRI Scanner M2', 'SN-PARITY-2', 'M2', 'Acme', 'active', '2026-01-01 00:00:00', '2026-01-01 00:00:00');

INSERT INTO employees (emp_id, email, first_name, last_name, role, department, branch, branch_id, is_active, is_ticketing_employee, created_at, updated_at) VALUES
(100, 'parity.super@example.test', 'Sam', 'Super', 'superadmin', 'IT', 'Main Branch', 1, 1, 0, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(101, 'parity.admin@example.test', 'Alice', 'Admin', 'admin', 'IT', 'Main Branch', 1, 1, 0, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(110, 'parity.svc.main@example.test', 'Ben', 'Service', 'Employee', 'Service', 'Main Branch', 1, 1, 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(111, 'parity.it.main@example.test', 'Cara', 'Tech', 'Employee', 'IT', 'Main Branch', 1, 1, 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(120, 'parity.svc.north@example.test', 'Dan', 'North', 'Employee', 'Service', 'North Branch', 2, 1, 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(121, 'parity.idle@example.test', 'Ivy', 'Idle', 'Employee', 'Service', 'Main Branch', 1, 0, 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(130, 'parity.cs@example.test', 'Cy', 'Support', 'Customer Service', 'Customer Service', 'Main Branch', 1, 1, 0, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
(140, 'parity.finance@example.test', 'Fay', 'Ledger', 'Employee', 'Finance', 'Main Branch', 1, 1, 0, '2026-01-01 00:00:00', '2026-01-01 00:00:00');

-- ticket_type_ID 1 is a customer ticket. sla_rule_id 1 marks an SLA source (no slas row is needed to read it).
INSERT INTO tickets (ticket_ID, ticket_number, machine_ID, problem_category_ID, created_by, assigned_to, ticket_type_ID, is_internal, priority_ID, ticket_status_ID, sla_rule_id, response_due_at, resolution_due_at, sla_status, first_response_at, title, description, resolved_at, closed_at, branch_id, created_at, updated_at) VALUES
-- Main: resolved before due (met)
(9001, 'PAR-9001', 1, 1, 1, 110, 1, 0, 2, 3, 1, '2026-11-01 12:00:00', '2026-11-02 08:00:00', 'Compliant', '2026-11-01 09:00:00', 'Probe flicker', 'Image flickers.', '2026-11-01 20:00:00', NULL, '1', '2026-11-01 08:00:00', '2026-11-01 20:00:00'),
-- Main: resolved after due (breached), reassigned from 110 to 111
(9002, 'PAR-9002', 1, 2, 1, 111, 1, 0, 3, 3, 1, '2026-11-05 12:00:00', '2026-11-06 08:00:00', 'Breached', '2026-11-05 13:00:00', 'Console crash', 'Software crashes on boot.', '2026-11-07 10:00:00', NULL, '1', '2026-11-05 08:00:00', '2026-11-07 10:00:00'),
-- Main: closed, resolved before due (met)
(9003, 'PAR-9003', 1, 1, 1, 110, 1, 0, 1, 4, 1, '2026-11-10 12:00:00', '2026-11-12 08:00:00', 'Compliant', '2026-11-10 10:00:00', 'Fan noise', 'Loud fan.', '2026-11-11 15:00:00', '2026-11-12 09:00:00', '1', '2026-11-10 08:00:00', '2026-11-12 09:00:00'),
-- Main: in progress, past due (open breach)
(9004, 'PAR-9004', 1, 2, 1, 111, 1, 0, 4, 2, 1, '2026-11-15 12:00:00', '2026-11-17 08:00:00', 'Breached', '2026-11-15 11:00:00', 'License expired', 'License error.', NULL, NULL, '1', '2026-11-15 08:00:00', '2026-11-17 08:00:00'),
-- Main: on hold, past due (excluded: paused)
(9005, 'PAR-9005', 1, 1, 1, 110, 1, 0, 2, 11, 1, '2026-11-16 12:00:00', '2026-11-18 08:00:00', 'Paused', NULL, 'Waiting on part', 'Part on order.', NULL, NULL, '1', '2026-11-16 08:00:00', '2026-11-16 12:00:00'),
-- Main: open, not yet due, unassigned (excluded: not due)
(9006, 'PAR-9006', NULL, 1, 1, NULL, 1, 0, 1, 1, 1, '2026-11-19 12:00:00', '2026-11-22 08:00:00', 'On Track', NULL, 'New request', 'Needs triage.', NULL, NULL, '1', '2026-11-19 08:00:00', '2026-11-19 08:00:00'),
-- North: resolved before due (met)
(9007, 'PAR-9007', 2, 1, 2, 120, 1, 0, 3, 3, 1, '2026-11-03 12:00:00', '2026-11-04 08:00:00', 'Compliant', '2026-11-03 10:00:00', 'Coil fault', 'Coil warning.', '2026-11-03 18:00:00', NULL, '2', '2026-11-03 08:00:00', '2026-11-03 18:00:00'),
-- North: in progress, past due (open breach)
(9008, 'PAR-9008', 2, 1, 2, 120, 1, 0, 4, 2, 1, '2026-11-12 12:00:00', '2026-11-14 08:00:00', 'Breached', NULL, 'Cooling loss', 'Helium alarm.', NULL, NULL, '2', '2026-11-12 08:00:00', '2026-11-14 08:00:00'),
-- Main: discarded (excluded)
(9009, 'PAR-9009', NULL, 2, 1, NULL, 1, 0, 1, 9, 1, '2026-11-08 12:00:00', '2026-11-09 08:00:00', 'On Track', NULL, 'Duplicate', 'Duplicate of PAR-9002.', NULL, NULL, '1', '2026-11-08 08:00:00', '2026-11-08 09:00:00'),
-- Main: resolved long before the window (outside Last 30 Days)
(9010, 'PAR-9010', 1, 1, 1, 110, 1, 0, 2, 3, 1, '2026-09-15 12:00:00', '2026-09-16 08:00:00', 'Compliant', '2026-09-15 09:00:00', 'Old fault', 'Old.', '2026-09-15 20:00:00', NULL, '1', '2026-09-15 08:00:00', '2026-09-15 20:00:00'),
-- Main: resolved, no SLA source and no due date (excluded: no SLA configured)
(9011, 'PAR-9011', NULL, 2, 1, 111, 1, 0, 1, 3, NULL, NULL, NULL, NULL, NULL, 'Password reset', 'Reset portal password.', '2026-11-18 11:00:00', NULL, '1', '2026-11-18 09:00:00', '2026-11-18 11:00:00'),
-- North: pending assignment, not yet due
(9012, 'PAR-9012', 2, 2, 2, NULL, 1, 0, 2, 10, 1, '2026-11-18 12:00:00', '2026-11-21 08:00:00', 'On Track', NULL, 'Software update', 'Install update.', NULL, NULL, '2', '2026-11-18 08:00:00', '2026-11-18 08:00:00');

INSERT INTO ticket_assignments (assignment_ID, ticket_ID, employee_ID, assigned_by, assignment_status, assigned_at, accepted_at, completed_at, created_at, updated_at) VALUES
(1, 9001, 110, 101, 'completed', '2026-11-01 08:30:00', '2026-11-01 09:00:00', '2026-11-01 20:00:00', '2026-11-01 08:30:00', '2026-11-01 20:00:00'),
(2, 9002, 111, 101, 'completed', '2026-11-06 09:00:00', '2026-11-06 09:30:00', '2026-11-07 10:00:00', '2026-11-06 09:00:00', '2026-11-07 10:00:00'),
(3, 9003, 110, 101, 'completed', '2026-11-10 08:30:00', '2026-11-10 10:00:00', '2026-11-11 15:00:00', '2026-11-10 08:30:00', '2026-11-11 15:00:00'),
(4, 9004, 111, 101, 'accepted', '2026-11-15 08:30:00', '2026-11-15 11:00:00', NULL, '2026-11-15 08:30:00', '2026-11-15 11:00:00'),
(5, 9005, 110, 101, 'accepted', '2026-11-16 08:30:00', '2026-11-16 09:00:00', NULL, '2026-11-16 08:30:00', '2026-11-16 09:00:00'),
(6, 9007, 120, 101, 'completed', '2026-11-03 08:30:00', '2026-11-03 10:00:00', '2026-11-03 18:00:00', '2026-11-03 08:30:00', '2026-11-03 18:00:00'),
(7, 9008, 120, 101, 'assigned', '2026-11-12 08:30:00', NULL, NULL, '2026-11-12 08:30:00', '2026-11-12 08:30:00'),
(8, 9010, 110, 101, 'completed', '2026-09-15 08:30:00', '2026-09-15 09:00:00', '2026-09-15 20:00:00', '2026-09-15 08:30:00', '2026-09-15 20:00:00'),
(9, 9011, 111, 101, 'completed', '2026-11-18 09:30:00', '2026-11-18 10:00:00', '2026-11-18 11:00:00', '2026-11-18 09:30:00', '2026-11-18 11:00:00');

INSERT INTO ticket_assignment_periods (id, ticket_ID, employee_ID, assigned_by, assigned_at, ack_due_at, accepted_at, paused_seconds, ack_paused_seconds, released_at, release_reason, created_at, updated_at) VALUES
(1, 9001, 110, 101, '2026-11-01 08:30:00', '2026-11-01 10:30:00', '2026-11-01 09:00:00', 0, 0, '2026-11-01 20:00:00', 'resolved', '2026-11-01 08:30:00', '2026-11-01 20:00:00'),
(2, 9002, 110, 101, '2026-11-05 08:30:00', '2026-11-05 10:30:00', '2026-11-05 13:00:00', 0, 0, '2026-11-06 09:00:00', 'reassigned', '2026-11-05 08:30:00', '2026-11-06 09:00:00'),
(3, 9002, 111, 101, '2026-11-06 09:00:00', '2026-11-06 11:00:00', '2026-11-06 09:30:00', 0, 0, '2026-11-07 10:00:00', 'resolved', '2026-11-06 09:00:00', '2026-11-07 10:00:00'),
(4, 9003, 110, 101, '2026-11-10 08:30:00', '2026-11-10 10:30:00', '2026-11-10 10:00:00', 0, 0, '2026-11-11 15:00:00', 'resolved', '2026-11-10 08:30:00', '2026-11-11 15:00:00'),
(5, 9004, 111, 101, '2026-11-15 08:30:00', '2026-11-15 10:30:00', '2026-11-15 11:00:00', 0, 0, NULL, NULL, '2026-11-15 08:30:00', '2026-11-15 11:00:00'),
(6, 9005, 110, 101, '2026-11-16 08:30:00', '2026-11-16 10:30:00', '2026-11-16 09:00:00', 3600, 0, NULL, NULL, '2026-11-16 08:30:00', '2026-11-16 12:00:00'),
(7, 9007, 120, 101, '2026-11-03 08:30:00', '2026-11-03 10:30:00', '2026-11-03 10:00:00', 0, 0, '2026-11-03 18:00:00', 'resolved', '2026-11-03 08:30:00', '2026-11-03 18:00:00'),
(8, 9008, 120, 101, '2026-11-12 08:30:00', '2026-11-12 10:30:00', NULL, 0, 0, NULL, NULL, '2026-11-12 08:30:00', '2026-11-12 08:30:00'),
(9, 9010, 110, 101, '2026-09-15 08:30:00', '2026-09-15 10:30:00', '2026-09-15 09:00:00', 0, 0, '2026-09-15 20:00:00', 'resolved', '2026-09-15 08:30:00', '2026-09-15 20:00:00'),
(10, 9011, 111, 101, '2026-11-18 09:30:00', '2026-11-18 11:30:00', '2026-11-18 10:00:00', 0, 0, '2026-11-18 11:00:00', 'resolved', '2026-11-18 09:30:00', '2026-11-18 11:00:00');

INSERT INTO reassignment_requests (request_id, ticket_id, employee_id, reason, deny_reason, status, requested_at, reviewed_at, created_at, updated_at) VALUES
(1, 9002, 110, 'Software issue, needs IT.', NULL, 'approved', '2026-11-06 08:00:00', '2026-11-06 09:00:00', '2026-11-06 08:00:00', '2026-11-06 09:00:00'),
(2, 9004, 111, 'Vendor access needed.', 'Keep working it.', 'denied', '2026-11-16 08:00:00', '2026-11-16 10:00:00', '2026-11-16 08:00:00', '2026-11-16 10:00:00'),
(3, 9008, 120, 'On leave.', NULL, 'pending', '2026-11-13 08:00:00', NULL, '2026-11-13 08:00:00', '2026-11-13 08:00:00');

INSERT INTO customer_feedback (id, ticket_id, customer_id, overall_rating, overall_comment, created_at, updated_at) VALUES
(1, '9001', '1', 5.00, 'Quick fix.', '2026-11-02 09:00:00', '2026-11-02 09:00:00'),
(2, '9002', '1', 2.00, 'Took too long.', '2026-11-08 09:00:00', '2026-11-08 09:00:00'),
(3, '9003', '1', 3.00, 'Fine.', '2026-11-12 10:00:00', '2026-11-12 10:00:00'),
(4, '9003', '1', 4.00, 'Follow up was good.', '2026-11-13 10:00:00', '2026-11-13 10:00:00'),
(5, '9007', '2', 4.00, 'Good.', '2026-11-04 09:00:00', '2026-11-04 09:00:00'),
(6, '9010', '1', 1.00, 'Outside the window.', '2026-09-16 09:00:00', '2026-09-16 09:00:00');

INSERT INTO branch_ticket_forecasts (id, branch_id, forecast_date, predicted_volume, lower_bound, upper_bound, historical_days_used, calculation_status, calculated_at, created_at, updated_at) VALUES
(1, 1, '2026-11-21', 3, 1, 5, 60, 'success', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00'),
(2, 1, '2026-11-22', 2, 0, 4, 60, 'success', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00'),
(3, 1, '2026-11-23', 4, 2, 6, 60, 'success', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00'),
(4, 2, '2026-11-21', 1, 0, 3, 60, 'success', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00'),
(5, 2, '2026-11-22', 2, 0, 4, 60, 'success', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00');

INSERT INTO branch_recurring_issue_trends (id, branch_id, issue_type, item_id, item_name, recent_frequency, baseline_frequency, change_percentage, trend_signal, calculated_at, created_at, updated_at) VALUES
(1, 1, 'category', 1, 'Hardware Failure', 4, 2.00, 100.00, 'rising', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00'),
(2, 1, 'machine', 1, 'Ultrasound X1', 5, 3.00, 66.67, 'rising', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00'),
(3, 2, 'category', 1, 'Hardware Failure', 2, 2.00, 0.00, 'stable', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00');

INSERT INTO forecast_job_runs (id, job_name, branch_id, status, records_processed, duration_ms, completed_at, created_at, updated_at) VALUES
(1, 'tickets:calculate-forecasts', 1, 'success', 30, 120, '2026-11-20 02:00:01', '2026-11-20 02:00:00', '2026-11-20 02:00:01'),
(2, 'tickets:calculate-forecasts', 2, 'success', 30, 110, '2026-11-20 02:00:01', '2026-11-20 02:00:00', '2026-11-20 02:00:01');
