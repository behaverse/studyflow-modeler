import { executeCommand } from '@/modeler/controllers/commands';
import type { Injector, PopupMenu } from '@/modeler/infra/bpmn-js.d';

const COLORS: Array<{ label: string; fill: string | undefined; stroke: string | undefined }> = [
  { label: 'Default', fill: undefined, stroke: undefined },
  { label: 'Blue',    fill: '#DDE8FA', stroke: '#728CB9' },
  { label: 'Orange',  fill: '#FBE7CF', stroke: '#CE9D35' },
  { label: 'Green',   fill: '#D9E7D6', stroke: '#8CB26E' },
  { label: 'Red',     fill: '#F1D0CD', stroke: '#AC5A54' },
  { label: 'Purple',  fill: '#DFD5E6', stroke: '#9174A3' },
];

const DEFAULT_FILL = 'white';
const DEFAULT_STROKE = 'rgb(34, 36, 42)';

const SWATCH_TEMPLATE = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 25" height="100%" width="100%">
    <rect rx="2" x="1" y="1" width="22" height="22" fill="var(--fill-color)" stroke="var(--stroke-color)" style="stroke-width:2"></rect>
  </svg>
`;

/** Adds rounded-rect swatch entries to bpmn-js's `color-picker` popup. */
export default class ColorPickerProvider {
  static $inject = ['config.colorPicker', 'popupMenu', 'injector'];

  private injector: Injector;

  constructor(_config: unknown, popupMenu: PopupMenu, injector: Injector) {
    this.injector = injector;
    popupMenu.registerProvider('color-picker', this);
  }

  getEntries(elements: any[]) {
    return COLORS.map((color) => ({
      title: color.label,
      id: `${color.label.toLowerCase()}-color`,
      imageHtml: SWATCH_TEMPLATE
        .replace('var(--fill-color)', color.fill || DEFAULT_FILL)
        .replace('var(--stroke-color)', color.stroke || DEFAULT_STROKE),
      action: () => executeCommand(this.injector as any, {
        type: 'set-color',
        elements,
        color,
      }),
    }));
  }
}
