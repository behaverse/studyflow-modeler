import { useSyncExternalStore } from 'react';
import {
  dismissNotice,
  getNotices,
  subscribeNotices,
  type NoticeKind,
} from '@modeler/app/noticeStore';

const KIND_STYLES: Record<NoticeKind, string> = {
  error: 'border-red-300 bg-red-50 text-red-900',
  warning: 'border-amber-300 bg-amber-50 text-amber-900',
  info: 'border-stone-300 bg-white text-stone-800',
};

export function Notices() {
  const current = useSyncExternalStore(subscribeNotices, getNotices, getNotices);
  if (current.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[300] flex flex-col gap-2 max-w-xl w-[calc(100vw-2rem)]"
      data-testid="notices"
    >
      {current.map((notice) => (
        <div
          key={notice.id}
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg whitespace-pre-wrap ${KIND_STYLES[notice.kind]}`}
        >
          <span className="flex-1">{notice.text}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismissNotice(notice.id)}
            className="shrink-0 opacity-60 hover:opacity-100 cursor-pointer"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
