import { useSyncExternalStore } from 'react';
import {
  dismissNotice,
  getNotices,
  subscribeNotices,
  type NoticeKind,
} from '@modeler/app/noticeStore';
import { radius, shadow, surface } from '@modeler/ui/styles';
import { ICONS } from '@modeler/icons';

/** A notice is a panel: plain for information, tinted for a warning or an error. */
const KIND_STYLES: Record<NoticeKind, string> = {
  error: 'border-red-200 bg-red-50 text-red-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  info: `border-black/[0.10] ${surface.chrome} text-stone-800`,
};

export function Notices() {
  const current = useSyncExternalStore(subscribeNotices, getNotices, getNotices);
  if (current.length === 0) return null;

  return (
    <div
      className="fixed bottom-14 left-1/2 -translate-x-1/2 z-[300] flex flex-col gap-2 max-w-xl w-[calc(100vw-2rem)]"
      data-testid="notices"
    >
      {current.map((notice) => (
        <div
          key={notice.id}
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`flex items-start gap-3 ${radius.card} ${shadow.panel} border p-4 text-sm whitespace-pre-wrap ${KIND_STYLES[notice.kind]}`}
        >
          <span className="flex-1">{notice.text}</span>
          <button
            type="button"
            aria-label="Dismiss"
            title="Dismiss"
            onClick={() => dismissNotice(notice.id)}
            className="inline-flex items-center justify-center size-5 -mr-1 shrink-0 rounded-md opacity-70 hover:opacity-100 hover:bg-black/[0.05] cursor-pointer"
          >
            <i className={ICONS.close} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
