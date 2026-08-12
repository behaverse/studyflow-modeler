import { primaryRoots } from '@core/document';
import type { Modeler } from '@modeler/bpmn/types';

export type TrailStamp = {
  action: string;
  when: string;
  who?: string;
  with?: string;
  what?: string;
  run?: string;
  seed?: string;
  note?: string;
};

export function primaryRoot(definitions: any): any | undefined {
  return primaryRoots(definitions)[0];
}

function trailRoot(definitions: any): any | undefined {
  const candidates = primaryRoots(definitions);
  return candidates.find((root) => {
    const values: any[] = root?.extensionElements?.values ?? [];
    return values.some((value) => value?.$type === 'prov:Activity');
  }) ?? candidates[0];
}

export function readTrail(definitions: any): any[] {
  const root = trailRoot(definitions);
  const values: any[] = root?.extensionElements?.values ?? [];
  return values.filter((value) => value?.$type === 'prov:Activity');
}

/** ISO 8601 at second precision, in this machine's timezone. */
export function trailTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export function appendTrailEntry(
  definitions: any,
  moddle: any,
  stamp: TrailStamp,
): any | undefined {
  // `trailRoot`, not `primaryRoot`: appending elsewhere than `readTrail` reads would split the trail across roots.
  const root = trailRoot(definitions);
  if (!root) return undefined;

  const entry = moddle.create('prov:Activity', pruneEmpty(stamp));
  if (!root.extensionElements) {
    root.extensionElements = moddle.create('bpmn:ExtensionElements', { values: [] });
    root.extensionElements.$parent = root;
  }
  root.extensionElements.values.push(entry);
  entry.$parent = root.extensionElements;
  return entry;
}

function pruneEmpty(stamp: TrailStamp): Record<string, string> {
  return Object.fromEntries(
    Object.entries(stamp).filter(([, value]) => typeof value === 'string' && value.length > 0),
  );
}

const lastStampedAt = new WeakMap<object, number>();

const commandStackIndex = (modeler: Modeler): number =>
  modeler.get('commandStack', false)?._stackIdx ?? -1;

export function resetTrailStamping(modeler: Modeler): void {
  lastStampedAt.delete(modeler);
}

export function stampTrailForExport(
  modeler: Modeler,
  identity: { who?: string; tool: string },
): any | undefined {
  const definitions = modeler.getDefinitions?.();
  if (!definitions) return undefined;

  const stackIndex = commandStackIndex(modeler);
  const trail = readTrail(definitions);
  const edited = stackIndex !== (lastStampedAt.get(modeler) ?? -1);
  if (trail.length > 0 && !edited) return undefined;

  const entry = appendTrailEntry(definitions, modeler.get('moddle'), {
    action: trail.length === 0 ? 'created' : 'modified',
    when: trailTimestamp(),
    who: identity.who,
    with: identity.tool,
  });
  if (entry) lastStampedAt.set(modeler, stackIndex);
  return entry;
}
