-- Spec 0050 slice 1 parity fixture: stored forecast rows and recurring issue trends.
--
-- Loaded on top of parity_seed.sql. parity_seed.sql alone holds only 7 days of ticket history, so a
-- predictive insights call on it always lands in the insufficient_data branch. These rows exercise the
-- success branch instead: 7 future rows per branch for the frozen date (2026-11-20), so neither the old
-- ticket-service endpoint nor analytics' top up recalculates anything when called without force_refresh,
-- and the response is shaped purely from what is stored here.
--
-- IDs are explicit so the `id` field of each trend row is the same in every test database.
-- change_percentage values are distinct per branch and issue type, so the ORDER BY has no ties.
-- It replaces parity_seed.sql's own forecast and trend rows (only 3 future rows, which would force a top up).

DELETE FROM branch_ticket_forecasts;
DELETE FROM branch_recurring_issue_trends;

INSERT INTO branch_ticket_forecasts (id, branch_id, forecast_date, predicted_volume, lower_bound, upper_bound, historical_days_used, calculation_status, calculated_at, created_at, updated_at) VALUES
(9001, 1, '2026-11-20', 12, 9, 15, 30, 'success', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00'),
(9002, 1, '2026-11-21', 6, 4, 8, 30, 'success', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00'),
(9003, 1, '2026-11-22', 4, 2, 6, 30, 'success', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00'),
(9004, 1, '2026-11-23', 14, 11, 17, 30, 'success', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00'),
(9005, 1, '2026-11-24', 16, 13, 19, 30, 'success', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00'),
(9006, 1, '2026-11-25', 13, 10, 16, 30, 'success', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00'),
(9007, 1, '2026-11-26', 11, 8, 14, 30, 'success', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00'),
(9011, 2, '2026-11-20', 5, 3, 7, 21, 'success', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00'),
(9012, 2, '2026-11-21', 2, 1, 3, 21, 'success', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00'),
(9013, 2, '2026-11-22', 1, 0, 2, 21, 'success', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00'),
(9014, 2, '2026-11-23', 6, 4, 8, 21, 'success', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00'),
(9015, 2, '2026-11-24', 7, 5, 9, 21, 'success', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00'),
(9016, 2, '2026-11-25', 5, 3, 7, 21, 'success', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00'),
(9017, 2, '2026-11-26', 4, 2, 6, 21, 'success', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00'),
-- A past row, which every read must ignore.
(9020, 1, '2026-11-19', 99, 90, 110, 30, 'success', '2026-11-19 02:00:00', '2026-11-19 02:00:00', '2026-11-19 02:00:00');

INSERT INTO branch_recurring_issue_trends (id, branch_id, issue_type, item_id, item_name, recent_frequency, baseline_frequency, change_percentage, trend_signal, calculated_at, created_at, updated_at) VALUES
(9101, 1, 'category', 1, 'Hardware Failure', 9, 4.67, 92.72, 'increasing', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00'),
(9102, 1, 'category', 2, 'Software Error', 3, 3.27, -8.26, 'stable', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00'),
(9103, 1, 'machine', 1, 'Ultrasound X1', 5, 2.00, 150.00, 'increasing', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00'),
(9104, 2, 'category', 1, 'Hardware Failure', 2, 2.80, -28.57, 'decreasing', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00'),
(9105, 2, 'machine', 2, 'MRI Scanner M2', 4, 0.00, 100.00, 'increasing', '2026-11-20 02:00:00', '2026-11-20 02:00:00', '2026-11-20 02:00:00');
