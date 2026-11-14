import React, { useState, useRef, useEffect } from 'react';
import { Building2, ChevronDown, Check, MapPin, AlertCircle, Info, Globe2 } from 'lucide-react';
import { useBranch, GLOBAL_BRANCH } from '@/context/BranchContext';
import { useAuth } from '@/context/AuthContext';

/**
 * Reusable BranchSelector Component 
 *
 */
export default function BranchSelector({
  variant = 'default',
  showDescription = true,
  className = '',
  onChange,
}) {
  let authUser = null;
  try {
    const auth = useAuth();
    authUser = auth?.user;
  } catch {
    // Graceful fallback
  }

  const { branches, selectedBranch, setSelectedBranchId, isSuperAdmin } = useBranch();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const userRole = (authUser?.role || '').toLowerCase();
  const userEmail = (authUser?.email || '').toLowerCase();
  const isSuperAdminUser = isSuperAdmin ?? (
    userRole === 'superadmin' || userRole === 'super admin' || userEmail === 'superadmin@example.com'
  );

  const activeBranch = selectedBranch || GLOBAL_BRANCH;

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelectBranch = (branchId) => {
    if (!isSuperAdminUser) return;
    setSelectedBranchId(branchId);
    setIsOpen(false);
    if (onChange) {
      const branchObj = branchId === null || branchId === 'all'
        ? GLOBAL_BRANCH
        : branches.find((b) => b.id === branchId || b.slug === branchId);
      onChange(branchObj);
    }
  };

  const branchList = [GLOBAL_BRANCH, ...branches.filter((b) => b.id !== null && b.slug !== 'all')];

  const isBranchSelected = (branch) => {
    const current = selectedBranch || activeBranch;
    // Check Global scope
    if (branch.id === null || branch.id === 'all' || branch.slug === 'all') {
      return !current || current.id === null || current.id === 'all' || current.slug === 'all';
    }
    // If current is global, a specific branch cannot be selected
    if (!current || current.id === null || current.id === 'all' || current.slug === 'all') {
      return false;
    }
    // Match by ID (handling number vs string)
    if (branch.id != null && current.id != null && String(branch.id).toLowerCase() === String(current.id).toLowerCase()) {
      return true;
    }
    // Match by slug only if both are non-empty strings
    if (typeof branch.slug === 'string' && typeof current.slug === 'string' && branch.slug.length > 0 && branch.slug.toLowerCase() === current.slug.toLowerCase()) {
      return true;
    }
    // Match by code only if both are non-empty strings
    if (typeof branch.code === 'string' && typeof current.code === 'string' && branch.code.length > 0 && branch.code.toUpperCase() === current.code.toUpperCase()) {
      return true;
    }
    return false;
  };

  if (variant === 'inline') {
    const branchDisplayName = selectedBranch?.name || activeBranch.name || '';
    const showBranchLabel = !branchDisplayName.toLowerCase().includes('branch');
    const branchRegion = selectedBranch?.region || activeBranch.region || '';

    if (!isSuperAdminUser) {
      return (
        <div
          className={`inline-flex items-center gap-1.5 px-1 text-xs text-slate-600 cursor-default ${className}`}
          title={`Assigned Facility: ${branchDisplayName}${branchRegion ? ` (${branchRegion})` : ''}`}
        >
          <Building2 size={14} className="text-slate-500 shrink-0" />
          {showBranchLabel && <span className="text-slate-400 font-normal">Branch:</span>}
          <span className="font-semibold text-slate-800">{branchDisplayName}</span>
        </div>
      );
    }

    return (
      <div ref={dropdownRef} className={`relative inline-block text-left ${className}`}>
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          className={`inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-1.5 text-xs transition-all cursor-pointer ${
            isOpen
              ? 'border-[#2E85D8] ring-2 ring-[#2E85D8]/20 text-[#1E293B]'
              : 'border-slate-200 text-[#1E293B] hover:border-slate-300'
          }`}
          title={`Active Branch: ${branchDisplayName}${branchRegion ? ` (${branchRegion})` : ''}`}
        >
          <Building2 size={14} className={isOpen ? 'text-[#2E85D8] shrink-0' : 'text-slate-600 shrink-0'} />
          {showBranchLabel && <span className="text-slate-400 font-normal">Branch:</span>}
          <span className="font-semibold text-[#1E293B]">{branchDisplayName}</span>
          <ChevronDown
            size={14}
            className={`transition-transform duration-150 ${
              isOpen ? 'rotate-180 text-[#2E85D8]' : 'text-slate-400'
            }`}
          />
        </button>

        {/* Dropdown Menu */}
        {isOpen && (
          <div className="absolute right-0 mt-1 z-50 w-72 sm:w-80 rounded-lg border border-slate-200 bg-white p-2 shadow-md animate-fade-slide-in">
            <div className="px-3 py-2 border-b border-slate-100 mb-1">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Select Branch Scope
                </p>
                <span className="rounded bg-[#2E85D8]/10 px-2 py-0.5 text-[10px] font-bold text-[#2E85D8]">
                  {selectedBranch?.code || activeBranch.code}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Metrics and forecasts are scoped strictly to this facility.
              </p>
            </div>

            <div className="flex flex-col gap-1 max-h-64 overflow-y-auto" role="listbox">
              {branchList.map((branch) => {
                const isSelected = isBranchSelected(branch);
                return (
                  <button
                    key={branch.id ?? 'global'}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelectBranch(branch.id)}
                    className={`flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#2E85D8] text-white font-medium'
                        : 'hover:bg-slate-100 text-[#1E293B]'
                    }`}
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      {branch.id === null ? (
                        <Globe2
                          size={15}
                          className={`shrink-0 mt-0.5 ${
                            isSelected ? 'text-white' : 'text-slate-400'
                          }`}
                        />
                      ) : (
                        <Building2
                          size={15}
                          className={`shrink-0 mt-0.5 ${
                            isSelected ? 'text-white' : 'text-slate-400'
                          }`}
                        />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-xs font-semibold truncate ${isSelected ? 'text-white' : 'text-[#1E293B]'}`}>
                            {branch.name}
                          </span>
                          <span className={`rounded px-1.5 py-0.2 text-[10px] font-semibold ${
                            isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {branch.code}
                          </span>
                        </div>
                        {showDescription && (
                          <p className={`text-[11px] mt-0.5 line-clamp-1 ${isSelected ? 'text-white/80' : 'text-slate-500'}`}>
                            {branch.description}
                          </p>
                        )}
                      </div>
                    </div>

                    {isSelected && (
                      <Check size={15} className="text-white shrink-0 mt-0.5" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (variant === 'banner') {
    return (
      <div
        ref={dropdownRef}
        className={`relative rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/90 via-blue-50/50 to-white p-4 shadow-xs ${className}`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#252578] text-white shadow-xs shrink-0">
              {activeBranch.id === null ? <Globe2 size={20} /> : <Building2 size={20} />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-900/70">
                  Target Branch Scope
                </span>
                <span className="inline-flex items-center rounded-md bg-indigo-100/80 px-2 py-0.5 text-[11px] font-bold text-indigo-800">
                  {activeBranch.code || 'GLOBAL'}
                </span>
              </div>
              <h4 className="text-sm font-bold text-gray-900">
                {activeBranch.name}
                {activeBranch.region && (
                  <span className="ml-2 text-xs font-normal text-gray-500">
                    ({activeBranch.region})
                  </span>
                )}
              </h4>
            </div>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setIsOpen((prev) => !prev)}
              aria-haspopup="listbox"
              aria-expanded={isOpen}
              className={`inline-flex items-center gap-2.5 rounded-lg border bg-white px-4 py-2 text-xs font-semibold shadow-xs transition-all cursor-pointer ${
                isOpen
                  ? 'border-[#2E85D8] ring-2 ring-[#2E85D8]/20 text-[#252578]'
                  : 'border-slate-200 text-[#252578] hover:bg-slate-50'
              }`}
            >
              <MapPin size={14} className="text-[#252578]" />
              <span>Switch Scope</span>
              <ChevronDown
                size={14}
                className={`transition-transform duration-200 ${isOpen ? 'rotate-180 text-[#2E85D8]' : ''}`}
              />
            </button>

            {/* Dropdown Menu */}
            {isOpen && (
              <div className="absolute right-0 mt-1 z-50 w-72 sm:w-80 rounded-lg border border-slate-200 bg-white p-2 shadow-md animate-fade-slide-in">
                <div className="px-3 py-2 border-b border-slate-100 mb-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Select Target Facility
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Configurations will be scoped to this branch or all branches.
                  </p>
                </div>

                <div className="flex flex-col gap-1 max-h-64 overflow-y-auto" role="listbox">
                  {branchList.map((branch) => {
                    const isSelected = isBranchSelected(branch);
                    return (
                      <button
                        key={branch.id || 'global'}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => handleSelectBranch(branch.id)}
                        className={`flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[#2E85D8] text-white font-medium'
                            : 'hover:bg-slate-100 text-[#1E293B]'
                        }`}
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          {branch.id === null ? (
                            <Globe2
                              size={16}
                              className={`shrink-0 mt-0.5 ${
                                isSelected ? 'text-white' : 'text-slate-400'
                              }`}
                            />
                          ) : (
                            <Building2
                              size={16}
                              className={`shrink-0 mt-0.5 ${
                                isSelected ? 'text-white' : 'text-slate-400'
                              }`}
                            />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-xs font-semibold truncate ${isSelected ? 'text-white' : 'text-[#1E293B]'}`}>
                                {branch.name}
                              </span>
                              {branch.code && (
                                <span className={`rounded px-1.5 py-0.2 text-[10px] font-semibold ${
                                  isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                                }`}>
                                  {branch.code}
                                </span>
                              )}
                            </div>
                            {showDescription && branch.description && (
                              <p className={`text-[11px] mt-0.5 line-clamp-1 ${isSelected ? 'text-white/80' : 'text-slate-500'}`}>
                                {branch.description}
                              </p>
                            )}
                          </div>
                        </div>

                        {isSelected && (
                          <Check size={16} className="text-white shrink-0 mt-0.5" />
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-2 pt-2 border-t border-gray-100 px-2 py-1 flex items-center gap-1.5 text-[10px] text-amber-700 bg-amber-50/70 rounded-lg">
                  <AlertCircle size={12} className="shrink-0 text-amber-600" />
                  <span>Edits made apply to the active branch scope only.</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Default variant: prominent header/toolbar pill
  return (
    <div ref={dropdownRef} className={`relative inline-block text-left ${className}`}>
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          className={`group inline-flex items-center gap-2.5 rounded-lg border bg-white px-3.5 py-2 text-xs font-semibold transition-all cursor-pointer ${
            isOpen
              ? 'border-[#2E85D8] ring-2 ring-[#2E85D8]/20 shadow-sm'
              : 'border-slate-200 shadow-xs hover:border-slate-300'
          }`}
          title={`Currently configuring: ${activeBranch.name}`}
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#252578] text-white shrink-0 shadow-xs">
            {activeBranch.id === null ? <Globe2 size={13} /> : <Building2 size={13} />}
          </div>

          <div className="flex flex-col text-left">
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 leading-none">
              Configuring Scope
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="font-bold text-[#252578] text-xs">
                {activeBranch.name}
              </span>
              {activeBranch.code && (
                <span className="rounded bg-[#2E85D8]/10 px-1.5 py-0.2 text-[10px] font-bold text-[#2E85D8]">
                  {activeBranch.code}
                </span>
              )}
            </div>
          </div>

          <ChevronDown
            size={14}
            className={`transition-transform duration-200 ml-1 ${
              isOpen ? 'rotate-180 text-[#2E85D8]' : 'text-slate-400 group-hover:text-[#252578]'
            }`}
          />
        </button>
      </div>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute left-0 sm:right-0 sm:left-auto mt-1 z-50 w-72 sm:w-80 rounded-lg border border-slate-200 bg-white p-2 shadow-md animate-fade-slide-in">
          <div className="px-3 py-2 border-b border-slate-100 mb-1">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Active Branch Configuration
              </p>
              <span className="text-[10px] font-semibold text-[#2E85D8] bg-[#2E85D8]/10 px-2 py-0.5 rounded-full">
                {branches.length} Branches
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Select which physical branch or global scope to configure.
            </p>
          </div>

          <div className="flex flex-col gap-1 max-h-64 overflow-y-auto" role="listbox">
            {branchList.map((branch) => {
              const isSelected = isBranchSelected(branch);
              return (
                <button
                  key={branch.id || 'global'}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelectBranch(branch.id)}
                  className={`flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#2E85D8] text-white font-medium'
                      : 'hover:bg-slate-100 text-[#1E293B]'
                  }`}
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    {branch.id === null ? (
                      <Globe2
                        size={16}
                        className={`shrink-0 mt-0.5 ${
                          isSelected ? 'text-white' : 'text-slate-400'
                        }`}
                      />
                    ) : (
                      <Building2
                        size={16}
                        className={`shrink-0 mt-0.5 ${
                          isSelected ? 'text-white' : 'text-slate-400'
                        }`}
                      />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-xs font-semibold truncate ${isSelected ? 'text-white' : 'text-[#1E293B]'}`}>
                          {branch.name}
                        </span>
                        {branch.code && (
                          <span className={`rounded px-1.5 py-0.2 text-[10px] font-semibold ${
                            isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {branch.code}
                          </span>
                        )}
                        {branch.region && (
                          <span className={`text-[10px] ${isSelected ? 'text-white/80' : 'text-slate-400'}`}>
                            ({branch.region})
                          </span>
                        )}
                      </div>
                      {showDescription && branch.description && (
                        <p className={`text-[11px] mt-0.5 line-clamp-1 ${isSelected ? 'text-white/80' : 'text-slate-500'}`}>
                          {branch.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {isSelected && (
                    <Check size={16} className="text-white shrink-0 mt-0.5" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-2 pt-2 border-t border-gray-100 px-2 py-1.5 flex items-start gap-1.5 text-[11px] text-gray-600 bg-gray-50 rounded-xl">
            <Info size={13} className="shrink-0 text-indigo-600 mt-0.5" />
            <span className="text-[10px] leading-tight">
              Edits made on this screen apply to <strong>{activeBranch.name}</strong>.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
