/**
 * Token simulation: dry runs of the study (core's walk, the engine every runtime hosts, executing nothing), each
 * shown as tokens gliding along the flows it takes. A token is one pool's walk, so what a simulation shows is what a
 * run does: it waits where a run waits for a message, and it stops where a run would stop.
 */

import { readState } from '@core/document';
import { Walk, dryHost, planOf, type Plan } from '@core/engine';
import { isBpmnSubtypeOf } from '@core/notation';
import type { Canvas, EventBus } from '@modeler/editor/port';
import type { Point, Study } from '@canvas/index.ts';
import { computeSegLengths, dedupePoints, samplePolyline, smootherstep, tokenAnchor } from '@modeler/simulation/polyline';

export interface SimulationHost {
  events: Pick<EventBus, 'on' | 'off' | 'fire'>;
  /** What the tokens walk. */
  study: Pick<Study, 'get' | 'definitions'>;
  /** Where they are drawn, and whether the view shows where they are. */
  canvas: Pick<Canvas, 'layer' | 'draws' | 'scope'>;
}

const TOKEN_RADIUS = 8;
const TOKEN_SPEED = 200;
const ACTIVITY_PAUSE_MS = 500;
const SPAWN_INTERVAL_MS = 1000;
const MAX_BOUNCING_PER_ELEMENT = 5;
const TOKEN_COLORS = ['#e040fb', '#00bcd4', '#ff9800', '#4caf50', '#2196f3'];

export const TOGGLE_SIMULATION_EVENT = 'TokenSimulationToggle';

const TOKEN_LAYER = 'token-simulation';
const TOKEN_LAYER_INDEX = 1000;

/** One pool's token in one dry run. */
interface Token {
  svg: SVGCircleElement;
  cx: number;
  cy: number;
  /** The path it is gliding along, and how far it has come. */
  path: Point[];
  segLengths: number[];
  totalDist: number;
  travelled: number;
  pauseRemaining: number;
  /** The node or flow it is on: decides whether it is on screen in the current drill-down scope. */
  at: string;
  hidden: boolean;
  bouncing: boolean;
  done: boolean;
  /** Settles the move the walk is waiting for. */
  arrive?: () => void;
  stop?: (reason: Error) => void;
}

/** One dry run: a walk, and a token for each pool it walks. */
interface Run {
  color: string;
  tokens: Map<string, Token>;
  /** Its walk has ended, or the simulation stopped it. */
  over: boolean;
}

const STOPPED = new Error('the simulation stopped');

export default class TokenSimulator {
  private host: SimulationHost;
  private active = false;
  private runs: Run[] = [];
  private frame: number | null = null;
  private spawning: number | null = null;
  private layer: SVGGElement | null = null;
  private colorIndex = 0;
  private lastTimestamp = 0;
  private plan: Plan | undefined;

  constructor(host: SimulationHost) {
    this.host = host;
    this.host.events.on('RootSet', this.handleRootSet);
    this.host.events.on('ImportDone', this.handleImport);
  }

  dispose(): void {
    this.stop();
    this.host.events.off('RootSet', this.handleRootSet);
    this.host.events.off('ImportDone', this.handleImport);
  }

  isActive(): boolean {
    return this.active;
  }

  toggle(): void {
    if (this.active) this.stop();
    else this.start();
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.ensureKeyframes();
    this.layer = this.host.canvas.layer(TOKEN_LAYER, TOKEN_LAYER_INDEX);
    this.readPlan();
    this.spawnRun();
    this.spawning = window.setInterval(() => {
      if (this.tokens().filter((token) => !token.done && !token.hidden && !token.bouncing).length < TOKEN_COLORS.length) this.spawnRun();
    }, SPAWN_INTERVAL_MS);
    this.lastTimestamp = performance.now();
    this.frame = requestAnimationFrame(this.tick);
    this.host.events.fire(TOGGLE_SIMULATION_EVENT, { active: true });
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    if (this.spawning) clearInterval(this.spawning);
    if (this.frame) cancelAnimationFrame(this.frame);
    this.spawning = this.frame = null;
    this.clearRuns();
    this.host.events.fire(TOGGLE_SIMULATION_EVENT, { active: false });
  }

