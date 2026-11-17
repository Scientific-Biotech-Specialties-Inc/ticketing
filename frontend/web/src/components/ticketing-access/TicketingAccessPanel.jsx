import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Search, ShieldCheck, UserPlus, Users, AlertTriangle, Inbox, ListChecks, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { DataTableSkeleton, DataTablePagination } from '@/components/ui/data-table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/context/ToastContext';
import BranchContext from '@/context/BranchContext';
import {
  getTicketingDepartments,
  saveTicketingDepartments,
  getTicketingEmployees,
  setTicketingEmployee,
  bulkDesignateTicketingEmployees,
} from '@/services/ticketService';

/**
 * Spec 0045: ticketing access.
 *
 * Section 1 (Departments): which auth module departments may handle tickets. Editable by the
 * superadmin only; branch admins see it read only (AC-1, AC-10).
 * Section 2 (Ticketing Employees): who in those departments is designated (AC-5 to AC-9).
 * The server scopes a branch admin to their own branch; this UI only hides the branch filter.
 */

const PER_PAGE = 25;

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'designated', label: 'Ticketing Employee' },
  { value: 'requestor', label: 'Requestor' },
  { value: 'pending', label: 'Not Yet Designated' },
];

const STATUS_BADGE = {
  designated: { label: 'Ticketing Employee', variant: 'medium-success' },
  requestor: { label: 'Requestor', variant: 'medium-muted' },
  pending: { label: 'Not Yet Designated', variant: 'medium-warning' },
};

const SELECT_CLASS =
  'h-10 rounded-lg border border-slate-200 bg-surface px-4 text-sm text-dark-slate shadow-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20';

const errorMessage = (err, fallback) => err?.response?.data?.message || fallback;

// ─── Blocking tickets modal (AC-3, AC-7) ─────────────────────────────────────

