/**
 * Token simulation, written against the {@link EditorPort} rather than diagram-js DI.
 *
 * P6b §3D: this used to be a `didi` service (`$inject = ['eventBus','elementRegistry','canvas']`)
 * drawing through `tiny-svg` — a dependency that only resolves while bpmn-js is in
 * `node_modules` (§2c). It now takes a {@link SimulationHost}, a structural subset of
 * `EditorPort` (`events` + `elements` + `view`), so both backends drive one implementation:
 *
 * - the canvas backend constructs it directly over its port (`editor/canvasBackend.ts`);
 * - the bpmn backend keeps its DI registration, adapting the three services onto the same
 *   host shape (`simulation/module.ts`).
 *
 * The SVG helpers come from the canvas's dependency-free `render/svg.ts`, which
 * reimplements exactly the `create`/`attr`/`append`/`remove` quartet used here.
 */

import { is } from '@modeler/editor/port';
import type { EditorElement, EditorElements, EditorEvents, EditorView } from '@modeler/editor/port';
import {
  create as svgCreate,
  attr as svgAttr,
  append as svgAppend,
  remove as svgRemove,
} from '@canvas/render/svg.ts';
import { nextHops } from '@modeler/simulation/flowWalk';

export type Point = { x: number; y: number };

/**
 * What the simulator needs from the editor — a structural subset of `EditorPort`, so
 * a whole port satisfies it and a hand-built adapter (or a test fake) does too.
 *
 * - `events` carries `root.set` in and {@link TOGGLE_SIMULATION_EVENT} out;
 * - `elements` finds the start events to spawn from, scoped to the current root;
 * - `view.getLayer('token-simulation', 1000)` is the `<g>` tokens are drawn into. Both
 *   backends put custom layers in the diagram's own coordinate space (diagram-js layers
 *   sit under the viewport transform; the canvas applies pan/zoom to the root `viewBox`),
 *   so token positions are plain element coordinates on either.
 */
export interface SimulationHost {
  events: Pick<EditorEvents, 'on' | 'off' | 'fire'>;
  elements: Pick<EditorElements, 'filter' | 'root' | 'findRoot'>;
  view: Pick<EditorView, 'getLayer'>;
}

const TOKEN_RADIUS = 8;

/** The `studyflow-simulation-token` class is the selector e2e tests count tokens by. */
function createTokenSvg(layer: any, color: string, cx = 0, cy = 0): any {
  const svg = svgCreate('circle');
  svgAttr(svg, { cx, cy, r: TOKEN_RADIUS, class: 'studyflow-simulation-token' });
  svg.style.fill = color;
  svgAppend(layer, svg);
  return svg;
}

function updateTokenPosition(svg: any, cx: number, cy: number): void {
  svgAttr(svg, { cx, cy });
}

function removeTokenSvg(svg: any): void {
  svgRemove(svg);
}

/** Perlin's smootherstep: zero first and second derivatives at both ends. */
export function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function computeSegLengths(points: Point[]): { segLengths: number[]; totalDist: number } {
  const segLengths: number[] = [];
  let totalDist = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const len = Math.sqrt(dx * dx + dy * dy);
    segLengths.push(len);
    totalDist += len;
  }
  return { segLengths, totalDist };
}

export function samplePolyline(points: Point[], segLengths: number[], dist: number): Point {
  let remaining = dist;
  for (let i = 0; i < segLengths.length; i++) {
    if (remaining <= segLengths[i]) {
      const t = segLengths[i] > 0 ? remaining / segLengths[i] : 0;
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      };
    }
    remaining -= segLengths[i];
  }
  return points[points.length - 1];
}

const TOKEN_SPEED = 200; // pixels per sec
const ACTIVITY_PAUSE_MS = 500;
const SPAWN_INTERVAL_MS = 1000;
const MAX_BOUNCING_PER_ELEMENT = 5;

const TOKEN_COLORS = [
  '#e040fb',
  '#00bcd4',
  '#ff9800',
  '#4caf50',
  '#2196f3',
];

export const TOGGLE_SIMULATION_EVENT = 'tokenSimulation.toggle';

/** The custom layer tokens are drawn into, and its z-order hint (above everything). */
const TOKEN_LAYER = 'token-simulation';
const TOKEN_LAYER_INDEX = 1000;

interface Token {
  svg: any;
  color: string;
  pathPoints: Point[];
  segLengths: number[];
  totalDist: number;
  travelled: number;
  targetElement: any | null;
  paused: boolean;
  pauseRemaining: number;
  done: boolean;
  bouncing: boolean;
  bounceElementId: string | null;
  cx: number;
  cy: number;
}

function makeToken(svg: any, color: string, cx: number, cy: number): Token {
  return {
    svg, color, cx, cy,
    pathPoints: [],
    segLengths: [],
    totalDist: 0,
    travelled: 0,
    targetElement: null,
    paused: false,
    pauseRemaining: 0,
    done: false,
    bouncing: false,
    bounceElementId: null,
  };
}

