import { is } from 'bpmn-js/lib/util/ModelUtil';
import { create as svgCreate, attr as svgAttr, append as svgAppend, remove as svgRemove } from 'tiny-svg';

const TOKEN_RADIUS = 8;
const TOKEN_SPEED = 200; // pixels per sec
const ACTIVITY_PAUSE_MS = 500; // pause at activities before moving on
const SPAWN_INTERVAL_MS = 1000;  // how often to spawn new tokens

const TOKEN_COLORS = [
  '#e040fb', // pink
  '#00bcd4', // teal
  '#ff9800', // orange
  '#4caf50', // green
  '#2196f3', // blue
];

export const TOGGLE_SIMULATION_EVENT = 'tokenSimulation.toggle';

export default function TokenSimulation(eventBus, elementRegistry, canvas) {
  this._eventBus = eventBus;
  this._elementRegistry = elementRegistry;
  this._canvas = canvas;

  this._active = false;
  this._tokens = [];       // active token state objects
  this._animFrameId = null;
  this._spawnIntervalId = null;
  this._layer = null;
  this._colorIndex = 0;
  this._lastTimestamp = 0;
}

TokenSimulation.$inject = ['eventBus', 'elementRegistry', 'canvas'];

TokenSimulation.prototype.toggle = function () {
  if (this._active) {
    this.stop();
  } else {
    this.start();
  }
};

TokenSimulation.prototype.start = function () {
  if (this._active) return;
  this._active = true;
  this._ensureBounceKeyframes();
  this._layer = this._canvas.getLayer('token-simulation', 1000);

  // find all start events
  this._startEvents = this._elementRegistry.filter(
    el => is(el, 'bpmn:StartEvent') && el.type !== 'label'
  );

  // spawn the first token immediately
  for (const se of this._startEvents) {
    this._spawnToken(se);
  }

  // then keep spawning at a fixed interval (capped to TOKEN_COLORS tokens)
  this._spawnIntervalId = setInterval(() => {
    if (!this._active) return;
    const activeCount = this._tokens.filter(t => !t.done).length;
    if (activeCount >= TOKEN_COLORS.length) return;
    for (const se of this._startEvents) {
      this._spawnToken(se);
    }
  }, SPAWN_INTERVAL_MS);

  this._lastTimestamp = performance.now();
  this._tick = this._tick.bind(this);
  this._animFrameId = requestAnimationFrame(this._tick);

  this._eventBus.fire(TOGGLE_SIMULATION_EVENT, { active: true });
};

TokenSimulation.prototype.stop = function () {
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

  // remove all token SVGs
  for (const token of this._tokens) {
    if (token.svg) {
      svgRemove(token.svg);
    }
  }
  this._tokens = [];

  this._eventBus.fire(TOGGLE_SIMULATION_EVENT, { active: false });
};

// animation loop
TokenSimulation.prototype._tick = function (timestamp) {
  if (!this._active) return;

  // cap dt to avoid jumps
  const dt = Math.min((timestamp - this._lastTimestamp) / 1000, 0.1);
  this._lastTimestamp = timestamp;

  for (let i = 0; i < this._tokens.length; i++) {
    const token = this._tokens[i];

    if (token.bouncing) {
      // bouncing is handled via CSS animation, skip
      continue;
    }

    if (token.paused) {
      token.pauseRemaining -= dt * 1000;
      if (token.pauseRemaining <= 0) {
        token.paused = false;
      }
      continue;
    }

    if (token.totalDist > 0) {
      this._moveAlongPath(token, dt);
    }
  }

  // remove finished tokens outside the loop
  for (let i = this._tokens.length - 1; i >= 0; i--) {
    if (this._tokens[i].done) {
      svgRemove(this._tokens[i].svg);
      this._tokens.splice(i, 1);
    }
  }

  this._animFrameId = requestAnimationFrame(this._tick);
};

/**
 * Move token along its pre-computed path using eased progress.
 */
TokenSimulation.prototype._moveAlongPath = function (token, dt) {
  const speed = TOKEN_SPEED;
  token.travelled += speed * dt;

  // raw linear 0->1
  let t = Math.min(token.travelled / token.totalDist, 1);

  // apply ease-in-out for smooth accel / decel
  t = smootherstep(t);

  // find position at parameter t along polyline
  const targetDist = t * token.totalDist;
  const pos = samplePolyline(token.pathPoints, token.segLengths, targetDist);
  this._setTokenPos(token, pos.x, pos.y);

  if (t >= 1) {
    this._onTokenArrived(token);
  }
};


