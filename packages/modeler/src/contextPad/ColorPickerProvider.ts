import { executeCommand } from '@modeler/commandBus';
import { DEFAULT_FILL, DEFAULT_STROKE, ELEMENT_COLORS as COLORS } from '@modeler/shape/colors';
import type { Injector, PopupMenu } from '@modeler/bpmn/types';

const SWATCH_TEMPLATE = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 25" height="100%" width="100%">
    <rect rx="2" x="1" y="1" width="22" height="22" fill="var(--fill-color)" stroke="var(--stroke-color)" style="stroke-width:2"></rect>
  </svg>
`;

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
      action: () => executeCommand(this.injector, {
        type: 'SetColor',
        elements,
        color,
      }),
    }));
  }
}