export function BlockingTicketsModal({ open, onClose, tickets = [], message }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-dark-slate">
            <AlertTriangle className="h-5 w-5 text-warning" aria-hidden="true" />
            Reassign Open Tickets First
          </DialogTitle>
          <DialogDescription className="text-muted-slate">
            {message || 'These tickets are still open. Reassign them, then try again. Nothing was changed.'}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
          <Table>
            <TableHeader>
              <TableRow className="bg-page">
                <TableHead className="text-th-header">Ticket</TableHead>
                <TableHead className="text-th-header">Title</TableHead>
                <TableHead className="text-th-header">Assignee</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets.map((t) => (
                <TableRow key={`${t.ticket_ID}-${t.assignee_id}`}>
                  <TableCell className="font-semibold text-dark-slate">{t.ticket_number || `#${t.ticket_ID}`}</TableCell>
                  <TableCell className="text-muted-slate">{t.title || 'Untitled'}</TableCell>
                  <TableCell className="text-muted-slate">
                    {t.assignee_name}
                    {t.department ? <span className="block text-xs">{t.department}</span> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Newly enabled departments: add everyone or pick people ──────────────────

/**
 * Shown after a save that switched departments on. For each one the superadmin either adds every
 * active, not yet designated person at once, or jumps to the employee list filtered to that
 * department's Not Yet Designated people to tick them one by one.
 */
export function NewDepartmentsModal({ open, departments = [], onClose, onPick, onAddedAll }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [added, setAdded] = useState({});

  useEffect(() => {
    if (open) setAdded({});
  }, [open]);

  const handleAddAll = async (d) => {
    setBusy(d.department_name);
    try {
      const res = await bulkDesignateTicketingEmployees(d.department_name);
      const count = res?.designated_count ?? 0;
      const nextAdded = { ...added, [d.department_name]: count };
      setAdded(nextAdded);
      toast.success(`${count} people in ${d.department_name} are now ticketing employees.`, 'Saved');
      const remaining = departments.filter((x) => nextAdded[x.department_name] === undefined).length;
      onAddedAll(d.department_name, remaining);
    } catch (err) {
      toast.error(errorMessage(err, `Could not add everyone in ${d.department_name}.`));
    } finally {
      setBusy(null);
    }
  };

  const single = departments.length === 1;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-dark-slate">
            <UserPlus className="h-5 w-5 text-primary" aria-hidden="true" />
            {single ? `Who in ${departments[0].department_name} Handles Tickets?` : 'Who in These Departments Handles Tickets?'}
          </DialogTitle>
          <DialogDescription className="text-muted-slate">
            Turning a department on does not give anyone tickets yet. Add everyone in it now, or pick only the people who should work tickets.
          </DialogDescription>
        </DialogHeader>

        <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
          {departments.map((d) => {
            const waiting = Math.max(0, (d.active_staff_count || 0) - (d.designated_count || 0));
            const doneCount = added[d.department_name];
            return (
              <li
                key={d.department_name}
                className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-page px-4 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-dark-slate">{d.department_name}</p>
                  <p className="text-xs text-muted-slate">
                    {doneCount !== undefined
                      ? `${doneCount} added as ticketing employees`
                      : waiting > 0
                        ? `${waiting} active staff not yet designated`
                        : 'No active staff waiting to be designated'}
                  </p>
                </div>
                {doneCount !== undefined ? (
                  <Badge variant="medium-success">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Added
                  </Badge>
                ) : (
                  <div className="flex gap-2">
                    <Button variant="outline" disabled={waiting === 0 || busy !== null} onClick={() => onPick(d.department_name)}>
                      <ListChecks className="h-4 w-4" aria-hidden="true" />
                      Pick People
                    </Button>
                    <Button
                      disabled={waiting === 0 || (busy !== null && busy !== d.department_name)}
                      loading={busy === d.department_name}
                      onClick={() => handleAddAll(d)}
                    >
                      <UserPlus className="h-4 w-4" aria-hidden="true" />
                      Add Everyone
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy !== null}>
            {Object.keys(added).length === departments.length ? 'Done' : 'Decide Later'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Confirm switching departments off ───────────────────────────────────────

const sameName = (typed, name) => typed.trim().toLowerCase() === String(name).trim().toLowerCase();

/**
 * Switching a department off removes ticketing employee status from everyone in it (AC-4).
 * The superadmin must type each department name to confirm, so a stray click cannot do it.
 * No ticket is deleted: if anyone still holds an open ticket the server refuses with 409 (AC-3).
 */
export function DisableDepartmentsModal({ open, departments = [], saving, onCancel, onConfirm }) {
  const [typed, setTyped] = useState({});

  useEffect(() => {
    if (open) setTyped({});
  }, [open]);

  const allTyped = departments.length > 0 && departments.every((d) => sameName(typed[d.department_name] || '', d.department_name));
  const affected = departments.reduce((sum, d) => sum + (d.designated_count || 0), 0);
  const single = departments.length === 1;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-dark-slate">
            <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />
            {single ? `Turn Off ${departments[0].department_name}?` : `Turn Off ${departments.length} Departments?`}
          </DialogTitle>
          <DialogDescription className="text-muted-slate">
            {affected > 0
              ? `${affected} ${affected === 1 ? 'person loses' : 'people lose'} ticketing employee status and can no longer be assigned tickets. They can still raise and follow their own tickets.`
              : 'Nobody in here is a ticketing employee right now, but new staff will no longer be able to be designated.'}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-slate-200 bg-page px-4 py-2 text-sm text-muted-slate">
          No tickets are deleted. If anyone here still holds an open ticket, nothing is saved and you will see the tickets to reassign first.
          Turning the department back on later does not restore who was designated.
        </div>

        <ul className="flex max-h-72 flex-col gap-4 overflow-y-auto">
          {departments.map((d) => {
            const id = `ta-confirm-${d.department_name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
            return (
              <li key={d.department_name} className="flex flex-col gap-2">
                <label htmlFor={id} className="text-sm text-dark-slate">
                  Type <span className="font-semibold">{d.department_name}</span> to confirm
                  <span className="block text-xs text-muted-slate">{d.designated_count || 0} designated · {d.active_staff_count || 0} active staff</span>
                </label>
                <Input
                  id={id}
                  autoComplete="off"
                  spellCheck={false}
                  value={typed[d.department_name] || ''}
                  disabled={saving}
                  onChange={(e) => setTyped((prev) => ({ ...prev, [d.department_name]: e.target.value }))}
                />
              </li>
            );
          })}
        </ul>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button variant="destructive" disabled={!allTyped} loading={saving} onClick={onConfirm}>
            {single ? 'Turn Off Department' : 'Turn Off Departments'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Section 1: Departments ──────────────────────────────────────────────────

function DepartmentsSection({ canEdit, departments, loading, onSaved, onBlocked }) {
  const toast = useToast();
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState([]);

  useEffect(() => {
    setDraft(Object.fromEntries(departments.map((d) => [d.department_name, d.is_enabled])));
  }, [departments]);

  const dirty = departments.some((d) => draft[d.department_name] !== undefined && draft[d.department_name] !== d.is_enabled);

  // Switching any department off needs a typed confirmation first.
  const requestSave = () => {
    const turningOff = departments.filter((d) => d.is_enabled && !draft[d.department_name]);
    if (turningOff.length > 0) {
      setConfirmDisable(turningOff);
      return;
    }
    handleSave();
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = departments.map((d) => ({ department_name: d.department_name, is_enabled: Boolean(draft[d.department_name]) }));
      const newlyEnabled = departments.filter((d) => !d.is_enabled && draft[d.department_name]).map((d) => d.department_name);
      const saved = await saveTicketingDepartments(payload);
      toast.success('Ticketing departments saved.', 'Saved');
      onSaved(saved, newlyEnabled);
    } catch (err) {
      if (err?.response?.status === 409) {
        onBlocked(err.response.data);
      } else {
        toast.error(errorMessage(err, 'Could not save the departments. Try again.'));
      }
    } finally {
      setSaving(false);
      setConfirmDisable([]);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-surface p-6 shadow-sm" aria-labelledby="ta-departments-title">
      <DisableDepartmentsModal
        open={confirmDisable.length > 0}
        departments={confirmDisable}
        saving={saving}
        onCancel={() => setConfirmDisable([])}
        onConfirm={handleSave}
      />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="ta-departments-title" className="flex items-center gap-2 text-base font-semibold text-dark-slate">
            <Building2 className="h-5 w-5 text-primary" aria-hidden="true" />
            Handler Departments
          </h3>
          <p className="mt-2 text-sm text-muted-slate">
            {canEdit
              ? 'Turn on the departments whose staff may work tickets. Staff in other departments can still raise their own tickets.'
              : 'Departments whose staff may work tickets. Only a superadmin can change this list.'}
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={!dirty || saving}
              onClick={() => setDraft(Object.fromEntries(departments.map((d) => [d.department_name, d.is_enabled])))}
            >
              Discard
            </Button>
            <Button onClick={requestSave} disabled={!dirty} loading={saving}>
              Save Changes
            </Button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : departments.length === 0 ? (
        <p className="text-sm text-muted-slate">No departments found yet. They appear once staff sync from the auth module.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {departments.map((d) => {
            const on = Boolean(draft[d.department_name]);
            return (
              <li
                key={d.department_name}
                className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-page px-4 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-dark-slate">{d.department_name}</p>
                  <p className="text-xs text-muted-slate">
                    {d.active_staff_count} active staff · {d.designated_count} designated
                  </p>
                </div>
                {canEdit ? (
                  <Switch
                    checked={on}
                    label={`Allow ${d.department_name} to handle tickets`}
                    onCheckedChange={(next) => setDraft((prev) => ({ ...prev, [d.department_name]: next }))}
                  />
                ) : (
                  <Badge variant={on ? 'medium-success' : 'medium-muted'}>{on ? 'Enabled' : 'Disabled'}</Badge>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ─── Section 2: Ticketing Employees ──────────────────────────────────────────

function EmployeesSection({ isSuperAdmin, enabledDepartments, refreshKey, focusRequest, onChanged, onBlocked, onPendingCount }) {
  const toast = useToast();
  const branchCtx = useContext(BranchContext);
  const branches = (branchCtx?.branches || []).filter((b) => b && b.id !== null && b.id !== undefined);
  const sectionRef = useRef(null);

  const [filters, setFilters] = useState({ department: '', branchId: '', status: '', search: '' });
  const [searchInput, setSearchInput] = useState('');

  // From the new departments modal: "Pick People" shows that department's Not Yet Designated staff,
  // "Add Everyone" shows who was just designated. Then slide down to this section.
  useEffect(() => {
    if (!focusRequest) return undefined;
    setSearchInput('');
    setFilters({ department: focusRequest.department, branchId: '', status: focusRequest.status || 'pending', search: '' });
    setPage(1);
    // Wait for the dialog to finish closing: it locks page scroll and returns focus to Save Changes,
    // which would cancel a scroll started any earlier.
    const t = setTimeout(() => {
      sectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }, 350);
    return () => clearTimeout(t);
  }, [focusRequest]);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ data: [], total: 0, last_page: 1 });
  const [loading, setLoading] = useState(true);
  const [busyRow, setBusyRow] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Debounce the name or email search.
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.search === searchInput.trim() ? f : { ...f, search: searchInput.trim() }));
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getTicketingEmployees({ ...filters, page, perPage: PER_PAGE });
      setResult({ data: data?.data || [], total: data?.total || 0, last_page: data?.last_page || 1 });
      onPendingCount(data?.pending_count || 0);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not load ticketing employees.'));
    } finally {
      setLoading(false);
    }
  }, [filters, page, onPendingCount, toast]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const updateFilter = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  const handleToggle = async (row, next) => {
    setBusyRow(row.emp_id);
    try {
      await setTicketingEmployee(row.emp_id, next);
      toast.success(next ? `${row.name} is now a ticketing employee.` : `${row.name} is now a requestor.`, 'Saved');
      onChanged();
    } catch (err) {
      if (err?.response?.status === 409) {
        onBlocked(err.response.data);
      } else {
        toast.error(errorMessage(err, 'Could not update this person.'));
      }
    } finally {
      setBusyRow(null);
    }
  };

  const handleBulk = async () => {
    if (!filters.department) return;
    setBulkBusy(true);
    try {
      const res = await bulkDesignateTicketingEmployees(filters.department);
      toast.success(`${res?.designated_count ?? 0} people in ${filters.department} are now ticketing employees.`, 'Saved');
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not add everyone in this department.'));
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <section ref={sectionRef} className="scroll-mt-6 rounded-xl border border-slate-200 bg-surface p-6 shadow-sm" aria-labelledby="ta-employees-title">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="ta-employees-title" className="flex items-center gap-2 text-base font-semibold text-dark-slate">
            <Users className="h-5 w-5 text-primary" aria-hidden="true" />
            Ticketing Employees
          </h3>
          <p className="mt-2 text-sm text-muted-slate">
            Only people turned on here can be assigned tickets. Everyone else can still raise and follow their own tickets.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleBulk}
          disabled={!filters.department}
          loading={bulkBusy}
          title={filters.department ? undefined : 'Pick a department first'}
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Add Everyone in This Department
        </Button>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-slate" aria-hidden="true" />
          <Input
            aria-label="Search by name or email"
            placeholder="Search name or email"
            className="pl-10"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <select aria-label="Department" className={SELECT_CLASS} value={filters.department} onChange={(e) => updateFilter('department', e.target.value)}>
          <option value="">All Enabled Departments</option>
          {enabledDepartments.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        {isSuperAdmin ? (
          <select aria-label="Branch" className={SELECT_CLASS} value={filters.branchId} onChange={(e) => updateFilter('branchId', e.target.value)}>
            <option value="">All Branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        ) : (
          <div className="flex h-10 items-center rounded-lg border border-slate-200 bg-page px-4 text-sm text-muted-slate">
            Your branch only
          </div>
        )}
        <select aria-label="Status" className={SELECT_CLASS} value={filters.status} onChange={(e) => updateFilter('status', e.target.value)}>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <Table>
          <TableHeader>
            <TableRow className="bg-page">
              <TableHead className="text-th-header">Name</TableHead>
              <TableHead className="text-th-header">Department</TableHead>
              <TableHead className="text-th-header">Branch</TableHead>
              <TableHead className="text-th-header">Ticketing Role</TableHead>
              <TableHead className="text-th-header">Status</TableHead>
              <TableHead className="text-right text-th-header">Ticketing Employee</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <DataTableSkeleton columns={6} rows={5} />
            ) : result.data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center">
                  <Inbox className="mx-auto mb-2 h-8 w-8 text-th-header" aria-hidden="true" />
                  <p className="text-sm text-muted-slate">
                    {enabledDepartments.length === 0
                      ? 'No department handles tickets yet. Enable one above first.'
                      : 'No staff match these filters.'}
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              result.data.map((row) => {
                const badge = STATUS_BADGE[row.designation_status] || STATUS_BADGE.pending;
                return (
                  <TableRow key={row.emp_id}>
                    <TableCell>
                      <p className="font-semibold text-dark-slate">{row.name || row.email}</p>
                      <p className="text-xs text-muted-slate">{row.email}</p>
                    </TableCell>
                    <TableCell className="text-muted-slate">{row.department || 'None'}</TableCell>
                    <TableCell className="text-muted-slate">{row.branch || 'None'}</TableCell>
                    <TableCell className="text-muted-slate">{row.ticketing_role}</TableCell>
                    <TableCell>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Switch
                        checked={row.is_ticketing_employee}
                        disabled={busyRow === row.emp_id}
                        label={`${row.name || row.email} is a ticketing employee`}
                        onCheckedChange={(next) => handleToggle(row, next)}
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <DataTablePagination
        currentPage={page}
        totalPages={result.last_page}
        totalItems={result.total}
        pageSize={PER_PAGE}
        onPageChange={setPage}
      />
    </section>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export default function TicketingAccessPanel({ isSuperAdmin = false, onPendingCountChange }) {
  const toast = useToast();
  const [departments, setDepartments] = useState([]);
  const [deptLoading, setDeptLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingCount, setPendingCountState] = useState(0);
  const [blocked, setBlocked] = useState(null);
  const [newDepartments, setNewDepartments] = useState([]);
  const [focusRequest, setFocusRequest] = useState(null);

  const setPendingCount = useCallback((count) => {
    setPendingCountState(count);
    onPendingCountChange?.(count);
  }, [onPendingCountChange]);

  const loadDepartments = useCallback(async () => {
    setDeptLoading(true);
    try {
      setDepartments(await getTicketingDepartments());
    } catch (err) {
      toast.error(errorMessage(err, 'Could not load ticketing departments.'));
    } finally {
      setDeptLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadDepartments();
  }, [loadDepartments]);

  const enabledDepartments = useMemo(
    () => departments.filter((d) => d.is_enabled).map((d) => d.department_name),
    [departments]
  );

  const handleChanged = useCallback(() => {
    setRefreshKey((k) => k + 1);
    loadDepartments();
  }, [loadDepartments]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
        <p className="text-sm text-muted-slate">Superadmin and admin accounts are never affected by these settings.</p>
        {pendingCount > 0 && (
          <Badge variant="medium-warning">{pendingCount} Not Yet Designated</Badge>
        )}
      </div>

      <DepartmentsSection
        canEdit={isSuperAdmin}
        departments={departments}
        loading={deptLoading}
        onSaved={(saved, newlyEnabled = []) => {
          setDepartments(saved);
          setRefreshKey((k) => k + 1);
          const names = new Set(newlyEnabled);
          const fresh = (saved || []).filter((d) => names.has(d.department_name) && d.is_enabled);
          if (fresh.length > 0) setNewDepartments(fresh);
        }}
        onBlocked={setBlocked}
      />

      <EmployeesSection
        isSuperAdmin={isSuperAdmin}
        enabledDepartments={enabledDepartments}
        refreshKey={refreshKey}
        focusRequest={focusRequest}
        onChanged={handleChanged}
        onBlocked={setBlocked}
        onPendingCount={setPendingCount}
      />

      <BlockingTicketsModal
        open={Boolean(blocked)}
        onClose={() => setBlocked(null)}
        tickets={blocked?.blocking_tickets || []}
        message={blocked?.message}
      />

      <NewDepartmentsModal
        open={newDepartments.length > 0}
        departments={newDepartments}
        onClose={() => setNewDepartments([])}
        onAddedAll={(department, remaining) => {
          handleChanged();
          if (remaining === 0) {
            setNewDepartments([]);
            setFocusRequest({ department, status: 'designated', nonce: Date.now() });
          }
        }}
        onPick={(department) => {
          setNewDepartments([]);
          setFocusRequest({ department, status: 'pending', nonce: Date.now() });
        }}
      />
    </div>
  );
}
