<?php

namespace App\Services;

use App\Http\Controllers\EmployeeDirectoryController;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Spec 0051: CS routes a ticket to a whole department; the department's managers triage it.
 *
 * Routing gives every active manager of the department a normal pending ticket_assignments row
 * and records the department on tickets.assigned_department_id. The first manager to act
 * (accept, delegate or return) wins: every action locks the ticket row and requires the caller's
 * own pending row to still be open; the winner closes everyone else's rows, so a late second
 * manager finds their row closed and gets 409.
 *
 * Closed manager rows keep their history with assignment_status = department_closed and
 * completed_at set. No assignment period is opened for a pending manager row, so period based
 * metrics never count manager triage time; the claimer's period opens when they accept.
 */
class DepartmentRoutingService
{
    public const CLOSED_STATUS = 'department_closed';

    public const ACTION_ASSIGNED = 'department_assigned';
    public const ACTION_CLAIMED = 'department_claimed';
    public const ACTION_DELEGATED = 'department_delegated';
    public const ACTION_RETURNED = 'department_returned';
    public const ACTION_REROUTED = 'department_rerouted';

    public const ACTIONS = [
        self::ACTION_ASSIGNED,
        self::ACTION_CLAIMED,
        self::ACTION_DELEGATED,
        self::ACTION_RETURNED,
        self::ACTION_REROUTED,
    ];

    /** Roles allowed to route tickets: the CS assign branch roles, including the head of CS. */
    public const ROUTING_ROLES = [
        'customer service', 'customer support', 'cs', 'head of cs', 'head of customer service', 'cs_manager', 'cs manager',
        'admin', 'superadmin', 'super admin',
    ];

    private const CS_ROLES = ['customer service', 'customer support', 'cs', 'customer'];

    public function __construct(
        protected DepartmentManagerResolver $resolver,
        protected EmployeeAssignmentService $assignments,
        protected TicketNotificationService $notifications,
        protected TicketCacheService $cache,
        protected TicketStateMachine $stateMachine,
        protected AssignmentPeriodRecorder $periods,
    ) {}

    public function canRoute($user): bool
    {
        $role = strtolower(trim((string) ($user->role ?? '')));

        return $user && !($user instanceof \App\Models\Client) && in_array($role, self::ROUTING_ROLES, true);
    }

    /**
     * GET /assignable-departments (AC-3): active departments that accept routed tickets.
     */
    public function assignableDepartments(): array
    {
        $departments = DB::table('departments')
            ->where('is_active', true)
            ->where('accepts_tickets', true)
            ->orderBy('name')
            ->get(['id', 'name', 'code']);

        $counts = $this->resolver->managerCounts($departments->pluck('name')->all());

        return $departments->map(function ($d) use ($counts) {
            $managerCount = $counts[$this->resolver->normalize((string) $d->name)] ?? 0;

            return [
                'id' => (int) $d->id,
                'name' => (string) $d->name,
                'code' => (string) ($d->code ?? ''),
                'manager_count' => $managerCount,
                'routable' => $managerCount > 0,
            ];
        })->values()->all();
    }

    /**
     * POST /tickets/{id}/assign-department (AC-4, AC-5, AC-12).
     *
     * @param  array{department_id:int, priority_ID?:int|null, note?:string|null}  $input
     */
    public function route(int $ticketId, object $actor, array $input): array
    {
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket) {
            return $this->error(404, 'Ticket not found.');
        }

        $department = DB::table('departments')->where('id', (int) $input['department_id'])->first();
        if (!$department || !(bool) $department->is_active || !(bool) ($department->accepts_tickets ?? false)) {
            return $this->error(422, 'This department does not accept routed tickets.', 'DEPARTMENT_NOT_ROUTABLE');
        }

        $managers = $this->resolver->managersFor($department);
        if ($managers->isEmpty()) {
            return $this->error(422, "{$department->name} has no active manager to receive this ticket.", 'DEPARTMENT_HAS_NO_MANAGER');
        }

        if ($ticket->problem_category_ID === null) {
            return $this->error(422, 'Classify this ticket before assigning.', 'NEEDS_CLASSIFICATION');
        }

        $transition = $this->transitionError($ticket, TicketStateMachine::STATE_ASSIGNED);
        if ($transition) {
            return $transition;
        }