TokenSimulation.prototype._spawnToken = function (element) {
  const color = TOKEN_COLORS[this._colorIndex % TOKEN_COLORS.length];
  this._colorIndex++;

  const svg = svgCreate('circle');
  svgAttr(svg, {
    cx: 0,
    cy: 0,
    r: TOKEN_RADIUS,
  });
  svg.style.fill = color;
  // svg.style.stroke = '#fff';
  // svg.style.strokeWidth = '1';
  // svg.style.opacity = '0.95';
  // svg.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))';

  svgAppend(this._layer, svg);

  const cx = element.x + (element.width / 2);
  const cy = element.y + (element.height / 2);

  const token = {
    svg,
    color,
    // path state
    pathPoints: [],
    segLengths: [],
    totalDist: 0,
    travelled: 0,
    targetElement: null,
    // pause state
    paused: false,
    pauseRemaining: 0,
    done: false,
    // bounce state
    bouncing: false,
    bounceElementId: null,
    // current position (for building next path)
    cx,
    cy,
  };

  this._setTokenPos(token, cx, cy);
  this._tokens.push(token);

  // proceed from this element after a delay
  this._advanceFromElement(token, element);
};

TokenSimulation.prototype._advanceFromElement = function (token, element) {

  // End event -> pop token
  if (is(element, 'bpmn:EndEvent')) {
    this._popToken(token);
    return;
  }

  const outgoing = (element.outgoing || []).filter(
    c => is(c, 'bpmn:SequenceFlow')
  );

  if (outgoing.length === 0) {
    // dead end but not an EndEvent -> bounce in place
    const elId = element.id;
    const bouncingHere = this._tokens.filter(t => t.bouncing && t.bounceElementId === elId);
    if (bouncingHere.length >= 5) {
      // fade out the oldest one to make room
      this._fadeOutToken(bouncingHere[0]);
    }
    // spread tokens along x so they don't overlap (centered on element)
    const count = bouncingHere.length;
    const spacing = TOKEN_RADIUS * 2.5;
    const offsetX = (count - (5 - 1) / 2) * spacing;
    const baseCx = element.x + (element.width / 2);
    token.cx = baseCx + offsetX;
    this._setTokenPos(token, token.cx, token.cy);
    this._startBounce(token, elId);
    return;
  }

  // fork
  if (is(element, 'bpmn:ParallelGateway') ||
      is(element, 'bpmn:InclusiveGateway')) {
    if (outgoing.length > 1) {
      // Reuse existing token for the first flow
      this._sendTokenAlongFlow(token, outgoing[0]);

      // Spawn a new token for each additional outgoing flow
      for (let i = 1; i < outgoing.length; i++) {
        const clone = this._cloneToken(token);
        this._sendTokenAlongFlow(clone, outgoing[i]);
      }
      return;
    }
  }

  // Exclusive/random gateways -> pick one
  if (outgoing.length > 1) {
    const flow = outgoing[Math.floor(Math.random() * outgoing.length)];
    this._sendTokenAlongFlow(token, flow);
    return;
  }

  // Single outgoing flow
  this._sendTokenAlongFlow(token, outgoing[0]);
};

/**
 * Build a smooth path: current position -> flow waypoints -> center.
 */
TokenSimulation.prototype._sendTokenAlongFlow = function (token, flow) {
  const waypoints = flow.waypoints;

  if (!waypoints || waypoints.length < 2) {
    this._fadeOutToken(token);
    return;
  }

  const target = flow.target;
  const targetCx = target.x + (target.width / 2);
  const targetCy = target.y + (target.height / 2);

  // Build full path: [current pos] + flow waypoints + [center]
  const points = [
    { x: token.cx, y: token.cy },
    ...waypoints.map(wp => ({ x: wp.x, y: wp.y })),
    { x: targetCx, y: targetCy },
  ];

  // Remove duplicate consecutive points (e.g. if token is already at first wp)
  const cleaned = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = cleaned[cleaned.length - 1];
    const cur = points[i];
    if (Math.abs(cur.x - prev.x) > 0.5 || Math.abs(cur.y - prev.y) > 0.5) {
      cleaned.push(cur);
    }
  }

  // Pre-compute segment lengths
  const segLengths = [];
  let totalDist = 0;
  for (let i = 0; i < cleaned.length - 1; i++) {
    const dx = cleaned[i + 1].x - cleaned[i].x;
    const dy = cleaned[i + 1].y - cleaned[i].y;
    const len = Math.sqrt(dx * dx + dy * dy);
    segLengths.push(len);
    totalDist += len;
  }

  token.pathPoints = cleaned;
  token.segLengths = segLengths;
  token.totalDist = totalDist;
  token.travelled = 0;
  token.targetElement = target;
};

