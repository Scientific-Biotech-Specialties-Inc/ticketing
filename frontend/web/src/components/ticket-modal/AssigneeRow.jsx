import React from 'react';
import { MessageCircle, Bell, ArrowUpRight, ChevronRight } from 'lucide-react';

/**
 * AssigneeRow component
 * Displays: Avatar initials, Name + Department, Updated <time> PHT, optional Message and Remind buttons.
 * Supports multiple assignees with overlapping avatar stack and shortcut to Assignees tab.
 */
export default function AssigneeRow({
  name,
  firstName,
  initials,
  department,
  updatedText,
  onMessage = null,
  messageLabel = null,
  onRemind = null,
  remindDisabled = false,
  remindTitle = '',
  remindCooldownText = '',
  onEscalate = null,
  extraActions = null,
  className = '',
  assignees = [],
  onViewAllAssignees = null,
}) {
  const isMultiple = Array.isArray(assignees) && assignees.length > 1;
  const count = isMultiple ? assignees.length : (name && name !== 'Unassigned' && name !== 'None assigned' ? 1 : 0);

  const displayFirstName = firstName || (name ? name.split(' ')[0] : 'Assignee');
  const msgText = messageLabel || (isMultiple ? 'Message staff' : `Message ${displayFirstName}`);

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-[#D5D9E4] ${className}`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {/* Avatars */}
        {isMultiple ? (
          <div className="flex items-center -space-x-2 shrink-0">
            {assignees.slice(0, 3).map((emp, idx) => (
              <div
                key={emp.id || idx}
                className="w-9 h-9 rounded-full bg-[#1E2A78] text-white flex items-center justify-center font-bold text-xs ring-2 ring-white shadow-xs"
                title={`${emp.name} (${emp.department || 'Support'})`}
              >
                {emp.initials || 'EM'}
              </div>
            ))}
            {assignees.length > 3 && (
              <div
                className="w-9 h-9 rounded-full bg-[#3A3A85] text-white flex items-center justify-center font-semibold text-[11px] ring-2 ring-white shadow-xs"
                title={`${assignees.length - 3} more staff members`}
              >
                +{assignees.length - 3}
              </div>
            )}
          </div>
        ) : (
          <div className="w-10 h-10 rounded-full bg-[#1E2A78] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
            {initials || 'CS'}
          </div>
        )}

        {/* Info & Name - No aggressive truncate to prevent cutting off names */}
        <div className="min-w-0 flex-1">
          {isMultiple ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <h4 className="text-sm font-semibold text-[#1B2033] break-words">
                {assignees[0]?.name}
                <span className="text-xs font-normal text-[#5A6178] ml-1">
                  &amp; {assignees.length - 1} other{assignees.length > 2 ? 's' : ''}
                </span>
              </h4>
              {onViewAllAssignees && (
                <button
                  type="button"
                  onClick={onViewAllAssignees}
                  className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[#2E85D8] hover:text-[#252578] hover:underline cursor-pointer"
                  title="View all assignees in dedicated tab"
                >
                  <span>View all ({count})</span>
                  <ChevronRight className="w-3 h-3" />
                </button>
              )}
            </div>
          ) : (
            <h4 className="text-sm font-semibold text-[#1B2033] break-words">
              {name || 'Unassigned'}
              {department && name && name !== 'None assigned' && name !== 'Unassigned' && (
                <span className="text-xs font-normal text-[#5A6178] ml-1.5 inline">
                  · {department}
                </span>
              )}
            </h4>
          )}

          <p className="text-xs text-[#5A6178] break-words">
            {isMultiple
              ? `${count} assigned technicians${updatedText ? ` · ${updatedText}` : ''}`
              : `Assigned technician${updatedText ? ` · ${updatedText}` : ''}`}
          </p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 shrink-0 flex-wrap sm:flex-nowrap">
        {onMessage && (
          <button
            type="button"
            onClick={onMessage}
            className="h-8 px-3 bg-[#1E2A78] hover:bg-[#252578] text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
            title={`Send a message to ${isMultiple ? 'assigned staff' : displayFirstName}`}
          >
            <MessageCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{msgText}</span>
          </button>
        )}

        {onRemind && (
          <button
            type="button"
            onClick={onRemind}
            disabled={remindDisabled}
            title={remindTitle || `Send reminder to ${displayFirstName}`}
            aria-label={`Send reminder to ${displayFirstName}`}
            className="h-8 px-3 border border-[#D5D9E4] hover:bg-[#F5F6FA] text-[#1B2033] text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            <Bell className="w-3.5 h-3.5 text-[#5A6178] shrink-0" />
            <span>Remind{isMultiple ? ' Staff' : ` ${displayFirstName}`}</span>
            {remindCooldownText && (
              <span className="text-[10px] text-[#5A6178]">({remindCooldownText})</span>
            )}
          </button>
        )}

        {onEscalate && (
          <button
            type="button"
            onClick={onEscalate}
            className="h-8 px-3 border border-[#B42318] text-[#B42318] hover:bg-red-50 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
          >
            <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
            <span>Escalate</span>
          </button>
        )}

        {extraActions}
      </div>
    </div>
  );
}