        $managerIds = $managers->pluck('emp_id')->map(fn ($id) => (int) $id)->values()->all();
        $note = $this->cleanText($input['note'] ?? null);
        $priorityId = $input['priority_ID'] ?? null;
        $actorId = (int) $actor->emp_id;

        $previousRoute = null;
        $removedMemberIds = [];
        $priorityChanged = false;

        DB::transaction(function () use ($ticketId, $department, $managerIds, $note, $priorityId, $actorId, &$previousRoute, &$removedMemberIds, &$priorityChanged) {
            $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->lockForUpdate()->first();
            $previousRoute = $this->waitingRoute($ticket);

            $open = $this->openRows($ticketId);
            if ($previousRoute) {
                // AC-12: rerouting while the ticket waits in a department queue closes the manager rows.
                $this->closeRows($ticketId, $open->pluck('employee_ID')->all());
                $this->audit($ticketId, self::ACTION_REROUTED, $actorId, [
                    'from_department_id' => (int) $previousRoute->department_id,
                    'from_department' => $previousRoute->department,
                    'to' => 'department',
                    'to_department_id' => (int) $department->id,
                    'to_department' => (string) $department->name,
                    'closed_manager_ids' => $open->pluck('employee_ID')->map(fn ($id) => (int) $id)->values()->all(),
                ]);
            } elseif ($open->isNotEmpty()) {
                // Person routed before: the members come off the ticket, as a CS reassign does today.
                $removedMemberIds = $open->pluck('employee_ID')->map(fn ($id) => (int) $id)->values()->all();
                DB::table('ticket_assignments')
                    ->where('ticket_ID', $ticketId)
                    ->whereIn('employee_ID', $removedMemberIds)
                    ->where('assignment_status', '!=', self::CLOSED_STATUS)
                    ->delete();
                $this->periods->release($ticketId, AssignmentPeriodRecorder::REASON_REASSIGNED, $removedMemberIds);
            }

            foreach ($managerIds as $managerId) {
                DB::table('ticket_assignments')->insert([
                    'ticket_ID' => $ticketId,
                    'employee_ID' => $managerId,
                    'assigned_by' => $actorId,
                    'assignment_status' => 'assigned',
                    'assigned_at' => now(),
                    'completed_at' => null,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }

            $priorityChanged = $priorityId !== null && (int) $priorityId !== (int) $ticket->priority_ID;
            DB::table('tickets')->where('ticket_ID', $ticketId)->update([
                'assigned_to' => $managerIds[0],
                'assigned_department_id' => (int) $department->id,
                'ticket_status_ID' => $this->statusId('pending assignment', TicketStateMachine::STATUS_ID_PENDING_ASSIGNMENT),
                'in_progress_owner' => null,
                'priority_ID' => $priorityChanged ? (int) $priorityId : $ticket->priority_ID,
                'updated_at' => now(),
            ]);

            DB::table('reassignment_requests')
                ->where('ticket_id', $ticketId)
                ->where('status', 'pending')
                ->update(['status' => 'approved', 'reviewed_at' => now(), 'updated_at' => now()]);

            if ($priorityChanged) {
                DB::table('ticket_audit_logs')->insert([
                    'ticket_ID' => $ticketId,
                    'action_type' => 'update',
                    'action_by_ID' => $actorId,
                    'actor_type' => 'employee',
                    'details' => json_encode(['field' => 'priority_ID', 'old' => $ticket->priority_ID, 'new' => (int) $priorityId]),
                    'created_at' => now(),
                ]);
            }

            $this->audit($ticketId, self::ACTION_ASSIGNED, $actorId, [
                'department_id' => (int) $department->id,
                'department' => (string) $department->name,
                'manager_ids' => $managerIds,
                'note' => $note,
            ]);
        });

        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        $context = $this->ticketContext($ticket);
        $actorName = $this->name($actor);

        foreach ($managers as $manager) {
            $message = "Ticket {$context['ref']}: \"{$ticket->title}\" was routed to {$department->name} by {$actorName}. Accept it, assign it to your team, or return it to CS.";
            $this->notifications->notifyRecipient((int) $manager->emp_id, 'employee', 'Ticket Routed to Department', $message, $ticketId, $context['data'] + [
                'type' => 'ticket_department_routed',
                'department_id' => (int) $department->id,
                'department' => (string) $department->name,
            ], 'escalation_delegation');

            $this->notifications->sendTicketEmail(
                (int) $manager->emp_id,
                'Ticket Routed to Department',
                $message,
                $ticketId,
                (string) $ticket->title,
                $context['category'],
                $context['priority'],
                'ticket_department_routed',
                ['department_name' => (string) $department->name, 'routed_by' => $actorName, 'ticket_number' => $context['ref']]
            );
        }

        foreach ($removedMemberIds as $memberId) {
            $this->notifications->notifyRecipient($memberId, 'employee', 'Ticket Reassigned', "Ticket {$context['ref']}: \"{$ticket->title}\" has been reassigned to the {$department->name} department.", $ticketId, $context['data'] + ['type' => 'ticket_unassigned']);
        }

        $previousManagers = $previousRoute ? array_values(array_diff($previousRoute->manager_ids, $managerIds)) : [];
        foreach ($previousManagers as $managerId) {
            $this->notifications->notifyRecipient($managerId, 'employee', 'Ticket Rerouted', "Ticket {$context['ref']}: \"{$ticket->title}\" was rerouted by CS and left your Department queue.", $ticketId, $context['data'] + ['type' => 'ticket_department_rerouted']);
        }

        $this->notifications->broadcastTicketChange('department_assigned', $ticketId, [
            'ticket_id' => $ticketId,
            'assigned_to' => $managerIds[0],
            'assigned_department_id' => (int) $department->id,
            'employee_ids' => $managerIds,
            'removed_employee_ids' => array_values(array_unique(array_merge($removedMemberIds, $previousManagers))),
        ]);

        if ($priorityChanged) {
            $this->assignments->requestSlaRecalculation($ticketId);
        }
        $this->cache->clearTicketCaches();

        return [
            'status' => 200,
            'data' => [
                'message' => "Ticket routed to {$department->name}.",
                'ticket' => DB::table('tickets')->where('ticket_ID', $ticketId)->first(),
                'assigned_department_id' => (int) $department->id,
                'manager_ids' => $managerIds,
            ],
        ];
    }

    /**
     * GET /department-queue (AC-6): tickets routed to the caller's department where the caller
     * still holds an open pending row and no manager has acted yet.
     */
    public function queue(object $actor, int $page = 1, int $perPage = 25): array
    {
        $department = $this->resolver->managedDepartment($actor);
        if (!$department) {
            return $this->error(403, 'Only a department manager has a Department queue.');
        }

        $rows = DB::table('tickets as t')
            ->join('ticket_assignments as ta', function ($join) use ($actor) {
                $join->on('ta.ticket_ID', '=', 't.ticket_ID')
                    ->where('ta.employee_ID', '=', (int) $actor->emp_id)
                    ->whereNull('ta.completed_at')
                    ->where('ta.assignment_status', '=', 'assigned');
            })
            ->leftJoin('problem_categories as pc', 'pc.problem_category_ID', '=', 't.problem_category_ID')
            ->leftJoin('ticket_priorities as tp', 'tp.priority_ID', '=', 't.priority_ID')
            ->where('t.assigned_department_id', (int) $department->id)
            ->where('t.ticket_status_ID', $this->statusId('pending assignment', TicketStateMachine::STATUS_ID_PENDING_ASSIGNMENT))
            ->select('t.*', 'pc.category_name', 'tp.priority_name')
            ->distinct()
            ->orderBy('t.ticket_ID')
            ->get();

        $latest = $this->latestDepartmentEvents($rows->pluck('ticket_ID')->all());
        $rows = $rows->filter(fn ($t) => ($latest[(int) $t->ticket_ID]->action_type ?? null) === self::ACTION_ASSIGNED)->values();

        $total = $rows->count();
        $pageRows = $rows->slice(($page - 1) * $perPage, $perPage)->values();
        $routerIds = $pageRows->map(fn ($t) => (int) $latest[(int) $t->ticket_ID]->action_by_ID)->unique()->values()->all();
        $routers = DB::table('employees')->whereIn('emp_id', $routerIds ?: [0])
            ->selectRaw("emp_id, TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) as name")
            ->pluck('name', 'emp_id');

        $tickets = $pageRows->map(function ($t) use ($latest, $routers, $department) {
            $event = $latest[(int) $t->ticket_ID];
            $details = json_decode((string) $event->details, true) ?: [];

            return [
                'ticket_id' => (int) $t->ticket_ID,
                'ticket_number' => $t->ticket_number ?? $this->ref((int) $t->ticket_ID),
                'title' => (string) $t->title,
                'category' => $t->category_name,
                'priority' => $t->priority_name,
                'sla_label' => $this->assignments->slaLabel($t->created_at, $t),
                'routed_by_id' => (int) $event->action_by_ID,
                'routed_by' => $routers[(int) $event->action_by_ID] ?? 'Customer Service',
                'routed_at' => $event->created_at,
                'note' => $details['note'] ?? null,
                'department_id' => (int) $department->id,
                'department' => (string) $department->name,
            ];
        })->values()->all();

        return [
            'status' => 200,
            'data' => [
                'department' => ['id' => (int) $department->id, 'name' => (string) $department->name],
                'tickets' => $tickets,
                'meta' => [
                    'page' => $page,
                    'per_page' => $perPage,
                    'total' => $total,
                    'last_page' => max(1, (int) ceil($total / $perPage)),
                ],
            ],
        ];
    }

    /**
     * POST /tickets/{id}/department-claim (AC-7, AC-10): the manager takes the ticket.
     */
    public function claim(int $ticketId, object $actor, $user): array
    {
        $outcome = DB::transaction(function () use ($ticketId, $actor) {
            $gate = $this->lockForManager($ticketId, $actor);
            if (isset($gate['status'])) {
                return $gate;
            }
            [$ticket, $route] = $gate;

            if ($error = $this->transitionError($ticket, TicketStateMachine::STATE_IN_PROGRESS_EMPLOYEE)) {
                return $error;
            }

            $actorId = (int) $actor->emp_id;
            $others = $this->openRows($ticketId)->pluck('employee_ID')->map(fn ($id) => (int) $id)
                ->reject(fn ($id) => $id === $actorId)->values()->all();
            $this->closeRows($ticketId, $others);

            DB::table('tickets')->where('ticket_ID', $ticketId)->update(['assigned_to' => $actorId, 'updated_at' => now()]);
            // The claimer's holding period starts now; pending manager time is never a period.
            $this->periods->open($ticketId, $actorId, (int) $route->routed_by_id);

            $this->audit($ticketId, self::ACTION_CLAIMED, $actorId, [
                'department_id' => (int) $route->department_id,
                'department' => $route->department,
                'manager_id' => $actorId,
                'manager_name' => $this->name($actor),
                'closed_manager_ids' => $others,
            ]);

            return ['others' => $others, 'route' => $route];
        });

        if (isset($outcome['status'])) {
            return $outcome;
        }

        // The existing accept flow moves the ticket to In Progress (employee owned) and notifies.
        $accepted = $this->assignments->acceptTicket($ticketId, $user);
        if ($accepted['status'] !== 200) {
            Log::error("Department claim on ticket {$ticketId} closed the other manager rows but accept failed: " . json_encode($accepted['data']));
        }

        $this->broadcastDepartmentChange('department_claimed', $ticketId, (int) $actor->emp_id, [(int) $actor->emp_id], $outcome['others']);
        $this->cache->clearTicketCaches();

        return [
            'status' => $accepted['status'],
            'data' => ['message' => "You claimed this ticket for {$outcome['route']->department}."] + $accepted['data']
                + ['ticket' => DB::table('tickets')->where('ticket_ID', $ticketId)->first()],
        ];
    }

    /**
     * POST /tickets/{id}/department-delegate (AC-8, AC-10): the manager hands the ticket to
     * people in their own department. assigned_department_id stays set.
     *
     * @param  int[]  $employeeIds
     */
    public function delegate(int $ticketId, object $actor, array $employeeIds, ?string $overrideReason): array
    {
        $employeeIds = array_values(array_unique(array_map('intval', $employeeIds)));
        $overrideReason = $this->cleanText($overrideReason);

        $outcome = DB::transaction(function () use ($ticketId, $actor, $employeeIds, $overrideReason) {
            $gate = $this->lockForManager($ticketId, $actor);
            if (isset($gate['status'])) {
                return $gate;
            }
            [$ticket, $route] = $gate;

            if ($error = $this->memberError($ticket, $actor, $employeeIds, $overrideReason)) {
                return $error;
            }
            if ($error = $this->transitionError($ticket, TicketStateMachine::STATE_ASSIGNED)) {
                return $error;
            }

            $managerIds = $this->openRows($ticketId)->pluck('employee_ID')->map(fn ($id) => (int) $id)->values()->all();
            $this->closeRows($ticketId, $managerIds);

            $names = $this->names($employeeIds);
            $this->audit($ticketId, self::ACTION_DELEGATED, (int) $actor->emp_id, [
                'department_id' => (int) $route->department_id,
                'department' => $route->department,
                'manager_id' => (int) $actor->emp_id,
                'manager_name' => $this->name($actor),
                'members' => array_map(fn ($id) => ['id' => $id, 'name' => $names[$id] ?? "Employee #{$id}"], $employeeIds),
                'override_reason' => $overrideReason,
                'closed_manager_ids' => $managerIds,
            ]);

            return ['managers' => $managerIds, 'route' => $route];
        });

        if (isset($outcome['status'])) {
            return $outcome;
        }

        // The existing assignment flow adds the members as pending assignees and notifies them.
        $assigned = $this->assignments->assignTicket($ticketId, ['employee_ids' => $employeeIds], (int) $actor->emp_id);
        if ($assigned['status'] !== 200) {
            Log::error("Department delegate on ticket {$ticketId} closed the manager rows but assignment failed: " . json_encode($assigned['data']));
        }

        $removed = array_values(array_diff($outcome['managers'], $employeeIds));
        $this->broadcastDepartmentChange('department_delegated', $ticketId, (int) $actor->emp_id, $employeeIds, $removed);
        $this->cache->clearTicketCaches();

        return [
            'status' => $assigned['status'],
            'data' => [
                'message' => 'Ticket assigned to your team.',
                'ticket' => DB::table('tickets')->where('ticket_ID', $ticketId)->first(),
                'assignees' => $employeeIds,
            ],
        ];
    }

    /**
     * POST /tickets/{id}/department-return (AC-9, AC-10): back to CS, Open and unassigned.
     * A guarded move inside this service; the shared transition table stays unchanged.
     */
    public function returnToCs(int $ticketId, object $actor, string $reason): array
    {
        $reason = (string) $this->cleanText($reason);
        if (mb_strlen($reason) < 10 || mb_strlen($reason) > 500) {
            return [
                'status' => 422,
                'data' => ['message' => 'Give a reason between 10 and 500 characters.', 'errors' => ['reason' => ['Give a reason between 10 and 500 characters.']]],
            ];
        }

        $outcome = DB::transaction(function () use ($ticketId, $actor, $reason) {
            $gate = $this->lockForManager($ticketId, $actor);
            if (isset($gate['status'])) {
                return $gate;
            }
            [, $route] = $gate;

            $managerIds = $this->openRows($ticketId)->pluck('employee_ID')->map(fn ($id) => (int) $id)->values()->all();
            $this->closeRows($ticketId, $managerIds);

            DB::table('tickets')->where('ticket_ID', $ticketId)->update([
                'ticket_status_ID' => $this->statusId('open', TicketStateMachine::STATUS_ID_OPEN),
                'assigned_to' => null,
                'assigned_department_id' => null,
                'in_progress_owner' => null,
                'updated_at' => now(),
            ]);

            $this->audit($ticketId, self::ACTION_RETURNED, (int) $actor->emp_id, [
                'department_id' => (int) $route->department_id,
                'department' => $route->department,
                'manager_id' => (int) $actor->emp_id,
                'manager_name' => $this->name($actor),
                'reason' => $reason,
                'closed_manager_ids' => $managerIds,
            ]);

            return ['managers' => $managerIds, 'route' => $route];
        });

        if (isset($outcome['status'])) {
            return $outcome;
        }

        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        $context = $this->ticketContext($ticket);
        $route = $outcome['route'];
        $managerName = $this->name($actor);
        $message = "{$route->department} Manager {$managerName} returned Ticket {$context['ref']}: \"{$ticket->title}\" to CS. Reason: {$reason}";
        $data = $context['data'] + [
            'type' => 'ticket_department_returned',
            'department_id' => (int) $route->department_id,
            'department' => $route->department,
            'manager_id' => (int) $actor->emp_id,
            'manager_name' => $managerName,
            'reason' => $reason,
        ];

        // Every CS user, plus the agent who routed it (who may be an admin outside the CS roles).
        $routerId = (int) $route->routed_by_id;
        $this->notifications->notifyCS('Ticket Returned to CS', $message, $ticketId, $data, $routerId, 'reassignment', true);
        $this->notifications->notifyRecipient($routerId, 'employee', 'Ticket Returned to CS', $message, $ticketId, $data, 'reassignment', true);

        $this->broadcastDepartmentChange('department_returned', $ticketId, (int) $actor->emp_id, [], $outcome['managers']);
        $this->cache->clearTicketCaches();

        return [
            'status' => 200,
            'data' => ['message' => 'Ticket returned to CS.', 'ticket' => $ticket],
        ];
    }

    /**
     * CS reroute through POST /assign (AC-12): before CS assigns members directly, close the open
     * manager rows of a ticket still waiting on a department and clear assigned_department_id.
     */
    public function releaseForMemberReroute(int $ticketId, int $actorId): void
    {
        $closed = [];
        DB::transaction(function () use ($ticketId, $actorId, &$closed) {
            $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->lockForUpdate()->first();
            if (!$ticket || empty($ticket->assigned_department_id)) {
                return;
            }

            $route = $this->waitingRoute($ticket);
            if ($route) {
                $closed = $this->openRows($ticketId)->pluck('employee_ID')->map(fn ($id) => (int) $id)->values()->all();
                $this->closeRows($ticketId, $closed);
                $this->audit($ticketId, self::ACTION_REROUTED, $actorId, [
                    'from_department_id' => (int) $route->department_id,
                    'from_department' => $route->department,
                    'to' => 'members',
                    'closed_manager_ids' => $closed,
                ]);
            }

            DB::table('tickets')->where('ticket_ID', $ticketId)->update(['assigned_department_id' => null, 'updated_at' => now()]);
        });

        if (!empty($closed)) {
            $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
            $context = $this->ticketContext($ticket);
            foreach ($closed as $managerId) {
                $this->notifications->notifyRecipient($managerId, 'employee', 'Ticket Rerouted', "Ticket {$context['ref']}: \"{$ticket->title}\" was rerouted by CS and left your Department queue.", $ticketId, $context['data'] + ['type' => 'ticket_department_rerouted']);
            }
        }
    }

    /**
     * The route a ticket is still waiting on: assigned_department_id is set and the latest
     * department event is department_assigned (nobody acted, nobody rerouted). Null otherwise.
     */
    public function waitingRoute(?object $ticket): ?object
    {
        if (!$ticket || empty($ticket->assigned_department_id)) {
            return null;
        }

        $event = $this->latestDepartmentEvents([(int) $ticket->ticket_ID])[(int) $ticket->ticket_ID] ?? null;
        if (!$event || $event->action_type !== self::ACTION_ASSIGNED) {
            return null;
        }

        $route = $this->routeFromEvent($event);

        return (int) $route->department_id === (int) $ticket->assigned_department_id ? $route : null;
    }

    /**
     * Latest department_* audit row per ticket.
     *
     * @param  int[]  $ticketIds
     * @return array<int, object>
     */
    public function latestDepartmentEvents(array $ticketIds): array
    {
        if (empty($ticketIds)) {
            return [];
        }

        $latest = [];
        DB::table('ticket_audit_logs')
            ->whereIn('ticket_ID', $ticketIds)
            ->whereIn('action_type', self::ACTIONS)
            ->orderBy('log_ID')
            ->get(['log_ID', 'ticket_ID', 'action_type', 'action_by_ID', 'details', 'created_at'])
            ->each(function ($row) use (&$latest) {
                $latest[(int) $row->ticket_ID] = $row;
            });

        return $latest;
    }

    /**
     * Lock the ticket and confirm the caller may act as the first manager (AC-10).
     * Returns [ticket, route] or an error result: 403 when the caller was never one of the
     * routed managers, 409 when another person already acted.
     */
    private function lockForManager(int $ticketId, object $actor): array
    {
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->lockForUpdate()->first();
        if (!$ticket) {
            return $this->error(404, 'Ticket not found.');
        }

        $actorId = (int) $actor->emp_id;
        $lastRoute = DB::table('ticket_audit_logs')
            ->where('ticket_ID', $ticketId)
            ->where('action_type', self::ACTION_ASSIGNED)
            ->orderByDesc('log_ID')
            ->first(['log_ID', 'ticket_ID', 'action_type', 'action_by_ID', 'details', 'created_at']);
        $route = $lastRoute ? $this->routeFromEvent($lastRoute) : null;

        $managedDepartment = $this->resolver->managedDepartment($actor);
        if (!$route
            || !in_array($actorId, $route->manager_ids, true)
            || !$managedDepartment
            || (int) $managedDepartment->id !== (int) $route->department_id) {
            return $this->error(403, 'Only a manager this ticket was routed to can act on it.');
        }

        $waiting = $this->waitingRoute($ticket);
        $ownRowOpen = DB::table('ticket_assignments')
            ->where('ticket_ID', $ticketId)
            ->where('employee_ID', $actorId)
            ->whereNull('completed_at')
            ->where('assignment_status', 'assigned')
            ->exists();

        if (!$waiting || !$ownRowOpen) {
            return $this->error(409, 'Another person already acted on this ticket.', 'DEPARTMENT_ALREADY_CLAIMED');
        }

        return [$ticket, $waiting];
    }

    /**
     * AC-8: members must be active people of the manager's own department (not the manager,
     * not CS), eligible for the category track unless an override reason is given.
     */
    private function memberError(object $ticket, object $actor, array $employeeIds, ?string $overrideReason): ?array
    {
        if (in_array((int) $actor->emp_id, $employeeIds, true)) {
            return $this->error(422, 'To work this ticket yourself, use Accept instead.', 'SELF_DELEGATION');
        }

        $query = DB::table('employees')
            ->whereIn('emp_id', $employeeIds)
            ->select('emp_id as id', 'first_name', 'last_name', 'role', 'department', 'position_level', 'technical_role', 'is_active');
        if (Schema::hasColumn('employees', 'branch')) {
            $query->addSelect('branch');
        } elseif (Schema::hasColumn('employees', 'branch_id')) {
            $query->addSelect('branch_id as branch');
        }
        $members = $query->get();

        if ($members->count() !== count($employeeIds) || $members->contains(fn ($m) => !(bool) $m->is_active)) {
            return $this->error(422, 'Every selected person must be an active employee.', 'INACTIVE_EMPLOYEE');
        }

        $dept = $this->resolver->normalize((string) $actor->department);
        if ($members->contains(fn ($m) => $this->resolver->normalize((string) $m->department) !== $dept)) {
            return $this->error(422, "You can only assign people from the {$actor->department} department.", 'OUTSIDE_MANAGER_DEPARTMENT');
        }

        if ($members->contains(fn ($m) => in_array(strtolower(trim((string) $m->role)), self::CS_ROLES, true))) {
            return $this->error(422, 'Customer-service users cannot be assignees.', 'INELIGIBLE_EMPLOYEE');
        }

        $track = EmployeeDirectoryController::resolveCategoryTrack($ticket);
        foreach ($members as $member) {
            $eligibility = EmployeeDirectoryController::checkEligibility($member, $ticket, $track);
            if ($eligibility['eligible']) {
                continue;
            }
            if ($overrideReason === null || $overrideReason === '') {
                return [
                    'status' => 422,
                    'data' => [
                        'message' => 'Give an override reason to assign someone outside the category track.',
                        'code' => 'OVERRIDE_REASON_REQUIRED',
                        'track' => $track,
                        'employee_id' => (int) $member->id,
                        'reason' => $eligibility['reason'],
                    ],
                ];
            }
            Log::warning("Manager [{$actor->email}] bypassed track eligibility for ticket #{$ticket->ticket_ID} (Assignee: {$member->id}). Reason: {$overrideReason}");
        }

        return null;
    }

    private function transitionError(object $ticket, string $target): ?array
    {
        try {
            $this->stateMachine->validateTransition($ticket, $this->stateMachine->resolveState($ticket), $target);
        } catch (\App\Exceptions\InvalidTicketTransitionException $e) {
            return [
                'status' => 422,
                'data' => [
                    'message' => $e->getMessage(),
                    'code' => 'INVALID_TICKET_TRANSITION',
                    'from_status' => $e->fromStatus,
                    'to_status' => $e->toStatus,
                    'allowed_statuses' => $e->allowedStatuses,
                ],
            ];
        }

        return null;
    }

    private function openRows(int $ticketId): Collection
    {
        return DB::table('ticket_assignments')
            ->where('ticket_ID', $ticketId)
            ->whereNull('completed_at')
            ->where('assignment_status', '!=', self::CLOSED_STATUS)
            ->get(['assignment_ID', 'employee_ID']);
    }

    /**
     * @param  array<int, int|string>  $employeeIds
     */
    private function closeRows(int $ticketId, array $employeeIds): void
    {
        if (empty($employeeIds)) {
            return;
        }

        DB::table('ticket_assignments')
            ->where('ticket_ID', $ticketId)
            ->whereIn('employee_ID', array_map('intval', $employeeIds))
            ->whereNull('completed_at')
            ->update(['assignment_status' => self::CLOSED_STATUS, 'completed_at' => now(), 'updated_at' => now()]);
    }

    /**
     * One staff only timeline row per department action (AC-14). The actor's name is copied into
     * details so the history reads correctly after renames, like the department name.
     */
    private function audit(int $ticketId, string $action, int $actorId, array $details): void
    {
        $details['actor_name'] = $details['actor_name'] ?? ($this->names([$actorId])[$actorId] ?? null);

        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => $ticketId,
            'action_type' => $action,
            'event_type' => $action,
            'action_by_ID' => $actorId,
            'actor_type' => 'employee',
            'details' => json_encode($details),
            'is_system' => 0,
            'is_internal' => 1,
            'created_at' => now(),
        ]);
    }

    private function routeFromEvent(object $event): object
    {
        $details = json_decode((string) $event->details, true) ?: [];

        return (object) [
            'department_id' => (int) ($details['department_id'] ?? 0),
            'department' => (string) ($details['department'] ?? 'Department'),
            'manager_ids' => array_map('intval', $details['manager_ids'] ?? []),
            'routed_by_id' => (int) $event->action_by_ID,
            'routed_at' => $event->created_at,
            'note' => $details['note'] ?? null,
        ];
    }

    private function broadcastDepartmentChange(string $action, int $ticketId, int $actorId, array $employeeIds, array $removedIds): void
    {
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        $this->notifications->broadcastTicketChange($action, $ticketId, [
            'ticket_id' => $ticketId,
            'assigned_to' => $ticket->assigned_to ?? null,
            'assigned_department_id' => $ticket->assigned_department_id ?? null,
            'acted_by' => $actorId,
            'employee_ids' => array_values($employeeIds),
            'removed_employee_ids' => array_values($removedIds),
        ]);
    }

    private function ticketContext(object $ticket): array
    {
        $ref = $ticket->ticket_number ?? $this->ref((int) $ticket->ticket_ID);
        $category = (string) (DB::table('problem_categories')->where('problem_category_ID', $ticket->problem_category_ID)->value('category_name') ?? '');
        $priority = (string) (DB::table('ticket_priorities')->where('priority_ID', $ticket->priority_ID)->value('priority_name') ?? '');

        return [
            'ref' => $ref,
            'category' => $category,
            'priority' => $priority,
            'data' => [
                'ticket_id' => (int) $ticket->ticket_ID,
                'ticket_ref' => $ref,
                'title' => (string) $ticket->title,
                'category' => $category,
                'priority' => $priority,
            ],
        ];
    }

    private function statusId(string $name, int $fallback): int
    {
        return (int) (DB::table('ticket_statuses')->whereRaw('LOWER(status_name) = ?', [$name])->value('ticket_status_ID') ?? $fallback);
    }

    private function cleanText(?string $text): ?string
    {
        if ($text === null) {
            return null;
        }
        $clean = trim(strip_tags($text));

        return $clean === '' ? null : mb_substr($clean, 0, 500);
    }

    private function name(object $employee): string
    {
        return trim(($employee->first_name ?? '') . ' ' . ($employee->last_name ?? '')) ?: 'An employee';
    }

    /**
     * @param  int[]  $ids
     * @return array<int, string>
     */
    private function names(array $ids): array
    {
        return DB::table('employees')->whereIn('emp_id', $ids ?: [0])
            ->selectRaw("emp_id, TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) as name")
            ->pluck('name', 'emp_id')
            ->mapWithKeys(fn ($name, $id) => [(int) $id => $name])
            ->all();
    }

    private function ref(int $ticketId): string
    {
        return 'TKT-' . str_pad((string) $ticketId, 4, '0', STR_PAD_LEFT);
    }

    private function error(int $status, string $message, ?string $code = null): array
    {
        return ['status' => $status, 'data' => array_filter(['message' => $message, 'code' => $code])];
    }
}
