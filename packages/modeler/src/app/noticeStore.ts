/** House rule: dialog-scoped failures render inline in their dialog; everything else goes through `notify()`, never `alert()`. */

export type NoticeKind = 'error' | 'warning' | 'info';

export type Notice = {
  id: number;
  kind: NoticeKind;
  text: string;
};

const AUTO_DISMISS_MS = 8000;

let seq = 0;
let notices: Notice[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

/** An error, or a notice passed `keep`, stays until the user dismisses it; any other clears itself after a few seconds. */
export function notify(kind: NoticeKind, text: string, { keep = false } = {}): void {
  const notice: Notice = { id: ++seq, kind, text };
  notices = [...notices, notice];
  emit();
  if (kind !== 'error' && !keep) setTimeout(() => dismissNotice(notice.id), AUTO_DISMISS_MS);
}

export function dismissNotice(id: number): void {
  if (!notices.some((notice) => notice.id === id)) return;
  notices = notices.filter((notice) => notice.id !== id);
  emit();
}

export function getNotices(): Notice[] {
  return notices;
}

export function subscribeNotices(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
