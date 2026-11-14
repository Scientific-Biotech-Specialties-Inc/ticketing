import React from 'react';

/**
 * FieldGrid component
 * 2-column label (12px muted) / value (14px) grid.
 * Equipment shows full name, wrapped with no truncation.
 * Priority and Category accept optional inline Edit callbacks (44px touch targets).
 */
export default function FieldGrid({
  requestor,
  department,
  priority,
  onEditPriority = null,
  category,
  onEditCategory = null,
  equipment,
  assetId = null,
  slaDueDate = null,
  slaStatusBadge = null,
  dateFiled = null,
  extraFields = [],
  className = '',
}) {
  const hasSla = Boolean(slaDueDate || slaStatusBadge);

  const renderDateFiled = () => (
    dateFiled ? (
      <div className="rounded-lg border border-[#D5D9E4] bg-white py-2 px-3 flex flex-col justify-between">
        <span className="text-[11px] font-semibold text-[#5A6178] uppercase tracking-wider">
          Date Filed
        </span>
        <p className="mt-0.5 text-[13px] font-medium text-[#1B2033] leading-snug">
          {dateFiled}
        </p>
      </div>
    ) : null
  );

  const renderEquipment = () => (
    equipment ? (
      <div className={`${hasSla ? '' : 'sm:col-span-2'} rounded-lg border border-[#D5D9E4] bg-white py-2 px-3 flex flex-col justify-between`}>
        <span className="text-[11px] font-semibold text-[#5A6178] uppercase tracking-wider">
          Equipment
        </span>
        <p className="mt-0.5 text-[13px] font-medium text-[#1B2033] leading-snug break-words whitespace-normal">
          {equipment}
          {assetId && (
            <span className="block text-xs font-mono text-[#5A6178] mt-0.5">
              Asset ID: {assetId}
            </span>
          )}
        </p>
      </div>
    ) : null
  );

  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-2.5 ${className}`}>
      {/* Requestor */}
      {requestor && (
        <div className="rounded-lg border border-[#D5D9E4] bg-white py-2 px-3 flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-[#5A6178] uppercase tracking-wider">
            Requestor
          </span>
          <p className="mt-0.5 text-[13px] font-medium text-[#1B2033] leading-snug break-words">
            {requestor}
          </p>
        </div>
      )}

      {/* Department */}
      {department && (
        <div className="rounded-lg border border-[#D5D9E4] bg-white py-2 px-3 flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-[#5A6178] uppercase tracking-wider">
            Department
          </span>
          <p className="mt-0.5 text-[13px] font-medium text-[#1B2033] leading-snug break-words">
            {department}
          </p>
        </div>
      )}

      {/* Priority with inline Edit */}
      {priority && (
        <div className="rounded-lg border border-[#D5D9E4] bg-white py-2 px-3 flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-[#5A6178] uppercase tracking-wider">
            Priority
          </span>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-[#1B2033]">
              {priority}
            </span>
            {onEditPriority && (
              <button
                type="button"
                onClick={onEditPriority}
                aria-label="Edit priority"
                className="min-h-[28px] -my-1 -mr-1 px-1.5 inline-flex items-center justify-center text-xs font-semibold text-[#1E2A78] hover:underline cursor-pointer"
              >
                <span className="sr-only">Edit priority</span>
                <span aria-hidden="true">Edit</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Category with inline Edit */}
      {category && (
        <div className={`rounded-lg border border-[#D5D9E4] bg-white py-2 px-3 flex flex-col justify-between ${(!priority && !department && !requestor && !dateFiled) ? 'sm:col-span-2' : ''}`}>
          <span className="text-[11px] font-semibold text-[#5A6178] uppercase tracking-wider">
            Category
          </span>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-[#1B2033] break-words">
              {category}
            </span>
            {onEditCategory && (
              <button
                type="button"
                onClick={onEditCategory}
                aria-label="Edit category"
                className="min-h-[28px] -my-1 -mr-1 px-1.5 inline-flex items-center justify-center text-xs font-semibold text-[#1E2A78] hover:underline cursor-pointer"
              >
                <span className="sr-only">Edit category</span>
                <span aria-hidden="true">Edit</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* When no SLA, Date Filed is placed beside Category (Row 2 Col 2) */}
      {!hasSla && renderDateFiled()}

      {/* Equipment (full width when no SLA, 1-col when SLA is present) */}
      {renderEquipment()}

      {/* When SLA is present, Date Filed is placed beside Equipment (Row 3 Col 2) */}
      {hasSla && renderDateFiled()}

      {/* SLA Due Date */}
      {slaDueDate && (
        <div className="rounded-lg border border-[#D5D9E4] bg-white py-2 px-3 flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-[#5A6178] uppercase tracking-wider">
            SLA Due Date
          </span>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-[#1B2033] leading-snug">
              {slaDueDate}
            </span>
          </div>
        </div>
      )}

      {/* SLA Status */}
      {slaStatusBadge && (
        <div className="rounded-lg border border-[#D5D9E4] bg-white py-2 px-3 flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-[#5A6178] uppercase tracking-wider">
            SLA Status
          </span>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            {slaStatusBadge}
          </div>
        </div>
      )}

      {/* Extra fields */}
      {extraFields.map((field, idx) => (
        <div
          key={idx}
          className={`${field.fullWidth ? 'sm:col-span-2' : ''} rounded-lg border border-[#D5D9E4] bg-white py-2 px-3 flex flex-col justify-between`}
        >
          <span className="text-[11px] font-semibold text-[#5A6178] uppercase tracking-wider">
            {field.label}
          </span>
          <div className="mt-0.5 text-[13px] font-medium text-[#1B2033] leading-snug">
            {field.value}
          </div>
        </div>
      ))}
    </div>
  );
}
