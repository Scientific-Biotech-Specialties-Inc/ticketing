import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

export default function BoundedSelect({
  id,
  name,
  value,
  onChange,
  onBlur,
  options = [],
  groups = null,
  placeholder = 'Select an option',
  disabled = false,
  hasError = false,
  searchable = false,
  required = false,
  triggerClassName = '',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef(null);

  const allOptions = groups
    ? groups.flatMap((group) => group.options || [])
    : options;

  const selectedOption = allOptions.find((opt) => String(opt.value) === String(value));

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
        setSearchQuery('');
        onBlur?.();
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        setSearchQuery('');
        onBlur?.();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onBlur]);

  const query = searchQuery.trim().toLowerCase();
  const showSearch = searchable || allOptions.length > 6;

  const filteredGroups = groups
    ? groups
        .map((group) => ({
          ...group,
          options: query
            ? (group.options || []).filter((opt) =>
                String(opt.label || '').toLowerCase().includes(query)
              )
            : group.options || [],
        }))
        .filter((group) => group.options.length > 0)
    : null;

  const filteredOptions = !groups
    ? query
      ? options.filter((opt) => String(opt.label || '').toLowerCase().includes(query))
      : options
    : [];

  const hasMatches = filteredGroups
    ? filteredGroups.length > 0
    : filteredOptions.length > 0;

  const handleSelect = (nextValue) => {
    onChange(nextValue);
    setIsOpen(false);
    setSearchQuery('');
    onBlur?.();
  };

  const renderOption = (opt) => {
    const isSelected = String(opt.value) === String(value);
    return (
      <button
        key={opt.value}
        type="button"
        role="option"
        aria-selected={isSelected}
        onClick={() => handleSelect(String(opt.value))}
        className={`flex w-full items-start justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs sm:text-sm transition-colors cursor-pointer ${
          isSelected
            ? 'bg-[#252578] font-semibold text-white'
            : 'text-dark-slate hover:bg-[#252578]/5'
        }`}
      >
        <span className="min-w-0 flex-1 break-words leading-snug">{opt.label}</span>
        {isSelected && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white" />}
      </button>
    );
  };

  return (
    <div ref={containerRef} className="relative w-full min-w-0">
      <button
        id={id}
        name={name}
        type="button"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-required={required}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setIsOpen((prev) => {
            if (prev) {
              setSearchQuery('');
              onBlur?.();
            }
            return !prev;
          });
        }}
        className={`flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border bg-white px-4 py-3 text-left text-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-[#252578] disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer ${
          hasError ? 'border-red-400 bg-red-50' : isOpen ? 'border-[#252578] ring-2 ring-[#252578]/20' : 'border-gray-200'
        } ${triggerClassName}`}
      >
        <span className={`min-w-0 flex-1 truncate ${selectedOption ? 'text-dark-slate font-medium' : 'text-gray-500'}`}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-gray-500 transition-transform duration-150 ${isOpen ? 'rotate-180 text-[#252578]' : ''}`}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl"
        >
          {showSearch && (
            <div className="border-b border-gray-100 p-2 bg-gray-50/60">
              <div className="relative flex items-center">
                <Search className="absolute left-2.5 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search options..."
                  className="w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 py-1.5 text-xs text-dark-slate outline-none focus:border-[#252578]"
                  autoFocus
                />
              </div>
            </div>
          )}
          <div className="max-h-56 overflow-y-auto p-1">
            <button
              type="button"
              role="option"
              aria-selected={!value}
              onClick={() => handleSelect('')}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs sm:text-sm transition-colors cursor-pointer ${
                !value ? 'bg-[#252578]/10 font-semibold text-[#252578]' : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              <span className="truncate">{placeholder}</span>
              {!value && <Check className="h-3.5 w-3.5 shrink-0 text-[#252578]" />}
            </button>
            {!hasMatches ? (
              <div className="px-3 py-3 text-center text-xs text-gray-400">No matching options found</div>
            ) : filteredGroups ? (
              filteredGroups.map((group) => (
                <div key={group.label} className="mt-1 first:mt-0">
                  <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    {group.label}
                  </div>
                  {group.options.map(renderOption)}
                </div>
              ))
            ) : (
              filteredOptions.map(renderOption)
            )}
          </div>
        </div>
      )}
    </div>
  );
}