export default class TokenSimulator {
  private _host: SimulationHost;

  private _active = false;
  private _tokens: Token[] = [];
  private _animFrameId: number | null = null;
  private _spawnIntervalId: number | null = null;
  private _layer: any = null;
  private _colorIndex = 0;
  private _lastTimestamp = 0;
  private _startEvents: any[] = [];

  constructor(host: SimulationHost) {
    this._host = host;
    this._host.events.on('root.set', this._handleRootSet);
  }

  /** Stop, and let go of the editor. Called when the backend is torn down. */
  dispose(): void {
    this.stop();
    this._host.events.off('root.set', this._handleRootSet);
  }

  isActive(): boolean {
    return this._active;
  }

  toggle() {
    if (this._active) this.stop();
    else this.start();
  }

  start() {
    if (this._active) return;
    this._active = true;
    this._ensureBounceKeyframes();
    this._layer = this._host.view.getLayer(TOKEN_LAYER, TOKEN_LAYER_INDEX);

    this._startEvents = this._getVisibleStartEvents();
    for (const startEvent of this._startEvents) this._spawnToken(startEvent);

    this._spawnIntervalId = window.setInterval(() => {
      if (!this._active) return;
      const activeCount = this._tokens.filter((token) => !token.done).length;
      if (activeCount >= TOKEN_COLORS.length) return;
      for (const startEvent of this._startEvents) this._spawnToken(startEvent);
    }, SPAWN_INTERVAL_MS);

    this._lastTimestamp = performance.now();
    this._animFrameId = requestAnimationFrame(this._tick);

    this._host.events.fire(TOGGLE_SIMULATION_EVENT, { active: true });
  }

  stop() {
    if (!this._active) return;
    this._active = false;

    if (this._spawnIntervalId) {
      clearInterval(this._spawnIntervalId);
      this._spawnIntervalId = null;
    }

    if (this._animFrameId) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }

    this._clearTokens();
    this._startEvents = [];

