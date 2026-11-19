import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Inbox,
  Search,
  RefreshCw,
  UserCheck,
  UserPlus,
  ExternalLink,
  Clock,
  ArrowLeft,
  RotateCcw,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { DataTableSkeleton, DataTableEmptyState } from '@/components/ui/data-table';
import Pagination from '@/components/Pagination';
import { useAuth } from '@/context/AuthContext';
import SlaStatusBadge, { getTicketSlaDueDate, getTicketSlaStatus } from '@/components/sla/SlaStatusBadge';
import { AssignModal } from '@/components/CSModals';
import CustomerTicketDetailModal from '@/components/CustomerTicketDetailModal';
import {
  getManagerTickets,
  getAssignableEmployees,
  assignTicketToEmployees,
} from '@/services/ticketService';
import { cn } from '@/lib/utils';
import { holdRequestDisplayStatus } from '@/utils/holdRequestStatus';

export default function ServiceManagerTickets() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Data state
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filter toolbar state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [assigneeFilter, setAssigneeFilter] = useState('All');
  const [page, setPage] = useState(1);
  const itemsPerPage = 10;

  // Modals state
  const [assignModalTicket, setAssignModalTicket] = useState(null);
  const [assignEmployees, setAssignEmployees] = useState([]);
  const [assignDepartments, setAssignDepartments] = useState([]);
  const [detailModalTicket, setDetailModalTicket] = useState(null);
  const [loadError, setLoadError] = useState('');
  // The signed-in manager: never offered as an assignee to themself.
  const [managerId, setManagerId] = useState(() => Number(user?.emp_id ?? 0) || null);

  // Tickets in this manager's scope (assignee department + branch), decided by the server.
  const loadTickets = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    setLoadError('');
    try {
      const data = await getManagerTickets();
      setTickets(Array.isArray(data?.tickets) ? data.tickets : []);
      if (data?.manager_id) setManagerId(Number(data.manager_id));
    } catch (err) {
      console.error('Failed to load manager tickets:', err);
      setTickets([]);
      setLoadError(err?.response?.data?.message || 'Failed to load your department tickets. Please refresh.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  // Staff directory for the assign modal (it fetches eligibility itself; this list fills in names).
  useEffect(() => {
    getAssignableEmployees({ forceRefresh: false })
      .catch(() => [])
      .then((emps) => {
        setAssignEmployees(
          (emps || []).map((e) => ({
            id: Number(e.id ?? e.emp_id),
            name: e.name || `${e.first_name || ''} ${e.last_name || ''}`.trim() || e.email,
            email: e.email,
            role: e.role,
            department: e.department || 'Service',
          }))
        );
        setAssignDepartments(['IT', 'Customer Service', 'Service']);
      });
  }, []);

  const assignableStaff = useMemo(
    () => assignEmployees.filter((e) => !managerId || Number(e.id) !== Number(managerId)),
    [assignEmployees, managerId]
  );

  // Filtered & Evaluated Tickets
  const evaluatedTickets = useMemo(() => {
    return tickets.map((t) => {
      const assignees = Array.isArray(t.assignees) ? t.assignees : [];
      const isUnassigned = assignees.length === 0;
      const assigneeName = isUnassigned ? 'Unassigned' : assignees.map((a) => a.name).join(', ');
      const dueDate = getTicketSlaDueDate(t);

      return {
        ...t,
        // AssignModal pre-selects these and reads `assigned` as employee ids.
        assigned: assignees.map((a) => a.id),
        isUnassigned,
        assigneeName,
        dueDate,
        isBreached: Boolean(t.is_breached),
        isEscalated: Boolean(t.is_escalated),
        canReassign: Boolean(t.can_reassign),
      };
    });
  }, [tickets]);

  const filteredTickets = useMemo(() => {
    return evaluatedTickets.filter((t) => {
      if (search) {
        const q = search.toLowerCase();
        const matchesId = String(t.id || t.ticket_ID || '').toLowerCase().includes(q);
        const matchesTitle = (t.title || '').toLowerCase().includes(q);
        const matchesDesc = (t.description || '').toLowerCase().includes(q);
        const matchesAssignee = (t.assigneeName || '').toLowerCase().includes(q);
        const matchesCategory = (t.category || '').toLowerCase().includes(q);
        if (!matchesId && !matchesTitle && !matchesDesc && !matchesAssignee && !matchesCategory) {
          return false;
        }
      }

      if (statusFilter !== 'All') {
        const status = (t.status || '').toLowerCase();
        if (statusFilter === 'Pending Assignment' && !t.isUnassigned && !status.includes('pending assignment')) {
          return false;
        }
        if (statusFilter !== 'Pending Assignment' && !status.includes(statusFilter.toLowerCase())) {
          return false;
        }
      }

      if (priorityFilter !== 'All') {
        if ((t.priority || '').toLowerCase() !== priorityFilter.toLowerCase()) {
          return false;
        }
      }

      if (assigneeFilter !== 'All') {
        if (assigneeFilter === 'Unassigned') {
          if (!t.isUnassigned) return false;
        } else {
          if (!t.assigneeName.toLowerCase().includes(assigneeFilter.toLowerCase())) {
            return false;
          }
        }
      }

      return true;
    });
  }, [evaluatedTickets, search, statusFilter, priorityFilter, assigneeFilter]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, priorityFilter, assigneeFilter]);

  const paginatedTickets = useMemo(() => {
    const start = (page - 1) * itemsPerPage;
    return filteredTickets.slice(start, start + itemsPerPage);
  }, [filteredTickets, page, itemsPerPage]);

  const assigneeOptions = useMemo(() => {
    const names = new Set();
    evaluatedTickets.forEach((t) => {
      if (!t.isUnassigned && t.assigneeName && t.assigneeName !== 'Unassigned') {
        names.add(t.assigneeName);
      }
    });
    return Array.from(names);
  }, [evaluatedTickets]);

  const hasActiveFilters = search || statusFilter !== 'All' || priorityFilter !== 'All' || assigneeFilter !== 'All';

  const handleResetFilters = () => {
    setSearch('');
    setStatusFilter('All');
    setPriorityFilter('All');
    setAssigneeFilter('All');
  };

  const PRIORITY_IDS = { Low: 1, Medium: 2, High: 3, Critical: 4 };

  // AssignModal calls onSave(updatedTicket) and closes itself when this resolves truthy.
  const handleAssignSave = async (updated) => {
    const ticketId = Number(updated?.ticket_ID || String(updated?.id || '').replace(/\D/g, ''));
    const employeeIds = (updated?.assigned || []).map(Number).filter(Boolean);
    if (!ticketId || employeeIds.length === 0) return false;

    await assignTicketToEmployees({
      ticketId,
      employeeIds,
      assignedByEmail: user?.email,
      priorityId: PRIORITY_IDS[updated?.priority] ?? undefined,
    });
    // Errors propagate: AssignModal shows the server message (e.g. an ineligible engineer).
    await loadTickets({ silent: true });
    return true;
  };

  return (
    <div className="w-full max-w-full space-y-6">
      {/* Page Header */}
      <PageHeader
        pattern="B"
        title="Service Ticket Queue & Assignment"
        subtitle="Manage assignments, triage incoming equipment service requests, and track technician workload."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/service-manager/dashboard')}
              className="text-xs gap-1.5 cursor-pointer text-[#252578] border-[#252578]/30 hover:bg-[#252578]/5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>SLA Dashboard</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadTickets({ silent: false })}
              disabled={refreshing}
              className="text-xs gap-1.5 cursor-pointer"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
              <span>Refresh</span>
            </Button>
          </div>
        }
      />

      {/* Filter Toolbar Controls */}
      <div className="bg-card rounded-xl border border-border p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search by ticket ID, subject, assignee, equipment..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-border bg-page text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 rounded-lg border border-border bg-page px-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer"
            >
              <option value="All">All Statuses</option>
              <option value="Pending Assignment">Pending Assignment</option>
              <option value="In Progress">In Progress</option>
              <option value="Escalated">Escalated</option>
              <option value="On Hold">On Hold</option>
              <option value="Pending Evaluation">Pending Evaluation</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">Priority:</span>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="h-9 rounded-lg border border-border bg-page px-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer"
            >
              <option value="All">All Priorities</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">Assignee:</span>
            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              className="h-9 rounded-lg border border-border bg-page px-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer"
            >
              <option value="All">All Assignees</option>
              <option value="Unassigned">Unassigned Only</option>
              {assigneeOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          {hasActiveFilters && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetFilters}
              className="h-9 text-xs gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </Button>
          )}
        </div>
      </div>

      {loadError && (
        <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2 text-xs font-semibold text-destructive">
          {loadError}
        </div>
      )}

      {/* Ticket Queue Table Card */}
      <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden min-h-[500px] flex flex-col justify-between">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 border-b border-border">
                <TableHead className="w-28 font-semibold text-xs">Ticket ID</TableHead>
                <TableHead className="min-w-[260px] font-semibold text-xs">Subject &amp; Equipment</TableHead>
                <TableHead className="w-28 font-semibold text-xs">Priority</TableHead>
                <TableHead className="w-32 font-semibold text-xs">Status</TableHead>
                <TableHead className="min-w-[180px] font-semibold text-xs">Assigned Engineer</TableHead>
                <TableHead className="w-36 font-semibold text-xs">SLA Due Date</TableHead>
                <TableHead className="w-36 text-right font-semibold text-xs">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <DataTableSkeleton columns={7} rows={6} />
              ) : filteredTickets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-64 text-center">
                    <DataTableEmptyState
                      title="No Service tickets found"
                      description={hasActiveFilters ? "Try adjusting your search query or status filter." : "The Service ticket queue is currently all caught up."}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                paginatedTickets.map((t) => (
                  <TableRow
                    key={t.id || t.ticket_ID}
                    onClick={() => setDetailModalTicket(t)}
                    className={cn(
                      'cursor-pointer hover:bg-slate-50/80 transition-colors duration-150',
                      t.isBreached && 'bg-rose-50/20 hover:bg-rose-50/40'
                    )}
                  >
                    <TableCell className="font-mono text-xs font-bold text-primary">
                      {t.id || `TKT-${String(t.ticket_ID).padStart(4, '0')}`}
                    </TableCell>

                    <TableCell>
                      <div className="space-y-0.5">
                        <p
                          onClick={() => setDetailModalTicket(t)}
                          className="text-xs font-bold text-foreground hover:text-accent cursor-pointer transition-colors line-clamp-1"
                          title={t.title}
                        >
                          {t.title}
                        </p>
                        <p className="text-[11px] text-muted-foreground line-clamp-1">
                          {t.description || 'No equipment details provided.'}
                        </p>
                      </div>
                    </TableCell>

                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(t.priority)} className="text-[10px]">
                        {t.priority}
                      </Badge>
                    </TableCell>

                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(holdRequestDisplayStatus(t))} className="text-[10px]">
                        {holdRequestDisplayStatus(t, t.status || 'Pending Assignment')}
                      </Badge>
                    </TableCell>

                    <TableCell>
                      {t.isUnassigned ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                          Unassigned
                        </span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full bg-[#252578]/10 text-[#252578] font-bold text-[10px] flex items-center justify-center shrink-0">
                            {t.assigneeName.charAt(0)}
                          </div>
                          <span className="text-xs font-semibold text-foreground truncate max-w-[140px]">
                            {t.assigneeName}
                          </span>
                        </div>
                      )}
                    </TableCell>

                    <TableCell>
                      <SlaStatusBadge ticket={t} dueDate={t.dueDate} />
                    </TableCell>

                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          disabled={!t.canReassign}
                          title={t.canReassign
                            ? (t.isEscalated ? 'Escalated: reassign this ticket' : 'SLA breached: reassign this ticket')
                            : 'Managers can reassign only escalated or SLA-breached tickets'}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!t.canReassign) return;
                            setAssignModalTicket(t);
                          }}
                          className="text-xs h-7 px-2.5 bg-[#252578] hover:bg-[#1d1d60] text-white font-medium gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {t.isUnassigned ? <UserPlus className="w-3 h-3" /> : <UserCheck className="w-3 h-3" />}
                          <span>{t.isUnassigned ? 'Assign' : 'Reassign'}</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {!loading && filteredTickets.length > 0 && (
          <div className="px-4 py-3 border-t border-border bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>
              Showing {(page - 1) * itemsPerPage + 1} to{' '}
              {Math.min(page * itemsPerPage, filteredTickets.length)} of {filteredTickets.length} tickets
            </span>
            <Pagination
              totalItems={filteredTickets.length}
              itemsPerPage={itemsPerPage}
              currentPage={page}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>

      {/* Assignment Modal */}
      {assignModalTicket && (
        <AssignModal
          ticket={assignModalTicket}
          employees={assignableStaff}
          departments={assignDepartments}
          priorityOptions={['Low', 'Medium', 'High', 'Critical']}
          onClose={() => setAssignModalTicket(null)}
          onSave={handleAssignSave}
          excludeEmployeeIds={managerId ? [managerId] : []}
        />
      )}

      {/* Ticket Details Inspection Modal */}
      {detailModalTicket && (
        <CustomerTicketDetailModal
          ticket={detailModalTicket}
          isOpen={Boolean(detailModalTicket)}
          onClose={() => setDetailModalTicket(null)}
        />
      )}
    </div>
  );
}
