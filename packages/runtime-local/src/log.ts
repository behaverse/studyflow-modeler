import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Level, RunEvent } from '@core/engine';

/** A timestamp as the timeline writes them: ISO 8601, millisecond precision, local numeric offset, fine enough that
 * the timeline's order is the log's order. */
export function timelineTimestamp(moment: Date = new Date()): string {
  const offset = -moment.getTimezoneOffset();
  const local = new Date(moment.getTime() + offset * 60_000).toISOString().slice(0, -1);
  const sign = offset < 0 ? '-' : '+';
  const pad = (value: number): string => String(Math.floor(Math.abs(value))).padStart(2, '0');
  return `${local}${sign}${pad(offset / 60)}:${pad(offset % 60)}`;
}

export type LogDetail = { level?: Level };

const RANK: Record<Level, number> = { debug: 0, info: 1, warning: 2, error: 3 };

/**
 * Where a run's account goes. `events.jsonl` is the record: the run's events (packages/core/src/engine/record.ts), one
 * JSON object a line, appended and never rewritten, run after run; the counts and records the study keeps are read
 * off it. `studyflow.log` is text for a person, this run only (earlier ones are recovered from the repository's
 * history): the walk's progress and what the record does not hold (what runners print, warnings, a failure's stack),
 * and with `debug` the detail a debugger wants (each message sent, each condition's value). The console shows the
 * progress and the warnings unless `quiet`.
 */
export class RunLog {
  private file = '';
  private events = '';
  private readonly quiet: boolean;
  private readonly debug: boolean;

  constructor(quiet: boolean, debug = false) {
    this.quiet = quiet;
    this.debug = debug;
  }

  /** Starts `studyflow.log` over in `directory`; a run that branches calls it again, since the checkout replaced the file. */
  start(directory: string): void {
    mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, 'studyflow.log');
    this.events = path.join(directory, 'events.jsonl');
    writeFileSync(this.file, '');
    appendFileSync(this.events, '');
  }

  /** `trace`, a failure's stack, goes to the log file alone. */
  event = (event: string, message: string, { level = 'info' }: LogDetail = {}, trace?: string): void => {
    if (level === 'debug' && !this.debug) return;
    const now = new Date();
    // 29 = 'conditionExpression.evaluated'.length, so every message starts in the same column.
    appendFileSync(this.file, `${now.toISOString().slice(11, 23)} ${level.toUpperCase().padEnd(5)} ${event.padEnd(29)} ${message}\n${trace ? `${trace}\n` : ''}`);
    if (!this.quiet && RANK[level] >= RANK.info) console.log(message);
  };

  /** One event of the run's record. */
  record(event: RunEvent): void {
    appendFileSync(this.events, `${JSON.stringify(event)}\n`);
  }
}
