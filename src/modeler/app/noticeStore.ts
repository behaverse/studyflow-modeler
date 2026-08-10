/** House rule: dialog-scoped failures render inline in their dialog; everything else goes through `notify()` — never `alert()`. */

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

export function notify(kind: NoticeKind, text: string): void {
  const notice: Notice = { id: ++seq, kind, text };
  notices = [...notices, notice];
  emit();
  if (kind !== 'error') setTimeout(() => dismissNotice(notice.id), AUTO_DISMISS_MS);
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
