import React from 'react';
import { AlertCircle, Building2, Check, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export const ROUTE_NOTE_MAX = 500;

/**
 * Spec 0051 (AC-3): Members or Department switch for the CS assign modal.
 */
export function AssignModeToggle({ value, onChange, disabled = false }) {
  const options = [
    { key: 'members', label: 'Members' },
    { key: 'department', label: 'Department' },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Assign to members or a department"
      className="inline-flex items-center border border-border rounded-full overflow-hidden bg-card shadow-xs"
      data-testid="assign-mode-toggle"
    >
      {options.map((option) => {
        const isActive = value === option.key;
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={disabled}
            onClick={() => onChange(option.key)}
            className={`px-4 py-2 text-xs transition-colors cursor-pointer select-none disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              isActive
                ? 'bg-primary text-white font-bold'
                : 'bg-transparent text-slate-muted font-semibold hover:bg-page hover:text-slate-dark'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Spec 0051 (AC-3): pick one department that accepts routed tickets. Departments without an
 * active manager stay visible but disabled, with the note "No active manager".
 */
export function DepartmentRoutePicker({
  departments = [],
  loading = false,
  error = '',
  selectedId = null,
  onSelect,
  note = '',
  onNoteChange,
  onRetry,
  disabled = false,
}) {
  return (
    <div className="mb-4" data-testid="department-route-picker">
      <label className="block text-xs font-medium text-slate-dark mb-2" id="department-route-label">
        Route to Department
      </label>

      {loading && (
        <div className="space-y-2" aria-busy="true" aria-label="Loading departments">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4 p-4 border border-border rounded-xl bg-page">
              <Skeleton className="w-8 h-8 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-900 text-xs" role="alert">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <div className="flex-1">
              <p className="font-bold text-red-800">Unable to load departments</p>
              <p className="text-red-700">{error}</p>
              {onRetry && (
                <Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-2 text-xs border-red-300 text-red-800 hover:bg-red-100">
                  <RefreshCw className="w-3 h-3 mr-1" /> Retry
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {!loading && !error && departments.length === 0 && (
        <div className="p-6 border border-dashed border-border rounded-xl text-center text-xs text-slate-muted">
          No department accepts routed tickets yet. A superadmin can turn this on in Departments.
        </div>
      )}

      {!loading && !error && departments.length > 0 && (
        <div role="radiogroup" aria-labelledby="department-route-label" className="space-y-2">
          {departments.map((dept) => {
            const isSelected = Number(selectedId) === Number(dept.id);
            const isDisabled = disabled || !dept.routable;
            const managerCount = Number(dept.manager_count || 0);
            return (
              <button
                key={dept.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-disabled={!dept.routable}
                disabled={isDisabled}
                onClick={() => onSelect(dept.id)}
                data-testid={`route-department-${dept.id}`}
                className={`w-full flex items-center justify-between gap-4 p-4 rounded-xl border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  isSelected
                    ? 'bg-primary/5 border-primary/30 shadow-xs'
                    : 'bg-page border-border hover:bg-card'
                } ${!dept.routable ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <span className="flex items-center gap-4 min-w-0">
                  <span className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-dark truncate">{dept.name}</span>
                      {dept.code && (
                        <span className="text-[10px] font-mono text-slate-muted border border-border rounded px-1">{dept.code}</span>
                      )}
                    </span>
                    <span className="block text-xs text-slate-muted">
                      {dept.routable
                        ? `${managerCount} ${managerCount === 1 ? 'manager' : 'managers'} will triage it`
                        : 'No active manager'}
                    </span>
                  </span>
                </span>
                {isSelected && <Check className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4">
        <label htmlFor="department-route-note" className="block text-xs font-medium text-slate-dark mb-2">
          Note for the manager <span className="text-slate-muted font-normal">(optional)</span>
        </label>
        <textarea
          id="department-route-note"
          value={note}
          maxLength={ROUTE_NOTE_MAX}
          disabled={disabled}
          onChange={(e) => onNoteChange(e.target.value)}
          rows={2}
          placeholder="Anything the manager should know before picking someone"
          className="w-full px-4 py-2 text-sm bg-card border border-border rounded-xl text-slate-dark focus:ring-2 focus:ring-accent outline-none transition-all shadow-xs resize-none"
        />
        <p className="text-[11px] text-slate-muted text-right">{note.length}/{ROUTE_NOTE_MAX}</p>
      </div>
    </div>
  );
}

export default DepartmentRoutePicker;
