<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\TicketController;
use App\Http\Controllers\TicketDashboardController;
use App\Http\Controllers\SuperAdminConfigController;
use App\Http\Controllers\BranchPriorityController;
use App\Http\Controllers\BranchCategoryController;
use App\Http\Controllers\SLARuleController;
use App\Http\Controllers\WorkflowEscalationController;
use App\Http\Controllers\TicketDraftController;
use App\Http\Controllers\TicketReminderController;
use App\Http\Controllers\AdminReportController;
use App\Http\Controllers\TicketTimelineController;
use App\Http\Controllers\EmployeeDashboardController;
use App\Http\Controllers\SuperAdminDashboardController;

/*
|--------------------------------------------------------------------------
| API Routes - Ticket Service
|--------------------------------------------------------------------------
*/

Route::middleware('auth.subsystem')->get('/user', function (Request $request) {
    return $request->user();
});

// ─── Core Ticket Public / Common Endpoints ────────────────────────────────────
// Spec 0043 (AC-15): optional auth so a signed in customer only sees their own registered machines.
Route::middleware('auth.subsystem:optional')->get('/ticket-form-options', [TicketController::class, 'formOptions']);
Route::get('/cs/filter-options', [TicketDashboardController::class, 'csFilterOptions']);
Route::get('/branches', [BranchPriorityController::class, 'publicBranches']);

// ─── Dashboards & Feed Endpoints ─────────────────────────────────────────────
// CS dashboard and incoming queue now live inside the auth.subsystem group below (they expose ticket data).
Route::match(['get', 'post'], '/tickets/check-sla-alerts', function (\App\Services\SLAService $slaService) {
    $result = $slaService->checkAndNotifySlaAlerts();
    return response()->json([
        'status' => 'success',
        'message' => 'SLA alerts checked and dispatched successfully.',
        'data' => $result,
    ]);
});

// ─── Internal Service to Service Endpoints (X-Internal-Token) ────────────────
Route::post('/internal/tickets/{ticketId}/sla/recalculate', [\App\Http\Controllers\InternalSlaController::class, 'recalculate']);
// Spec 0037: attachment-service asks whether the forwarded caller may open a ticket's files.
Route::middleware(['internal.token', 'auth.subsystem'])
    ->get('/internal/attachment-access', [\App\Http\Controllers\InternalAttachmentAccessController::class, 'check']);
// Spec 0047 (AC-7): a customer's pickable equipment and software, for the AI chat.
Route::middleware('internal.token')
    ->get('/internal/customers/{clientId}/assets', [\App\Http\Controllers\InternalCustomerAssetController::class, 'index'])
    ->whereNumber('clientId');
// Spec 0048: employee-service asks whether a hold request is pending before a status change.
Route::middleware('internal.token')
    ->get('/internal/tickets/{ticketId}/hold-requests/pending', [\App\Http\Controllers\HoldRequestController::class, 'pending'])
    ->whereNumber('ticketId');
// Managers a ticket was escalated to; messaging-service lets them join the conversation.
Route::middleware('internal.token')
    ->get('/internal/tickets/{ticketId}/escalation-managers', [\App\Http\Controllers\InternalEscalationParticipantsController::class, 'show'])
    ->whereNumber('ticketId');
// Spec 0048: hold request display state for employee-service ticket lists.
Route::middleware('internal.token')
    ->get('/internal/hold-requests/states', [\App\Http\Controllers\HoldRequestController::class, 'states']);
// TS <-> SERMS reimbursement: SERMS lists tickets and pushes claim status changes.
Route::middleware('internal.serms')
    ->get('/internal/tickets', [\App\Http\Controllers\InternalSermsController::class, 'tickets']);
Route::middleware('internal.serms')
    ->post('/internal/reimbursements/status', [\App\Http\Controllers\InternalSermsController::class, 'reimbursementStatus']);

// PRS -> TS: PRS raises an equipment repair ticket for a staff member who already exists in the
// auth service, so it lands as an internal ticket under that employee. Guarded by the PRS secret
// alone (no customer or staff token is involved), and the read is scoped to PRS-origin tickets.
Route::middleware('internal.prs')->group(function () {
    Route::post('/internal/prs/tickets', [\App\Http\Controllers\InternalPrsController::class, 'store']);
    Route::get('/internal/prs/tickets/{ticketId}', [\App\Http\Controllers\InternalPrsController::class, 'show'])
        ->whereNumber('ticketId');
});