    this._host.events.fire(TOGGLE_SIMULATION_EVENT, { active: false });
  }

  private _handleRootSet = () => {
    if (!this._active) return;
    // An import replaces the diagram — and with it the layer, which both backends
    // drop on `Layers.clear()` / `Canvas.clear()`. Re-fetch rather than reuse.
    this._layer = this._host.view.getLayer(TOKEN_LAYER, TOKEN_LAYER_INDEX);
    this._startEvents = this._getVisibleStartEvents();
    this._clearTokens();
    for (const startEvent of this._startEvents) this._spawnToken(startEvent);
  };

  /**
   * Top-level start events on the current root plane.
   *
   * The parent test is written for both element models: diagram-js parents a
   * top-level shape on the root element itself, while a canvas scene element at the
   * top of a plane simply has no `parent` — and the canvas registry spans every
   * plane, so those need `findRoot` to keep a nested plane's start events out.
   */
  private _getVisibleStartEvents(): EditorElement[] {
    const root = this._rootElement();
    if (!root) return [];
    return this._host.elements.filter(
      (el: EditorElement) => is(el, 'bpmn:StartEvent')
        && el.type !== 'label'
        && !el.labelTarget
        && (el.parent === root || (!el.parent && this._host.elements.findRoot(el) === root)),
    );
  }

  /** The current root, or `undefined` before anything is imported (the canvas throws). */
  private _rootElement(): EditorElement | undefined {
    try {
      return this._host.elements.root() ?? undefined;
    } catch {
      return undefined;
    }
  }

  private _clearTokens() {
    for (const token of this._tokens) {
      token.done = true;

      if (token.svg) {
        removeTokenSvg(token.svg);
      }
    }

    this._tokens = [];
  }

  private _tick = (timestamp: number) => {
    if (!this._active) return;

    // Capped: a backgrounded tab returns one huge frame delta.
    const dt = Math.min((timestamp - this._lastTimestamp) / 1000, 0.1);
    this._lastTimestamp = timestamp;

    for (const token of this._tokens) {
      if (token.bouncing) continue; // driven by CSS animation, not this loop
      if (token.paused) {
        token.pauseRemaining -= dt * 1000;
        if (token.pauseRemaining <= 0) token.paused = false;
        continue;
      }
      if (token.totalDist > 0) this._moveAlongPath(token, dt);
    }

    for (let i = this._tokens.length - 1; i >= 0; i--) {
      if (this._tokens[i].done) {
        removeTokenSvg(this._tokens[i].svg);
        this._tokens.splice(i, 1);
      }
    }

    this._animFrameId = requestAnimationFrame(this._tick);
  };

  private _moveAlongPath(token: Token, dt: number) {
    token.travelled += TOKEN_SPEED * dt;
    const progress = smootherstep(Math.min(token.travelled / token.totalDist, 1));
    const point = samplePolyline(token.pathPoints, token.segLengths, progress * token.totalDist);
    this._setTokenPos(token, point.x, point.y);
    if (progress >= 1) this._onTokenArrived(token);
  }

  private _spawnToken(element: any) {
    const color = TOKEN_COLORS[this._colorIndex++ % TOKEN_COLORS.length];
    const cx = element.x + element.width / 2;
    const cy = element.y + element.height / 2;
    const token = makeToken(createTokenSvg(this._layer, color), color, cx, cy);

    this._setTokenPos(token, cx, cy);
    this._tokens.push(token);
    this._advanceFromElement(token, element);
  }

  private _advanceFromElement(token: Token, element: any) {
    const hop = nextHops(element);

    if (hop.kind === 'end') {
      this._popToken(token);
      return;
    }

    if (hop.kind === 'deadend') {
      const elId = element.id;
      const bouncingHere = this._tokens.filter((t) => t.bouncing && t.bounceElementId === elId);
      if (bouncingHere.length >= MAX_BOUNCING_PER_ELEMENT) this._fadeOutToken(bouncingHere[0]);

      const spacing = TOKEN_RADIUS * 2.5;
      const offsetX = (bouncingHere.length - (MAX_BOUNCING_PER_ELEMENT - 1) / 2) * spacing;
      token.cx = element.x + element.width / 2 + offsetX;
      this._setTokenPos(token, token.cx, token.cy);
      this._startBounce(token, elId);
      return;
    }

    if (hop.kind === 'fork') {
      this._sendTokenAlongFlow(token, hop.flows[0]);
      for (let i = 1; i < hop.flows.length; i++) {
        this._sendTokenAlongFlow(this._cloneToken(token), hop.flows[i]);
      }
      return;
    }

    this._sendTokenAlongFlow(token, hop.flows[0]);
  }

  private _sendTokenAlongFlow(token: Token, flow: any) {
    const waypoints = flow.waypoints;

    if (!waypoints || waypoints.length < 2) {
      this._fadeOutToken(token);
      return;
    }

    const target = flow.target;
    const targetCx = target.x + (target.width / 2);
    const targetCy = target.y + (target.height / 2);

    const points: Point[] = [
      { x: token.cx, y: token.cy },
      ...waypoints.map((wp: any) => ({ x: wp.x, y: wp.y })),
      { x: targetCx, y: targetCy },
    ];

    const cleaned: Point[] = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const prev = cleaned[cleaned.length - 1];
      const cur = points[i];
      if (Math.abs(cur.x - prev.x) > 0.5 || Math.abs(cur.y - prev.y) > 0.5) {
        cleaned.push(cur);
      }
    }

    const { segLengths, totalDist } = computeSegLengths(cleaned);

    token.pathPoints = cleaned;
    token.segLengths = segLengths;
    token.totalDist = totalDist;
    token.travelled = 0;
    token.targetElement = target;
  }

  private _onTokenArrived(token: Token) {
    const target = token.targetElement;
    token.pathPoints = [];
    token.segLengths = [];
    token.totalDist = 0;
    token.travelled = 0;
    token.targetElement = null;

    if (!target) {
      this._fadeOutToken(token);
      return;
    }

    token.cx = target.x + target.width / 2;
    token.cy = target.y + target.height / 2;

    if (is(target, 'bpmn:Activity') || is(target, 'bpmn:SubProcess')) {
      token.paused = true;
      token.pauseRemaining = ACTIVITY_PAUSE_MS;
      setTimeout(() => {
        if (this._active && !token.done) this._advanceFromElement(token, target);
      }, ACTIVITY_PAUSE_MS);
    } else {
      this._advanceFromElement(token, target);
    }
  }

  private _cloneToken(source: Token) {
    const svg = createTokenSvg(this._layer, source.color, source.cx, source.cy);
    svg.style.stroke = '#fff';
    svg.style.strokeWidth = '2';
    svg.style.opacity = '0.9';
    svg.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))';

    const clone = makeToken(svg, source.color, source.cx, source.cy);
    this._tokens.push(clone);
    return clone;
  }

  private _setTokenPos(token: Token, x: number, y: number) {
    token.cx = x;
    token.cy = y;
    updateTokenPosition(token.svg, x, y);
  }

  private _fadeOutToken(token: Token) {
    token.svg.style.transition = 'opacity 0.4s';
    token.svg.style.opacity = '0';
    setTimeout(() => { token.done = true; }, 450);
  }

  private _popToken(token: Token) {
    token.svg.style.transformOrigin = token.cx + 'px ' + token.cy + 'px';
    token.svg.style.animation = 'token-pop 0.35s ease-out forwards';
    setTimeout(() => { token.done = true; }, 380);
  }

  private _startBounce(token: Token, elementId?: string) {
    token.bouncing = true;
    token.bounceElementId = elementId || null;
    token.svg.style.transformOrigin = token.cx + 'px ' + token.cy + 'px';
    token.svg.style.animation = 'token-bounce 0.5s ease-in-out infinite alternate';
  }

  private _ensureBounceKeyframes() {
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