  /** A new document: every token refers to elements that are gone, so start over. */
  private handleImport = (): void => {
    if (!this.active) return;
    this.layer = this.host.canvas.layer(TOKEN_LAYER, TOKEN_LAYER_INDEX);
    this.clearRuns();
    this.readPlan();
    this.spawnRun();
  };

  /** A drill-down: tokens keep walking (the coordinate space is shared) and only their visibility changes; the next
   * runs start where the view is. */
  private handleRootSet = (): void => {
    if (!this.active) return;
    for (const token of this.tokens()) this.syncVisibility(token);
    this.spawnRun();
  };

  /** The plan of the study as it stands; a study with nothing to walk has no tokens. */
  private readPlan(): void {
    try {
      this.plan = planOf(this.host.study.definitions);
    } catch {
      this.plan = undefined;
    }
  }

  private tokens(): Token[] {
    return this.runs.flatMap((run) => [...run.tokens.values()]);
  }

  private clearRuns(): void {
    for (const run of this.runs) {
      run.over = true;
      for (const token of run.tokens.values()) {
        token.done = true;
        token.svg.remove();
        token.stop?.(STOPPED);
      }
    }
    this.runs = [];
  }

  /** One more dry run, from the start of what is on screen: the study's pools, or the container drilled into. */
  private spawnRun(): void {
    if (!this.plan) return;
    const { scope } = this.host.canvas;
    const plan = scope && this.plan.elements[scope] ? { ...this.plan, processes: [scope] } : this.plan;
    const run: Run = { color: TOKEN_COLORS[this.colorIndex++ % TOKEN_COLORS.length], tokens: new Map(), over: false };
    let walk: Walk;
    try {
      // Unseeded: each run is another participant, so the tokens spread over what a random gateway may draw.
      walk = new Walk(plan, dryHost(plan, {
        moved: (to, along, pool) => this.move(run, pool, to, along),
        passed: (id) => this.passed(run, plan, id),
      }), { seed: null, state: readState(this.host.study.definitions) });
    } catch {
      return; // a study the walk refuses before its first step
    }
    this.runs.push(run);
    // A pool's token that reached no end event stands where its walk stopped: a dead end, or where the run failed.
    const settle = (): void => {
      if (run.over) return;
      run.over = true;
      for (const token of run.tokens.values()) if (!token.done) this.bounce(token);
    };
    walk.run().then(settle, settle);
  }

  /** A pool's token moves into `to`: gliding along the flow it took, else straight there. The walk waits for it. */
  private move(run: Run, pool: string, to: string, along: string | undefined): Promise<void> {
    if (run.over) return Promise.reject(STOPPED);
    const target = this.host.study.get(to);
    if (!target?.bounds) return Promise.resolve();
    const anchor = tokenAnchor(target);
    let token = run.tokens.get(pool);
    if (!token) {
      token = this.createToken(run.color, anchor, to);
      run.tokens.set(pool, token);
      return Promise.resolve();
    }
    const waypoints = along === undefined ? [] : this.host.study.get(along)?.waypoints ?? [];
    const path = dedupePoints([{ x: token.cx, y: token.cy }, ...waypoints.map(({ x, y }) => ({ x, y })), anchor]);
    const { segLengths, totalDist } = computeSegLengths(path);
    Object.assign(token, { path, segLengths, totalDist, travelled: 0, at: along ?? to });
    // An activity takes a moment; an expanded container is walked through, so the token does not rest on it.
    const pause = isBpmnSubtypeOf(target.type, 'bpmn:Activity') && !target.expanded ? ACTIVITY_PAUSE_MS : 0;
    const current = token;
    return new Promise((resolve, reject) => {
      current.stop = reject;
      current.arrive = () => {
        current.at = to;
        current.pauseRemaining = pause;
        current.arrive = resolve;
        if (pause === 0) this.settle(current);
      };
      if (totalDist === 0) current.arrive();
    });
  }

  /** The walk leaves an element: at an end event of what is walked (not a sub-process's own), the pool's token pops. */
  private passed(run: Run, plan: Plan, id: string): void {
    const element = plan.elements[id];
    if (element?.type !== 'endEvent' || !plan.processes.includes(element.parent ?? '')) return;
    const token = [...run.tokens.values()].find((candidate) => candidate.at === id && !candidate.done);
    if (token) this.pop(token);
  }

  private settle(token: Token): void {
    const arrive = token.arrive;
    token.arrive = token.stop = undefined;
    arrive?.();
  }