// ─── CRMS Machine Sync (X-Internal-Secret; never on the customer edge) ───────
Route::middleware(['internal.secret', 'throttle:120,1'])->prefix('/internal/crms')->group(function () {
    Route::post('/machines', [\App\Http\Controllers\CrmsMachineSyncController::class, 'store']);
    Route::get('/branches', [\App\Http\Controllers\CrmsMachineSyncController::class, 'branches']);
});

Route::middleware('auth.subsystem')->group(function () {
    // ─── Customer Ticket Drafts (spec 0034: verified customer token only) ────
    Route::post('/tickets/draft', [TicketDraftController::class, 'saveDraft']);
    Route::get('/tickets/drafts', [TicketDraftController::class, 'listDrafts']);
    Route::get('/tickets/drafts/{id}', [TicketDraftController::class, 'getDraft']);
    Route::delete('/tickets/drafts/{id}', [TicketDraftController::class, 'deleteDraft']);

    // ─── Customer Dashboard (Strictly Token Authenticated) ────────────────────
    Route::get('/customer-dashboard', [TicketDashboardController::class, 'customerDashboard']);
    Route::get('/customer/filter-options', [TicketDashboardController::class, 'customerFilterOptions']);

    // ─── CS Dashboard & Incoming Queue (Token Authenticated) ──────────────────
    Route::get('/cs-dashboard', [TicketDashboardController::class, 'csDashboard'])->middleware(['no-cache', 'ticketing.employee']);
    Route::get('/cs-dashboard-summary', [TicketDashboardController::class, 'csDashboardSummary'])->middleware(['no-cache', 'ticketing.employee']);
    Route::get('/cs-incoming', [TicketDashboardController::class, 'csIncoming'])->middleware(['no-cache', 'ticketing.employee']);

    // ─── Admin Branch Dashboard & Reports ─────────────────────────────────────
    Route::get('/admin-dashboard', [TicketDashboardController::class, 'adminDashboard'])->middleware('no-cache');
    Route::get('/admin/dashboard', [TicketDashboardController::class, 'adminDashboard'])->middleware('no-cache');
    // Spec 0031: live summary and breached queue for Service, IT and Customer Service managers.
    Route::get('/manager/dashboard', [\App\Http\Controllers\ManagerDashboardController::class, 'dashboard'])->middleware(['no-cache', 'ticketing.employee']);
    Route::get('/manager/tickets', [\App\Http\Controllers\ManagerDashboardController::class, 'tickets'])->middleware(['no-cache', 'ticketing.employee']);
    Route::get('/admin-reports', [TicketDashboardController::class, 'adminReports'])->middleware('no-cache');
    Route::get('/admin/reports', [TicketDashboardController::class, 'adminReports'])->middleware('no-cache');
    Route::post('/admin/reports/export', [\App\Http\Controllers\ReportExportController::class, 'export'])->middleware(['no-cache', 'throttle:30,1']);
    Route::post('/admin-reports/export', [\App\Http\Controllers\ReportExportController::class, 'export'])->middleware(['no-cache', 'throttle:30,1']);
    Route::get('/admin-reports/employees', [AdminReportController::class, 'employeePerformance'])->middleware('no-cache');
    Route::get('/admin/reports/employees', [AdminReportController::class, 'employeePerformance'])->middleware('no-cache');
    Route::get('/admin-reports/departments', [AdminReportController::class, 'departmentPerformance'])->middleware('no-cache');
    Route::get('/admin/reports/departments', [AdminReportController::class, 'departmentPerformance'])->middleware('no-cache');
    // Predictive insights and the ETL trigger moved to analytics-service (spec 0050 slice 1):
    // /api/ticketing/analytics/insights/predictive and /api/ticketing/analytics/etl/sync.
    Route::get('/superadmin/system-dashboard', [SuperAdminDashboardController::class, 'systemDashboard'])->middleware('no-cache');
    Route::get('/super-admin/system-dashboard', [SuperAdminDashboardController::class, 'systemDashboard'])->middleware('no-cache');
    Route::get('/employee/dashboard', [EmployeeDashboardController::class, 'dashboard'])->middleware(['no-cache', 'ticketing.employee']);
    Route::get('/employee-dashboard', [EmployeeDashboardController::class, 'dashboard'])->middleware(['no-cache', 'ticketing.employee']);

    // ─── Ticket Reminders (TS084) ─────────────────────────────────────────────
    Route::post('/tickets/{ticketId}/reminders', [TicketReminderController::class, 'sendReminder']);
    Route::post('/tickets/{ticketId}/reminder', [TicketReminderController::class, 'sendReminder']);

    // ─── Spec 0038: proof review gate and lightweight ownership lookup ───────
    Route::post('/tickets/{ticketId}/proof-views', [\App\Http\Controllers\TicketProofReviewController::class, 'store'])->whereNumber('ticketId');
    Route::get('/tickets/{ticketId}/ownership', [\App\Http\Controllers\TicketOwnershipController::class, 'show'])->whereNumber('ticketId')->middleware('no-cache');

    // ─── TS <-> SERMS expense reimbursement ──────────────────────────────────
    Route::get('/tickets/{ticketId}/reimbursement', [\App\Http\Controllers\TicketReimbursementController::class, 'show'])->whereNumber('ticketId')->middleware('no-cache');
    Route::post('/tickets/{ticketId}/reimbursement', [\App\Http\Controllers\TicketReimbursementController::class, 'store'])->whereNumber('ticketId')->middleware('throttle:10,1');

    // ─── Core Ticket Lifecycle & Status Transitions ───────────────────────────
    Route::post('/tickets', [TicketController::class, 'store']);
    Route::post('/tickets/internal', [TicketController::class, 'storeInternalTicket']);
    Route::get('/tickets/{ticketId}', [TicketController::class, 'show']);
    Route::match(['put', 'patch'], '/tickets/{ticketId}', [TicketController::class, 'updateTicket']);
    Route::delete('/tickets/{ticketId}', [TicketController::class, 'destroy']);
    Route::post('/tickets/{ticketId}/hold', [TicketController::class, 'holdTicket']);
    // Spec 0048: employee On Hold requests, decided by Customer Service.
    Route::post('/tickets/{ticketId}/hold-requests', [\App\Http\Controllers\HoldRequestController::class, 'store'])->whereNumber('ticketId');
    Route::post('/hold-requests/{id}/cancel', [\App\Http\Controllers\HoldRequestController::class, 'cancel'])->whereNumber('id');
    Route::post('/hold-requests/{id}/approve', [\App\Http\Controllers\HoldRequestController::class, 'approve'])->whereNumber('id');
    Route::post('/hold-requests/{id}/reject', [\App\Http\Controllers\HoldRequestController::class, 'reject'])->whereNumber('id');
    Route::post('/tickets/{ticketId}/resume', [TicketController::class, 'resumeTicket']);
    Route::post('/tickets/{ticketId}/resolve', [TicketController::class, 'resolveTicket']);
    Route::post('/tickets/{ticketId}/close', [TicketController::class, 'closeTicket']);
    Route::post('/tickets/{ticketId}/reopen', [TicketController::class, 'reopenTicket']);
    Route::post('/tickets/{ticketId}/cancel', [TicketController::class, 'cancelTicket']);
    Route::patch('/tickets/{ticketId}/classification', [TicketController::class, 'reclassifyTicket']);
    Route::get('/tickets/{ticketId}/customer-context', [TicketController::class, 'customerContext']);
    Route::get('/tickets/{ticketId}/customer-info', [TicketController::class, 'customerContext']);
    Route::get('/tickets/escalate-handoff/{conversationId}', [TicketController::class, 'escalateHandoff']);
    Route::get('/tickets/{id}/timeline', [TicketTimelineController::class, 'timeline'])->middleware('no-cache');
    Route::post('/tickets/{ticketId}/manager-reassignment/acknowledge', [\App\Http\Controllers\ManagerReassignmentController::class, 'acknowledge'])->whereNumber('ticketId');

    // ─── Staff-Only Internal Notes (TS028) ────────────────────────────────────
    Route::get('/tickets/{ticketId}/internal-notes', [TicketController::class, 'getInternalNotes']);
    Route::post('/tickets/{ticketId}/internal-notes', [TicketController::class, 'addInternalNote']);
    Route::get('/tickets/{ticketId}/notes', [TicketController::class, 'getInternalNotes']);
    Route::post('/tickets/{ticketId}/notes', [TicketController::class, 'addInternalNote']);
    Route::delete('/tickets/{ticketId}/internal-notes/{noteId}', function () {
        return response()->json(['message' => 'Internal notes cannot be deleted to preserve collaboration history integrity.'], 405);
    });
    Route::delete('/tickets/{ticketId}/notes/{noteId}', function () {
        return response()->json(['message' => 'Internal notes cannot be deleted to preserve collaboration history integrity.'], 405);
    });

    // Notification bell routes (GET /notifications, mark read) live in notification-service.

    // ─── SuperAdmin Configuration & Audit Logs ────────────────────────────────
    Route::get('/superadmin/config', [SuperAdminConfigController::class, 'getSuperAdminConfig']);
    Route::get('/superadmin/ticket-limit', [SuperAdminConfigController::class, 'getTicketLimit']);
    Route::put('/superadmin/ticket-limit', [SuperAdminConfigController::class, 'updateTicketLimit']);
    Route::patch('/superadmin/ticket-limit', [SuperAdminConfigController::class, 'updateTicketLimit']);
    Route::post('/superadmin/ticket-limit/reset', [SuperAdminConfigController::class, 'resetTicketLimit']);
    Route::post('/superadmin/equipment', [SuperAdminConfigController::class, 'createSuperAdminEquipment']);
    Route::put('/superadmin/equipment/{id}', [SuperAdminConfigController::class, 'updateSuperAdminEquipment']);
    Route::delete('/superadmin/equipment/{id}', [SuperAdminConfigController::class, 'deleteSuperAdminEquipment']);
    Route::post('/superadmin/ticket-categories', [SuperAdminConfigController::class, 'createSuperAdminTicketCategory']);
    Route::put('/superadmin/ticket-categories/{id}', [SuperAdminConfigController::class, 'updateSuperAdminTicketCategory']);
    Route::delete('/superadmin/ticket-categories/{id}', [SuperAdminConfigController::class, 'deleteSuperAdminTicketCategory']);
    Route::post('/superadmin/priority', [SuperAdminConfigController::class, 'createSuperAdminPriority']);
    Route::put('/superadmin/priority/{id}', [SuperAdminConfigController::class, 'updateSuperAdminPriority']);
    Route::delete('/superadmin/priority/{id}', [SuperAdminConfigController::class, 'deleteSuperAdminPriority']);

    // ─── Branch-specific priority levels & SLA overrides ──────────────────────
    Route::get('/superadmin/branches', [BranchPriorityController::class, 'branches']);
    Route::prefix('/superadmin/branches/{branchId}/priorities')
        ->where(['branchId' => '[a-z0-9\-]{1,64}', 'id' => '[0-9]+'])
        ->group(function () {
            Route::get('/', [BranchPriorityController::class, 'index']);
            Route::post('/', [BranchPriorityController::class, 'store']);
            Route::put('/{id}', [BranchPriorityController::class, 'update']);
            Route::patch('/{id}', [BranchPriorityController::class, 'update']);
            Route::delete('/{id}', [BranchPriorityController::class, 'destroy']);
        });

    // ─── Branch-specific Categories & SLA Policies ───────────────────────────
    Route::prefix('/superadmin/branches/{branchId}/categories')
        ->where(['branchId' => '[a-z0-9\-]{1,64}', 'id' => '[0-9]+'])
        ->group(function () {
            Route::get('/', [BranchCategoryController::class, 'index']);
            Route::post('/', [BranchCategoryController::class, 'storeCategory']);
            Route::put('/{id}', [BranchCategoryController::class, 'updateCategory']);
            Route::patch('/{id}', [BranchCategoryController::class, 'updateCategory']);
            Route::delete('/{id}', [BranchCategoryController::class, 'destroyCategory']);
            Route::post('/reset', [BranchCategoryController::class, 'resetBranch']);
        });

    Route::prefix('/superadmin/branches/{branchId}/sla-policies')
        ->where(['branchId' => '[a-z0-9\-]{1,64}'])
        ->group(function () {
            Route::post('/', [BranchCategoryController::class, 'storeSlaPolicy']);
            Route::delete('/', [BranchCategoryController::class, 'destroySlaPolicy']);
        });
    Route::post('/superadmin/branches/{branchId}/reset', [BranchCategoryController::class, 'resetBranch']);
    Route::get('/superadmin/audit-logs', [SuperAdminConfigController::class, 'getSuperAdminAuditLogs']);
    Route::get('/superadmin/audit-logs/filters', [SuperAdminConfigController::class, 'getAuditLogFilterOptions']);
    Route::get('/superadmin/audit-logs/retention', [SuperAdminConfigController::class, 'getLogRetentionConfig']);
    Route::match(['put', 'post', 'patch'], '/superadmin/audit-logs/retention', [SuperAdminConfigController::class, 'updateLogRetentionConfig']);
    Route::get('/superadmin/audit-logs/retention/impact', [SuperAdminConfigController::class, 'getLogRetentionImpact']);
    Route::post('/superadmin/audit-logs/retention/purge', [SuperAdminConfigController::class, 'purgeAuditLogs']);
    Route::get('/superadmin/audit-logs/retention/history', [SuperAdminConfigController::class, 'getLogRetentionHistory']);
    Route::post('/superadmin/audit-logs/purge', [SuperAdminConfigController::class, 'purgeAuditLogs']);

    Route::prefix('/ticketing/ticket')->group(function () {
        Route::get('/superadmin/audit-logs', [SuperAdminConfigController::class, 'getSuperAdminAuditLogs']);
        Route::get('/superadmin/audit-logs/filters', [SuperAdminConfigController::class, 'getAuditLogFilterOptions']);
        Route::get('/superadmin/audit-logs/retention', [SuperAdminConfigController::class, 'getLogRetentionConfig']);
        Route::match(['put', 'post', 'patch'], '/superadmin/audit-logs/retention', [SuperAdminConfigController::class, 'updateLogRetentionConfig']);
        Route::get('/superadmin/audit-logs/retention/impact', [SuperAdminConfigController::class, 'getLogRetentionImpact']);
        Route::post('/superadmin/audit-logs/retention/purge', [SuperAdminConfigController::class, 'purgeAuditLogs']);
        Route::get('/superadmin/audit-logs/retention/history', [SuperAdminConfigController::class, 'getLogRetentionHistory']);
    });
    Route::get('/superadmin/security-incidents', [SuperAdminConfigController::class, 'getSecurityIncidents']);
    Route::get('/superadmin/security-incidents/{incidentId}', [SuperAdminConfigController::class, 'getSecurityIncidentDetail']);
    Route::get('/superadmin/history', [SuperAdminConfigController::class, 'getSuperAdminHistory']);
    Route::get('/superadmin/window-config', [SuperAdminConfigController::class, 'getWindowConfig']);
    Route::put('/superadmin/window-config', [SuperAdminConfigController::class, 'updateWindowConfig']);
    Route::patch('/superadmin/window-config', [SuperAdminConfigController::class, 'updateWindowConfig']);
    Route::get('/superadmin/number-format', [SuperAdminConfigController::class, 'getNumberFormatConfig']);
    Route::put('/superadmin/number-format', [SuperAdminConfigController::class, 'updateNumberFormatConfig']);
    Route::patch('/superadmin/number-format', [SuperAdminConfigController::class, 'updateNumberFormatConfig']);
    Route::post('/superadmin/number-format/reset', [SuperAdminConfigController::class, 'resetNumberFormatConfig']);
    Route::get('/superadmin/ticket-number-format', [SuperAdminConfigController::class, 'getNumberFormatConfig']);
    Route::put('/superadmin/ticket-number-format', [SuperAdminConfigController::class, 'updateNumberFormatConfig']);
    Route::patch('/superadmin/ticket-number-format', [SuperAdminConfigController::class, 'updateNumberFormatConfig']);
    Route::post('/superadmin/ticket-number-format/reset', [SuperAdminConfigController::class, 'resetNumberFormatConfig']);
    Route::get('/superadmin/recipient-routing', [SuperAdminConfigController::class, 'getNotificationRouting']);
    Route::put('/superadmin/recipient-routing', [SuperAdminConfigController::class, 'updateNotificationRouting']);
    Route::patch('/superadmin/recipient-routing', [SuperAdminConfigController::class, 'updateNotificationRouting']);
    Route::post('/superadmin/recipient-routing/reset', [SuperAdminConfigController::class, 'resetNotificationRouting']);

    Route::get('/superadmin/company-info', [SuperAdminConfigController::class, 'getCompanyInfo']);
    Route::put('/superadmin/company-info', [SuperAdminConfigController::class, 'updateCompanyInfo']);
    Route::patch('/superadmin/company-info', [SuperAdminConfigController::class, 'updateCompanyInfo']);

    Route::get('/superadmin/system-status', [SuperAdminConfigController::class, 'getSystemStatus']);
    Route::put('/superadmin/system-status', [SuperAdminConfigController::class, 'updateSystemStatus']);
    Route::patch('/superadmin/system-status', [SuperAdminConfigController::class, 'updateSystemStatus']);

    Route::get('/superadmin/log-level', [SuperAdminConfigController::class, 'getLogLevel']);
    Route::put('/superadmin/log-level', [SuperAdminConfigController::class, 'updateLogLevel']);
    Route::patch('/superadmin/log-level', [SuperAdminConfigController::class, 'updateLogLevel']);

    Route::get('/superadmin/ticket-defaults', [SuperAdminConfigController::class, 'getTicketDefaultsConfig']);
    Route::put('/superadmin/ticket-defaults', [SuperAdminConfigController::class, 'updateTicketDefaultsConfig']);
    Route::patch('/superadmin/ticket-defaults', [SuperAdminConfigController::class, 'updateTicketDefaultsConfig']);
    Route::post('/superadmin/ticket-defaults/reset', [SuperAdminConfigController::class, 'resetTicketDefaultsConfig']);

    Route::get('/superadmin/defaults', [SuperAdminConfigController::class, 'getTicketDefaultsConfig']);
    Route::put('/superadmin/defaults', [SuperAdminConfigController::class, 'updateTicketDefaultsConfig']);
    Route::patch('/superadmin/defaults', [SuperAdminConfigController::class, 'updateTicketDefaultsConfig']);
    Route::post('/superadmin/defaults/reset', [SuperAdminConfigController::class, 'resetTicketDefaultsConfig']);

    // ─── SuperAdmin SLA Rules ─────────────────────────────────────────────────
    Route::get('/superadmin/sla-rules', [SLARuleController::class, 'index']);
    Route::post('/superadmin/sla-rules', [SLARuleController::class, 'store']);
    Route::post('/superadmin/sla-rules/department/{departmentId}', [SLARuleController::class, 'saveDepartmentRules']);
    Route::post('/superadmin/sla/recalculate-open-tickets', [SLARuleController::class, 'recalculateOpenTickets']);
    Route::get('/superadmin/sla-rules/{id}', [SLARuleController::class, 'show']);
    Route::put('/superadmin/sla-rules/{id}', [SLARuleController::class, 'update']);
    Route::delete('/superadmin/sla-rules/{id}', [SLARuleController::class, 'destroy']);

    // ─── SuperAdmin Workflow Statuses ─────────────────────────────────────────
    Route::get('/superadmin/workflow-statuses', [WorkflowEscalationController::class, 'getWorkflowStatuses']);
    Route::post('/superadmin/workflow-statuses', [WorkflowEscalationController::class, 'storeWorkflowStatus']);
    Route::post('/superadmin/workflow-statuses/reset-defaults', [WorkflowEscalationController::class, 'resetDefaultWorkflowStatuses']);
    Route::put('/superadmin/workflow-statuses/{id}', [WorkflowEscalationController::class, 'updateWorkflowStatus']);
    Route::delete('/superadmin/workflow-statuses/{id}', [WorkflowEscalationController::class, 'destroyWorkflowStatus']);

    // ─── SuperAdmin Escalation Rules ──────────────────────────────────────────
    Route::get('/superadmin/escalation-rules', [WorkflowEscalationController::class, 'getEscalationRules']);
    Route::post('/superadmin/escalation-rules', [WorkflowEscalationController::class, 'storeEscalationRule']);
    Route::put('/superadmin/escalation-rules/{id}', [WorkflowEscalationController::class, 'updateEscalationRule']);
    Route::delete('/superadmin/escalation-rules/{id}', [WorkflowEscalationController::class, 'destroyEscalationRule']);
    Route::patch('/superadmin/escalation-rules/{id}/toggle', [WorkflowEscalationController::class, 'toggleEscalationRule']);

    // ─── SuperAdmin Transition Rules ──────────────────────────────────────────
    Route::get('/superadmin/transition-rules', [SuperAdminConfigController::class, 'getTransitionRules']);
    Route::put('/superadmin/transition-rules', [SuperAdminConfigController::class, 'updateTransitionRules']);
    Route::patch('/superadmin/transition-rules', [SuperAdminConfigController::class, 'updateTransitionRules']);
    Route::post('/superadmin/transition-rules/reset', [SuperAdminConfigController::class, 'resetTransitionRules']);
    Route::get('/superadmin/transitions', [SuperAdminConfigController::class, 'getTransitionRules']);
    Route::put('/superadmin/transitions', [SuperAdminConfigController::class, 'updateTransitionRules']);
    Route::patch('/superadmin/transitions', [SuperAdminConfigController::class, 'updateTransitionRules']);
    Route::post('/superadmin/transitions/reset', [SuperAdminConfigController::class, 'resetTransitionRules']);
});
