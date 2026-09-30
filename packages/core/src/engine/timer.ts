/** A timer as the study writes it: BPMN's `timeDuration`, `timeDate` or `timeCycle`, each ISO 8601 text. */
export type Timer = { duration?: string; date?: string; cycle?: string };

const DURATION = /^P(?=\d|T\d)(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;
const DAY = 86_400_000;
/** Milliseconds in a year, month, week, day, hour, minute, second: a month is 30 days, a year 365. */
const UNITS = [365 * DAY, 30 * DAY, 7 * DAY, DAY, 3_600_000, 60_000, 1000];

/** An ISO 8601 duration (`PT5M`, `P21D`) in milliseconds; undefined when the text is not one. */
export function durationMs(text: string): number | undefined {
  const parts = DURATION.exec(text.trim());
  if (!parts) return undefined;
  return Math.round(parts.slice(1).reduce((sum, part, index) => sum + (part ? Number(part) * UNITS[index] : 0), 0));
}

/**
 * How long a timer waits from `now`, in milliseconds: its duration, or until its date, or the interval of its cycle
 * (`R3/PT10M`: a run waits for the first firing, and walks one path). A cycle that is a schedule (cron) is not a
 * wait: it passes at once. Throws when a duration or a date is not ISO 8601.
 */
export function timerDelay(timer: Timer, now: number = Date.now()): number {
  if (timer.duration !== undefined) {
    const ms = durationMs(timer.duration);
    if (ms === undefined) throw new Error(`a timer's duration is ISO 8601 (PT5M, P21D), not ${JSON.stringify(timer.duration)}`);
    return ms;
  }
  if (timer.date !== undefined) {
    const at = Date.parse(timer.date.trim());
    if (Number.isNaN(at)) throw new Error(`a timer's date is ISO 8601 (2026-10-01T09:00:00Z), not ${JSON.stringify(timer.date)}`);
    return Math.max(0, at - now);
  }
  return durationMs((timer.cycle ?? '').trim().split('/').find((part) => part.startsWith('P')) ?? '') ?? 0;
}