  private tick = (timestamp: number): void => {
    if (!this.active) return;
    const dt = Math.min((timestamp - this.lastTimestamp) / 1000, 0.1);
    this.lastTimestamp = timestamp;
    for (const token of this.tokens()) {
      this.syncVisibility(token);
      if (token.bouncing || token.done) continue;
      if (token.pauseRemaining > 0) {
        token.pauseRemaining -= dt * 1000;
        if (token.pauseRemaining <= 0) this.settle(token);
      } else if (token.totalDist > 0) {
        token.travelled += TOKEN_SPEED * dt;
        const progress = smootherstep(Math.min(token.travelled / token.totalDist, 1));
        const point = samplePolyline(token.path, token.segLengths, progress * token.totalDist);
        this.place(token, point.x, point.y);
        if (progress >= 1) {
          token.totalDist = 0;
          token.arrive?.();
        }
      }
    }
    for (const run of this.runs) for (const [pool, token] of run.tokens) if (token.done) run.tokens.delete(pool);
    this.runs = this.runs.filter((run) => run.tokens.size > 0 || !run.over);
    this.frame = requestAnimationFrame(this.tick);
  };

  /** The `studyflow-simulation-token` class is the selector e2e tests count tokens by. */
  private createToken(color: string, at: Point, element: string): Token {
    const svg = this.layer!.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'circle');
    svg.setAttribute('r', String(TOKEN_RADIUS));
    svg.setAttribute('class', 'studyflow-simulation-token');
    svg.style.fill = color;
    this.layer!.appendChild(svg);
    const token: Token = {
      svg, cx: at.x, cy: at.y, path: [], segLengths: [], totalDist: 0, travelled: 0, pauseRemaining: 0,
      at: element, hidden: false, bouncing: false, done: false,
    };
    this.place(token, at.x, at.y);
    this.syncVisibility(token);
    return token;
  }

  private place(token: Token, x: number, y: number): void {
    token.cx = x;
    token.cy = y;
    token.svg.setAttribute('cx', String(x));
    token.svg.setAttribute('cy', String(y));
  }

  private syncVisibility(token: Token): void {
    const hidden = !this.host.canvas.draws(token.at);
    if (hidden === token.hidden) return;
    token.hidden = hidden;
    token.svg.style.display = hidden ? 'none' : '';
  }

  private pop(token: Token): void {
    token.svg.style.transformOrigin = `${token.cx}px ${token.cy}px`;
    token.svg.style.animation = 'token-pop 0.35s ease-out forwards';
    token.done = true;
    setTimeout(() => token.svg.remove(), 380);
  }

  private fadeOut(token: Token): void {
    token.svg.style.transition = 'opacity 0.4s';
    token.svg.style.opacity = '0';
    token.done = true;
    setTimeout(() => token.svg.remove(), 450);
  }

  /** Where a walk stopped short of an end event, its token stays, bouncing; only so many stand on one element. */
  private bounce(token: Token): void {
    const here = this.tokens().filter((other) => other.bouncing && other.at === token.at);
    if (here.length >= MAX_BOUNCING_PER_ELEMENT) this.fadeOut(here[0]);
    const element = this.host.study.get(token.at);
    if (element?.bounds) {
      const anchor = tokenAnchor(element);
      this.place(token, anchor.x + (here.length - (MAX_BOUNCING_PER_ELEMENT - 1) / 2) * TOKEN_RADIUS * 2.5, anchor.y);
    }
    token.bouncing = true;
    token.svg.style.transformOrigin = `${token.cx}px ${token.cy}px`;
    token.svg.style.animation = 'token-bounce 0.5s ease-in-out infinite alternate';
  }

  private ensureKeyframes(): void {
    if (document.getElementById('token-bounce-keyframes')) return;
    const style = document.createElement('style');
    style.id = 'token-bounce-keyframes';
    style.textContent = `
    @keyframes token-bounce {
      0%   { transform: translateY(0); }
      100% { transform: translateY(-8px); }
    }
    @keyframes token-pop {
      0%   { transform: scale(1); opacity: 1; }
      40%  { transform: scale(1.8); opacity: 0.8; }
      100% { transform: scale(2.5); opacity: 0; }
    }
  `;
    document.head.appendChild(style);
  }
}
