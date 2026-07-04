/**
 * Central registry of icon classes used across the modeler and runner.
 *
 * Every value is an Iconify class (`iconify <collection>--<name>`) consumed by
 * the app's icon rendering. Referencing these by name — `ICONS.close` rather
 * than the raw `'iconify bi--x-lg'` string inlined in a component — keeps the
 * icon set greppable, changeable in one place, and self-documenting.
 *
 * Element-type icons the schemas declare (via `meta.icon`) live in the schema
 * YAML, not here; this registry is for icons chosen in code.
 */
export const ICONS = {
  // --- Controls & chrome ---
  close: 'iconify bi--x-lg',
  closeSmall: 'iconify bi--x',
  closeAlt: 'iconify mdi--close',
  caretDown: 'iconify bi--caret-down',
  chevronRight: 'iconify bi--chevron-right',
  menu: 'iconify solar--hamburger-menu-linear',
  threeDots: 'iconify bi--three-dots',
  search: 'iconify bi--search',
  plus: 'iconify bi--plus',
  plusBox: 'iconify mdi--plus-box-outline',
  plusAlt: 'iconify mdi--plus',
  pencil: 'iconify bi--pencil',
  gear: 'iconify bi--gear',
  cog: 'iconify mdi--cog-outline',
  list: 'iconify bi--list',
  grid: 'iconify bi--grid-1x2',
  fullscreen: 'iconify bi--fullscreen',
  sidebarExpand: 'iconify tabler--layout-sidebar-right-expand-filled',
  sidebarCollapse: 'iconify tabler--layout-sidebar-right-collapse-filled',
  help: 'iconify bi--patch-question',
  book: 'iconify bi--book',
  arrowLeft: 'iconify bi--arrow-left',
  arrowRepeat: 'iconify bi--arrow-repeat',
  arrowClockwise: 'iconify bi--arrow-clockwise',
  loop: 'iconify mdi--loop',
  asterisk: 'iconify mdi--asterisk',
  tilde: 'iconify tabler--tilde',

  // --- Playback / run ---
  play: 'iconify bi--play',
  playFill: 'iconify bi--play-fill',
  stop: 'iconify bi--stop',

  // --- Files & IO ---
  document: 'iconify fluent--document-24-regular',
  folderOpen: 'iconify bi--folder2-open',
  fileNew: 'iconify bi--file-earmark-plus',
  fileYaml: 'iconify bi--filetype-yml',
  fileXml: 'iconify bi--filetype-xml',
  fileSvg: 'iconify bi--filetype-svg',
  filePng: 'iconify bi--filetype-png',
  fileJson: 'iconify bi--filetype-json',
  download: 'iconify bi--download',
  boxArrowUp: 'iconify bi--box-arrow-up',
  boxArrowInDown: 'iconify bi--box-arrow-in-down',

  // --- People & accounts ---
  person: 'iconify bi--person',
  peopleTeam: 'iconify fluent--people-team-24-regular',
  handLeft: 'iconify fluent--hand-left-24-regular',
  envelope: 'iconify bi--envelope-fill',
  envelopeOpen: 'iconify bi--envelope-open',
  google: 'iconify bi--google',
  github: 'iconify bi--github',

  // --- Data & structure ---
  table: 'iconify bi--table',
  tableAlt: 'iconify mdi--table',
  database: 'iconify fluent--database-16-regular',
  collection: 'iconify bi--collection',
  diagram: 'iconify bi--diagram-3',
  barChartSteps: 'iconify bi--bar-chart-steps',
  script: 'iconify fluent--script-24-regular',
  function: 'iconify mdi--function',
  broadcast: 'iconify bi--broadcast-pin',
  checkSquare: 'iconify bi--check2-square',
  checkbox: 'iconify mdi--checkbox-outline',
  radioBlank: 'iconify mdi--checkbox-blank-circle-outline',

  // --- Geometric primitives ---
  square: 'iconify fluent--square-16-regular',
  squareDashed: 'iconify mynaui--square-dashed',
  inkSelection: 'iconify material-symbols--ink-selection-rounded',
  circle: 'iconify fluent--circle-16-regular',
  diamond: 'iconify fluent--diamond-16-regular',
  pentagon: 'iconify mdi--pentagon-outline',
  hexagon: 'iconify tabler--hexagon',

  // --- BPMN element type icons ---
  bpmnTask: 'iconify bpmn--task-none',
  bpmnUserTask: 'iconify bpmn--user-task',
  bpmnServiceTask: 'iconify bpmn--service-task',
  bpmnScriptTask: 'iconify bpmn--script-task',
  bpmnManualTask: 'iconify bpmn--manual-task',
  bpmnSubprocess: 'iconify bpmn--subprocess-collapsed',
  bpmnStartEvent: 'iconify bpmn--start-event-none',
  bpmnIntermediateEvent: 'iconify bpmn--intermediate-event-none',
  bpmnEndEvent: 'iconify bpmn--end-event-none',
  bpmnGatewayXor: 'iconify bpmn--gateway-xor',
  bpmnGatewayOr: 'iconify bpmn--gateway-or',
  bpmnGatewayParallel: 'iconify bpmn--gateway-parallel',
  bpmnGatewayComplex: 'iconify bpmn--gateway-complex',
  bpmnGatewayEventBased: 'iconify bpmn--gateway-eventbased',
  bpmnParticipant: 'iconify bpmn--participant',
  bpmnGroup: 'iconify bpmn--group',
  bpmnCompensationMarker: 'iconify bpmn--compensation-marker',
} as const;

export type IconName = keyof typeof ICONS;
