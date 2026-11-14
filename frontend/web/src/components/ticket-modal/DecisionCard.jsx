import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Loader2, Search, X, ChevronDown, Check, User } from 'lucide-react';

/**
 * DecisionCard component for CS Pending Reassignment View
 * Navy 2px border, light #F7F8FD background
 * Requesting employee (avatar, name, department)
 * Reason provided box
 * Reassign to searchable dropdown (required)
 * Buttons: Approve and reassign (primary, disabled until selected), Reject with reason (outlined red)
 */
export default function DecisionCard({
  requestingEmployee, // { name, department, initials }
  reason,
  availableEmployees = [], // [{ id, name, role, department, isSuggested }]
  suggestedEmployeeId = null,
  onApproveAndReassign, // (newEmployeeId) => Promise
  onOpenRejectDialog, // () => void
  isProcessing = false,
  className = '',
}) {
  const [selectedEmpId, setSelectedEmpId] = useState(suggestedEmployeeId || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const searchInputRef = useRef(null);

  useEffect(() => {
    if (suggestedEmployeeId && !selectedEmpId) {
      setSelectedEmpId(String(suggestedEmployeeId));
    }
  }, [suggestedEmployeeId, selectedEmpId]);

  // Close dropdown on outside click or escape
  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') setIsOpen(false);
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const reqName = requestingEmployee?.name || 'Assigned Technician';
  const reqDept = requestingEmployee?.department || 'Service Department';
  const reqInitials = requestingEmployee?.initials ||
    reqName.split(' ').filter(Boolean).map((n) => n[0]).join('').slice(0, 2).toUpperCase() || 'MR';

  const selectedEmp = useMemo(() => {
    return availableEmployees.find((e) => String(e.id || e.emp_id) === String(selectedEmpId)) || null;
  }, [availableEmployees, selectedEmpId]);

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

  const handleApprove = () => {
    if (!selectedEmpId) return;
    onApproveAndReassign?.(selectedEmpId);
  };

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

      {/* Searchable Reassign to Select */}
      <div className="space-y-1.5 relative" ref={containerRef}>
        <label
          htmlFor="reassign-select"
          className="block text-xs font-semibold text-slate-700"
        >
          Reassign to <span className="text-[#B42318]">*</span>
        </label>

        {/* Hidden accessible select to maintain test and assistive compatibility */}
        <select
          id="reassign-select"
          value={selectedEmpId}
          onChange={(e) => setSelectedEmpId(e.target.value)}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        >
          <option value="" disabled>Select available technician...</option>
          {availableEmployees.map((emp) => {
            const empId = String(emp.id || emp.emp_id);
            const isSuggested = emp.isSuggested || String(suggestedEmployeeId) === empId;
            return (
              <option key={empId} value={empId}>
                {emp.name} · {[emp.role, emp.department].filter(Boolean).join(' · ') || 'Specialist'} {isSuggested ? '(suggested)' : ''}
              </option>
            );
          })}
        </select>

        {/* Custom Searchable Trigger */}
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className={`w-full h-11 px-3 text-xs sm:text-sm bg-white border rounded-lg text-left flex items-center justify-between gap-2 transition-all cursor-pointer ${
            isOpen
              ? 'border-[#2E85D8] ring-2 ring-[#2E85D8]/20'
              : 'border-[#D5D9E4] hover:border-slate-400'
          }`}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
        >
          {selectedEmp ? (
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold text-[#1B2033] truncate">{selectedEmp.name}</span>
              <span className="text-xs text-slate-500 truncate">
                · {[selectedEmp.role, selectedEmp.department].filter(Boolean).join(' · ') || 'Specialist'}
              </span>
              {(selectedEmp.isSuggested || String(suggestedEmployeeId) === String(selectedEmp.id || selectedEmp.emp_id)) && (
                <span className="rounded bg-indigo-50 border border-indigo-200 px-1.5 py-0.2 text-[10px] font-bold text-indigo-700 shrink-0">
                  Suggested
                </span>
              )}
            </div>
          ) : (
            <span className="text-slate-400">Search and select available technician...</span>
          )}

          <div className="flex items-center gap-1 shrink-0 text-slate-400">
            {selectedEmp && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedEmpId('');
                }}
                className="p-1 hover:text-slate-700 rounded-md hover:bg-slate-100 cursor-pointer"
                title="Clear selection"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <ChevronDown className={`w-4 h-4 transition-transform duration-150 ${isOpen ? 'rotate-180 text-[#2E85D8]' : ''}`} />
          </div>
        </button>

        {/* Searchable Dropdown Panel */}
        {isOpen && (
          <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border border-slate-200 bg-white p-2 shadow-md animate-fade-slide-in">
            {/* Search Input */}
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search staff by name, role, or department..."
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

            {/* Filtered Employees List */}
            <div className="max-h-48 overflow-y-auto space-y-0.5" role="listbox">
              {filteredEmployees.length === 0 ? (
                <div className="p-3 text-center text-xs text-slate-500">
                  No technicians found matching &quot;{searchQuery}&quot;.
                </div>
              ) : (
                filteredEmployees.map((emp) => {
                  const empId = String(emp.id || emp.emp_id);
                  const isSelected = String(selectedEmpId) === empId;
                  const isSuggested = emp.isSuggested || String(suggestedEmployeeId) === empId;

                  return (
                    <button
                      key={empId}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        setSelectedEmpId(empId);
                        setIsOpen(false);
                      }}
                      className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-left text-xs transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-[#2E85D8] text-white font-medium'
                          : 'hover:bg-slate-100 text-[#1E293B]'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`font-semibold truncate ${isSelected ? 'text-white' : 'text-[#1E293B]'}`}>
                            {emp.name}
                          </span>
                          {isSuggested && (
                            <span className={`rounded px-1.5 py-0.2 text-[9px] font-bold ${
                              isSelected ? 'bg-white/20 text-white' : 'bg-indigo-50 border border-indigo-200 text-indigo-700'
                            }`}>
                              Suggested
                            </span>
                          )}
                        </div>
                        <p className={`text-[11px] truncate ${isSelected ? 'text-white/80' : 'text-slate-500'}`}>
                          {[emp.role, emp.department, emp.email].filter(Boolean).join(' · ')}
                        </p>
                      </div>

                      {isSelected && (
                        <Check className="w-4 h-4 text-white shrink-0" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
        <button
          type="button"
          onClick={handleApprove}
          disabled={!selectedEmpId || isProcessing}
          className="flex-1 h-9 px-4 bg-[#1E2A78] hover:bg-[#252578] text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
        >
          {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
          Approve and reassign
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

