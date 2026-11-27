import React from 'react';

export default function ResponsiveTable({ columns, data, renderCard, onRowClick, minWidth = 900 }) {
  return (
    <>
      <div className="hidden sm:block overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left" style={{ minWidth }}>
            <thead className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className="px-5 py-4 whitespace-nowrap" style={c.width ? { width: c.width } : undefined}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-700">
              {data.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-5 py-8 text-center text-sm text-gray-500">
                    No records found.
                  </td>
                </tr>
              ) : (
                data.map((row, idx) => (
                  <tr key={row.id || idx} className="hover:bg-gray-50">
                    {columns.map((c) => (
                      <td key={c.key} className="px-5 py-4 text-sm">
                        {c.cell ? c.cell(row) : row[c.key]}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="sm:hidden space-y-3">
        {data.length === 0 ? (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center text-sm text-gray-500">No records found.</div>
        ) : (
          data.map((row, idx) => (
            <div key={row.id || idx} className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
              {renderCard ? renderCard(row) : (
                <div className="space-y-2 text-sm">
                  {columns.slice(0, 3).map((c) => (
                    <div key={c.key} className="flex justify-between gap-2">
                      <span className="text-xs font-semibold text-gray-400 uppercase">{c.header}</span>
                      <span className="text-sm font-medium text-gray-800 text-right truncate">{c.cell ? c.cell(row) : row[c.key]}</span>
                    </div>
                  ))}
                  {typeof onRowClick === 'function' && (
                    <button
                      type="button"
                      onClick={() => onRowClick(row)}
                      className="mt-2 w-full rounded-xl bg-[#252578] text-white text-sm font-semibold py-2.5 min-h-[44px] cursor-pointer"
                    >
                      View details
                    </button>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </>
  );
}
