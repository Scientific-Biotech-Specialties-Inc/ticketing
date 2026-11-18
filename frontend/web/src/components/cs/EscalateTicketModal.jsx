import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  ArrowUpRight,
  ShieldAlert,
  AlertTriangle,
  User,
  Building2,
  Tag,
  CheckCircle2,
  Clock,
  Layers,
  HelpCircle,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';
import { getEligibleEmployees } from '@/services/ticketService';
import { getEscalationManagers } from '@/utils/escalationManagers';

/**
 * Categorize ticket into Service, IT, or Others
 */
export const resolveCategoryType = (categoryName = '', departmentName = '') => {
  const normCat = String(categoryName || '').toLowerCase();
  const normDept = String(departmentName || '').toLowerCase();

  // Service: Position level rules (L1 -> L2 -> L3)
  if (
    normCat.includes('service') ||
    normCat.includes('machine') ||
    normCat.includes('maintenance') ||
    normCat.includes('radiology') ||
    normCat.includes('biomedical') ||
    normCat.includes('mri') ||
    normCat.includes('x-ray') ||
    normDept.includes('service')
  ) {
    return 'service';
  }

  // IT: Technical role / team rules
  if (
    normCat.includes('it') ||
    normCat.includes('software') ||
    normCat.includes('hardware') ||
    normCat.includes('network') ||
    normCat.includes('system') ||
    normCat.includes('security') ||
    normDept.includes('it')
  ) {
    return 'it';
  }

  // Others: Configured routing target rules
  return 'others';
};

/**
 * TS032: Escalation Modal
 * Escalation goes to the manager of each assigned employee's department, not to a
 * category based target. Two assignees from IT and Service escalate to both managers.
 * The ticket-service resolves and notifies the real recipients; this modal previews them.
 */
