import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Loader2, Search, X, Check, ChevronDown } from 'lucide-react';

/**
 * DecisionCard component for CS Pending Reassignment View
 * Navy 2px border, light #F7F8FD background
 * Requesting employee (avatar, name, department)
 * Reason provided box
 * Reassign to searchable checklist (at least one required, several allowed)
 * Buttons: Approve and reassign (primary, disabled until one is checked), Reject with reason (outlined red)
 */
export default function DecisionCard({
  requestingEmployee, // { name, department, initials }
  reason,
  availableEmployees = [], // [{ id, name, role, department, isSuggested }]
  suggestedEmployeeId = null,
  onApproveAndReassign, // (newEmployeeIds: string[]) => Promise
  onOpenRejectDialog, // () => void
  isProcessing = false,
  className = '',
}) {
  const [selectedIds, setSelectedIds] = useState(() => (suggestedEmployeeId ? [String(suggestedEmployeeId)] : []));
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestionApplied, setSuggestionApplied] = useState(Boolean(suggestedEmployeeId));
  const [isListOpen, setIsListOpen] = useState(false);
  const pickerRef = useRef(null);
  const searchInputRef = useRef(null);

  // Collapse the checklist on outside click or Escape.
  useEffect(() => {
    if (!isListOpen) return undefined;
    const onMouseDown = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setIsListOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setIsListOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    const focusTimer = setTimeout(() => searchInputRef.current?.focus(), 50);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
      clearTimeout(focusTimer);
    };
  }, [isListOpen]);

  // Pre-check the suggested technician once, if it arrives after the first render.
  useEffect(() => {
    if (suggestedEmployeeId && !suggestionApplied) {
      setSelectedIds((prev) => (prev.length === 0 ? [String(suggestedEmployeeId)] : prev));
      setSuggestionApplied(true);
    }
  }, [suggestedEmployeeId, suggestionApplied]);

  const reqName = requestingEmployee?.name || 'Assigned Technician';
  const reqDept = requestingEmployee?.department || 'Service Department';
  const reqInitials = requestingEmployee?.initials ||
    reqName.split(' ').filter(Boolean).map((n) => n[0]).join('').slice(0, 2).toUpperCase() || 'MR';

  const empIdOf = (emp) => String(emp.id || emp.emp_id);

  // Keep only IDs that are still offered (the staff list can refresh while the card is open).
  const validSelectedIds = useMemo(() => {
    const offered = new Set(availableEmployees.map(empIdOf));
    return selectedIds.filter((id) => offered.has(id));
  }, [availableEmployees, selectedIds]);

  const selectedEmployees = useMemo(() => {
    const byId = new Map(availableEmployees.map((e) => [empIdOf(e), e]));
    return validSelectedIds.map((id) => byId.get(id)).filter(Boolean);
  }, [availableEmployees, validSelectedIds]);

  const filteredEmployees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return availableEmployees;
    return availableEmployees.filter((emp) => {
      const name = (emp.name || '').toLowerCase();
      const role = (emp.role || emp.technical_role || emp.position_level || '').toLowerCase();
      const dept = (emp.department || '').toLowerCase();
      const email = (emp.email || '').toLowerCase();
      return name.includes(q) || role.includes(q) || dept.includes(q) || email.includes(q);
    });
  }, [availableEmployees, searchQuery]);

  const toggle = (empId) => {
    setSelectedIds((prev) => (prev.includes(empId) ? prev.filter((id) => id !== empId) : [...prev, empId]));
  };

  const handleApprove = () => {
    if (validSelectedIds.length === 0) return;
    onApproveAndReassign?.(validSelectedIds);
  };

  const isSuggestedEmp = (emp) => emp.isSuggested || String(suggestedEmployeeId) === empIdOf(emp);

  return (
    <div
      className={`border-2 border-[#1E2A78] bg-[#F7F8FD] rounded-xl p-4 sm:p-5 space-y-3.5 shadow-sm transition-all ${className}`}
    >
      {/* Label */}
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-[#1E2A78] inline-block" />
        <h3 className="text-xs font-bold tracking-wider uppercase text-[#1E2A78]">
          DECISION NEEDED · REASSIGNMENT REQUEST
        </h3>
      </div>

      {/* Requesting Employee Row */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-[#1E2A78] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
          {reqInitials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#1B2033] truncate">
            {reqName}
            {reqDept && <span className="text-slate-500 font-normal"> · {reqDept}</span>}
          </p>
          <p className="text-xs text-slate-500">Currently assigned technician</p>
        </div>
      </div>

      {/* Reason Provided Box */}
      <div className="bg-white border border-[#D5D9E4] rounded-lg p-3 text-xs sm:text-sm">
        <span className="text-xs text-slate-500 font-medium block mb-1">
          Reason provided
        </span>
        <p className="text-[#1B2033] font-medium leading-relaxed italic">
          &quot;{reason || 'Specialist tool calibration required beyond standard field kit.'}&quot;
        </p>
      </div>

      {/* Reassign to: searchable multi-select checklist */}
      <div className="space-y-2" role="group" aria-labelledby="reassign-to-label">
        <div className="flex items-center justify-between gap-2">
          <span id="reassign-to-label" className="block text-xs font-semibold text-slate-700">
            Reassign to <span className="text-[#B42318]">*</span>
          </span>
          <span className="text-[11px] text-slate-500" aria-live="polite">
            {validSelectedIds.length === 0
              ? 'Select one or more technicians'
              : `${validSelectedIds.length} selected`}
          </span>
        </div>

        {/* Selected chips */}
        {selectedEmployees.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selectedEmployees.map((emp) => (
              <span
                key={empIdOf(emp)}
                className="inline-flex items-center gap-1 pl-2 pr-1 h-6 rounded-full bg-[#252578]/10 border border-[#252578]/20 text-[11px] font-semibold text-[#252578]"
              >
                <span className="truncate max-w-[140px]">{emp.name}</span>
                <button
                  type="button"
                  onClick={() => toggle(empIdOf(emp))}
                  disabled={isProcessing}
                  className="p-0.5 rounded-full hover:bg-[#252578]/15 cursor-pointer disabled:opacity-50"
                  aria-label={`Remove ${emp.name}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div ref={pickerRef} className="space-y-2">
        {/* Trigger: the checklist opens only when clicked */}
        <button
          type="button"
          onClick={() => setIsListOpen((prev) => !prev)}
          disabled={isProcessing}
          aria-expanded={isListOpen}
          aria-controls="reassign-checklist-panel"
          className={`w-full h-11 px-3 text-xs sm:text-sm bg-white border rounded-lg text-left flex items-center justify-between gap-2 transition-all cursor-pointer disabled:opacity-50 ${
            isListOpen ? 'border-[#2E85D8] ring-2 ring-[#2E85D8]/20' : 'border-[#D5D9E4] hover:border-slate-400'
          }`}
        >
          <span className={validSelectedIds.length > 0 ? 'font-semibold text-[#1B2033]' : 'text-slate-400'}>
            {validSelectedIds.length > 0
              ? `${validSelectedIds.length} technician${validSelectedIds.length > 1 ? 's' : ''} selected`
              : 'Search and select technicians...'}
          </span>
          <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition-transform duration-150 ${isListOpen ? 'rotate-180 text-[#2E85D8]' : ''}`} />
        </button>

        {isListOpen && (
        <div id="reassign-checklist-panel" className="rounded-lg border border-[#D5D9E4] bg-white p-2 shadow-sm">
          {/* Search Input */}
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search staff by name, role, or department..."
              aria-label="Search technicians"
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md outline-none focus:ring-1 focus:ring-[#2E85D8] focus:border-[#2E85D8] text-slate-800 placeholder:text-slate-400"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                title="Clear search"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Checklist */}
          <div className="max-h-36 overflow-y-auto space-y-0.5" role="group" aria-label="Available technicians">
            {availableEmployees.length === 0 ? (
              <div className="p-3 text-center text-xs text-slate-500">
                No other technicians are available for this ticket.
              </div>
            ) : filteredEmployees.length === 0 ? (
              <div className="p-3 text-center text-xs text-slate-500">
                No technicians found matching &quot;{searchQuery}&quot;.
              </div>
            ) : (
              filteredEmployees.map((emp) => {
                const empId = empIdOf(emp);
                const isChecked = validSelectedIds.includes(empId);
                const inputId = `reassign-emp-${empId}`;

                return (
                  <label
                    key={empId}
                    htmlFor={inputId}
                    className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-xs transition-colors cursor-pointer ${
                      isChecked ? 'bg-[#2E85D8]/10' : 'hover:bg-slate-100'
                    }`}
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={isChecked}
                      disabled={isProcessing}
                      onChange={() => toggle(empId)}
                      className="peer sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[#2E85D8]/40 ${
                        isChecked ? 'bg-[#2E85D8] border-[#2E85D8]' : 'bg-white border-slate-300'
                      }`}
                    >
                      {isChecked && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold truncate text-[#1E293B]">{emp.name}</span>
                        {isSuggestedEmp(emp) && (
                          <span className="rounded px-1.5 text-[9px] font-bold bg-indigo-50 border border-indigo-200 text-indigo-700">
                            Suggested
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] truncate text-slate-500">
                        {[emp.role, emp.department, emp.email].filter(Boolean).join(' · ') || 'Specialist'}
                      </p>
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </div>
        )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
        <button
          type="button"
          onClick={handleApprove}
          disabled={validSelectedIds.length === 0 || isProcessing}
          className="flex-1 h-9 px-4 bg-[#1E2A78] hover:bg-[#252578] text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
        >
          {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
          {validSelectedIds.length > 1 ? `Approve and reassign (${validSelectedIds.length})` : 'Approve and reassign'}
        </button>

        <button
          type="button"
          onClick={onOpenRejectDialog}
          disabled={isProcessing}
          className="flex-1 sm:flex-initial h-9 px-4 border border-[#B42318] text-[#B42318] hover:bg-red-50 text-xs font-semibold rounded-lg transition-colors cursor-pointer inline-flex items-center justify-center"
        >
          Reject with reason
        </button>
      </div>
    </div>
  );
}
