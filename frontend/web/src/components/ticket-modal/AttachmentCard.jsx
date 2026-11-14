import React from 'react';
import { ShieldAlert, Download, Eye } from 'lucide-react';
import { getFileName, getFileUrl, formatFileSize, isQuarantinedFile, formatPHT } from './ticketModalUtils';

/**
 * AttachmentCard component
 * Displays: File-type tile (PDF/PNG), file name, origin badge + timestamp subtitle (matching ONE UI spec), Download/View actions
 */
export default function AttachmentCard({
  file,
  onPreview = null,
  className = '',
}) {
  const fileName = getFileName(file);
  const fileUrl = getFileUrl(file);
  const isQuarantined = isQuarantinedFile(file);

  const mimeType = String(file?.file_type || file?.type || file?.mime_type || '').toLowerCase();
  const rawExt = fileName.includes('.') ? fileName.split('.').pop()?.toUpperCase() : (mimeType.split('/').pop()?.toUpperCase() || 'FILE');
  const ext = rawExt || 'FILE';
  const isPdf = ext === 'PDF' || mimeType.includes('pdf');
  const isImg = ['PNG', 'JPG', 'JPEG', 'WEBP', 'GIF', 'SVG'].includes(ext) || mimeType.startsWith('image/');

  if (isQuarantined) {
    return (
      <div
        className={`flex items-center justify-between p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-800 gap-2.5 ${className}`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-rose-700 truncate line-through" title="Quarantined: Threat detected">
              {fileName}
            </p>
            <span className="text-[10px] text-rose-500 font-bold uppercase">Blocked & Quarantined</span>
          </div>
        </div>
        <span className="text-[10px] font-bold text-rose-600 bg-rose-200 px-2 py-0.5 rounded-full uppercase shrink-0">
          Blocked
        </span>
      </div>
    );
  }

  const badgeColor = isPdf
    ? 'bg-[#FEECEE] text-[#E02424]'
    : isImg
    ? 'bg-sky-100 text-sky-700'
    : 'bg-slate-100 text-slate-700';

  // Origin & timestamp metadata display (Pic 3 specification)
  const isMessageFile = Boolean(
    file?.source === 'message' ||
    file?.is_from_message ||
    file?.from_message ||
    file?.origin === 'message' ||
    file?.channel === 'chat'
  );

  const isProofFile = Boolean(
    file?.source === 'proof' ||
    file?.is_proof ||
    file?.origin === 'proof'
  );

  let sourceLabel = 'Submitted with ticket';
  let pillClass = 'bg-[#E8EDF5] text-[#1E2A78]';

  if (isProofFile) {
    sourceLabel = 'Proof of completion';
    pillClass = 'bg-emerald-50 text-emerald-700';
  } else if (isMessageFile) {
    sourceLabel = 'From message';
    pillClass = 'bg-slate-100 text-slate-700';
  } else if (file?.source_label) {
    sourceLabel = file.source_label;
  }

  const senderInfo = isMessageFile
    ? (file?.sender_name || file?.sender_role || file?.sender || file?.uploaded_by_name || 'Customer')
    : '';
  const senderPrefix = senderInfo ? `${senderInfo} · ` : '';

  const rawDate = file?.created_at || file?.uploaded_at || file?.date || file?.timestamp;
  const formattedDate = rawDate
    ? formatPHT(rawDate, { includeTime: true, showTimezone: false })
    : '';
  const detailText = `${senderPrefix}${formattedDate}`.trim();

  return (
    <div
      onClick={() => onPreview?.({ name: fileName, url: fileUrl, file_type: file?.file_type || file?.type, size: file?.size || file?.file_size })}
      className={`flex items-center justify-between p-3.5 rounded-xl border border-[#D5D9E4] bg-white hover:bg-[#F5F6FA] cursor-pointer transition-colors shadow-2xs gap-3 ${className}`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-[10px] shrink-0 ${badgeColor}`}
        >
          {ext.slice(0, 4)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-[#1B2033] truncate" title={fileName}>
            {fileName}
          </p>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold leading-none ${pillClass}`}>
              {sourceLabel}
            </span>
            {detailText ? (
              <span className="text-[11px] text-[#5A6178] truncate">
                {detailText}
              </span>
            ) : file?.size ? (
              <span className="text-[11px] text-[#5A6178]">
                {formatFileSize(file.size)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {fileUrl && (
        <a
          href={fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            e.stopPropagation();
            if (onPreview) {
              e.preventDefault();
              onPreview({ name: fileName, url: fileUrl, file_type: file?.file_type || file?.type, size: file?.size || file?.file_size });
            }
          }}
          className="text-xs font-bold text-[#1E2A78] hover:underline px-2 py-1 shrink-0"
        >
          {isPdf ? 'Download' : isImg ? 'View' : 'Download'}
        </a>
      )}
    </div>
  );
}