export default function EscalateTicketModal({
  isOpen,
  onClose,
  ticket,
  employees = [],
  onConfirmEscalate,
  isEscalating = false,
}) {
  useLockBodyScroll(isOpen);

  const [escalationReason, setEscalationReason] = useState('');
  const [validationError, setValidationError] = useState('');
  const [departmentManagers, setDepartmentManagers] = useState(null);
  const [loadingManagers, setLoadingManagers] = useState(false);

  const categoryName = ticket?.category || ticket?.category_name || '';
  const categoryType = useMemo(
    () => resolveCategoryType(categoryName, ticket?.department || ticket?.department_name || ''),
    [categoryName, ticket?.department, ticket?.department_name]
  );

  const assignees = useMemo(() => {
    if (Array.isArray(ticket?.assigned_employees) && ticket.assigned_employees.length > 0) {
      return ticket.assigned_employees;
    }
    return Array.isArray(ticket?.assigned) ? ticket.assigned : [];
  }, [ticket?.assigned_employees, ticket?.assigned]);

  const ticketKey = ticket?.ticket_ID || ticket?.id;

  // The configured department managers come with the eligibility payload.
  useEffect(() => {
    if (!isOpen || !ticketKey) return undefined;
    let cancelled = false;
    setLoadingManagers(true);
    getEligibleEmployees(ticket)
      .then((data) => { if (!cancelled) setDepartmentManagers(data?.department_managers || null); })
      .catch(() => { if (!cancelled) setDepartmentManagers(null); })
      .finally(() => { if (!cancelled) setLoadingManagers(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, ticketKey]);

  const escalationTargets = useMemo(
    () => getEscalationManagers(assignees, departmentManagers, employees),
    [assignees, departmentManagers, employees]
  );

  useEffect(() => {
    setEscalationReason('');
    setValidationError('');
  }, [isOpen]);

  if (!isOpen || !ticket) return null;

  const hasAssignees = escalationTargets.length > 0;
  const recipients = escalationTargets.filter((t) => t.manager).map((t) => t.manager);

  const handleConfirm = async (e) => {
    e.preventDefault();
    if (!hasAssignees) {
      setValidationError("Assign the ticket before escalating, so it can go to the assignees' department managers.");
      return;
    }
    if (!escalationReason.trim()) {
      setValidationError('Please provide a brief reason or context for this escalation.');
      return;
    }

    setValidationError('');
    await onConfirmEscalate({
      managers: recipients,
      departments: escalationTargets.map((t) => t.department),
      reason: escalationReason.trim(),
      categoryType,
      categoryName,
    });
  };

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px] overscroll-none animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="escalate-modal-title"
    >
      <div className="relative w-full max-w-xl rounded-2xl bg-surface border border-border shadow-modal overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-[#252578] text-white px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white shrink-0">
              <ArrowUpRight className="w-5 h-5 text-rose-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-rose-500/30 text-rose-200 border border-rose-400/30 font-sans">
                  TS032 Escalation
                </span>
                <span className="text-xs text-white/70 font-mono">
                  {ticket.ticket_number || ticket.id}
                </span>
              </div>
              <h3 id="escalate-modal-title" className="text-lg font-bold tracking-tight text-white mt-0.5 font-sans">
                Escalate Ticket
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isEscalating}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleConfirm} className="p-6 overflow-y-auto overscroll-contain space-y-5 flex-1">
          {/* Routing rule */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">
              Escalation Routing
            </span>
            <p className="text-xs text-slate-600 leading-relaxed">
              This ticket escalates to the manager of each assigned employee&apos;s department.
              Assignees from different departments notify every one of those managers.
            </p>
          </div>

          {!hasAssignees ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 flex items-start gap-3 text-rose-900 shadow-xs">
              <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <p className="font-bold text-rose-900">No Assigned Employees</p>
                <p className="text-rose-700 leading-relaxed">
                  Escalation goes to the managers of the assigned employees&apos; departments. Assign the ticket first, then escalate.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Escalation Recipients
                </label>
                <div className="space-y-2" data-testid="escalation-recipients">
                  {escalationTargets.map(({ department, manager }) => (
                    <div
                      key={department}
                      className="p-3 rounded-xl border border-slate-200 bg-white flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0 bg-[#252578] text-white">
                          {manager ? String(manager.name || 'M').charAt(0).toUpperCase() : <Building2 className="w-4 h-4" />}
                        </div>
                        <div className="min-w-0">
                          {loadingManagers && !manager ? (
                            <>
                              <Skeleton className="h-3 w-32 mb-2" />
                              <Skeleton className="h-3 w-24" />
                            </>
                          ) : (
                            <>
                              <p className="text-xs font-bold text-slate-900 truncate">
                                {manager?.name || `${department} Department Manager`}
                              </p>
                              <p className="text-[11px] text-slate-500 truncate">
                                Manager • {department}{manager?.email ? ` • ${manager.email}` : ''}
                              </p>
                            </>
                          )}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">{department}</Badge>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="escalation-reason" className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Reason for Escalation <span className="text-rose-500">*</span>
                  </label>
                  <span className="text-[10px] text-slate-400">
                    {escalationReason.length}/500
                  </span>
                </div>
                <textarea
                  id="escalation-reason"
                  rows={3}
                  maxLength={500}
                  value={escalationReason}
                  onChange={(e) => setEscalationReason(e.target.value)}
                  placeholder="Explain why this ticket is being escalated (e.g. Unresolved fault after diagnosis; needs management attention)..."
                  className="w-full rounded-xl border border-slate-200 bg-page p-3 text-xs text-slate-900 outline-none focus:border-[#2E85D8] focus:ring-1 focus:ring-[#2E85D8] placeholder:text-slate-400"
                  required
                />
              </div>
            </>
          )}

          {/* Validation Error Banner */}
          {validationError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}

          {/* Handoff Notice */}
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 flex items-start gap-2.5 text-xs text-blue-900">
            <Clock className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              Upon confirmation, the ticket moves to <strong>Escalated</strong> and each manager listed above is notified. The assigned employees keep the ticket.
            </p>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isEscalating}
              className="px-4"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isEscalating || !hasAssignees}
              className="bg-[#252578] hover:bg-[#1e1e60] text-white px-5 flex items-center gap-1.5"
            >
              {isEscalating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Escalating...</span>
                </>
              ) : (
                <>
                  <ArrowUpRight className="w-4 h-4" />
                  <span>Confirm Escalation</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