TokenSimulation.prototype._onTokenArrived = function (token) {
  const target = token.targetElement;

  // reset path state
  token.pathPoints = [];
  token.segLengths = [];
  token.totalDist = 0;
  token.travelled = 0;
  token.targetElement = null;

  if (!target) {
    this._fadeOutToken(token);
    return;
  }

  // Update stored position to target center
  token.cx = target.x + (target.width / 2);
  token.cy = target.y + (target.height / 2);

  // Pause at activities
  if (is(target, 'bpmn:Activity') || is(target, 'bpmn:SubProcess')) {
    token.paused = true;
    token.pauseRemaining = ACTIVITY_PAUSE_MS;

    // schedule advance after the pause
    setTimeout(() => {
      if (this._active && !token.done) {
        this._advanceFromElement(token, target);
      }
    }, ACTIVITY_PAUSE_MS);
  } else {
    // gateways, events, etc. — advance immediately
    this._advanceFromElement(token, target);
  }
};

/**
 * Clone an existing token at the same position (used for parallel forks).
 */
TokenSimulation.prototype._cloneToken = function (source) {
  const color = source.color;

  const svg = svgCreate('circle');
  svgAttr(svg, { cx: source.cx, cy: source.cy, r: TOKEN_RADIUS });
  svg.style.fill = color;
  svg.style.stroke = '#fff';
  svg.style.strokeWidth = '2';
  svg.style.opacity = '0.9';
  svg.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))';

  svgAppend(this._layer, svg);

  const clone = {
    svg,
    color,
    pathPoints: [],
    segLengths: [],
    totalDist: 0,
    travelled: 0,
    targetElement: null,
    paused: false,
    pauseRemaining: 0,
    done: false,
    // bounce state
    bouncing: false,
    bounceElementId: null,
    cx: source.cx,
    cy: source.cy,
  };

  this._tokens.push(clone);
  return clone;
};

TokenSimulation.prototype._setTokenPos = function (token, x, y) {
  token.cx = x;
  token.cy = y;
  svgAttr(token.svg, { cx: x, cy: y });
};

TokenSimulation.prototype._fadeOutToken = function (token) {
  // fade-out via opacity transition
  token.svg.style.transition = 'opacity 0.4s';
  token.svg.style.opacity = '0';
  setTimeout(() => {
    token.done = true;
  }, 450);
};

TokenSimulation.prototype._popToken = function (token) {
  // balloon-pop: scale up fast then disappear
  token.svg.style.transformOrigin = token.cx + 'px ' + token.cy + 'px';
  token.svg.style.animation = 'token-pop 0.35s ease-out forwards';
  setTimeout(() => {
    token.done = true;
  }, 380);
};

TokenSimulation.prototype._startBounce = function (token, elementId) {
  token.bouncing = true;
  token.bounceElementId = elementId || null;
  // Use CSS animation for the bounce
  token.svg.style.transformOrigin = token.cx + 'px ' + token.cy + 'px';
  token.svg.style.animation = 'token-bounce 0.5s ease-in-out infinite alternate';
};

/**
 * Ensure the bounce keyframes are injected into the document once.
 */
TokenSimulation.prototype._ensureBounceKeyframes = function () {
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
};

/**
 * smoother interpolation
 * Maps 0->1 to 0->1 with zero first AND second derivatives at endpoints.
 */
function smootherstep(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Sample a position along a polyline at a given distance from the start.
 */
function samplePolyline(points, segLengths, dist) {
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
  // past the end; return last point
  return points[points.length - 1];
}
