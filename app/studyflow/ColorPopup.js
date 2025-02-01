const COLORS = [ {
    label: 'Default',
    fill: undefined,
    stroke: undefined
  }, {
    label: 'Blue',
    fill: '#DDE8FA',
    stroke: '#728CB9'
  }, {
    label: 'Orange',
    fill: '#FBE7CF',
    stroke: '#CE9D35'
  }, {
    label: 'Green',
    fill: '#D9E7D6',
    stroke: '#8CB26E'
  }, {
    label: 'Red',
    fill: '#F1D0CD',
    stroke: '#AC5A54'
  }, {
    label: 'Purple',
    fill: '#DFD5E6',
    stroke: '#9174A3'
  } ];
  
export default class ColorPickerProvider {
  static $inject = ["config.colorPicker", "popupMenu", "modeling"];

  constructor(config, popupMenu, modeling) {
    this.modeling = modeling;
  
    this._defaultFillColor = 'white';
    this._defaultStrokeColor = 'rgb(34, 36, 42)';
  
    popupMenu.registerProvider('color-picker', this);
  }
  
  getEntries(elements) {
    const self = this;
  
    var colorIconHtml = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 25" height="100%" width="100%">
        <rect rx="2" x="1" y="1" width="22" height="22" fill="var(--fill-color)" stroke="var(--stroke-color)" style="stroke-width:2"></rect>
      </svg>
    `;
  
    var entries = COLORS.map(function (color) {
  
      var entryColorIconHtml = colorIconHtml.replace(
        'var(--fill-color)', color.fill || self._defaultFillColor
      ).replace(
        'var(--stroke-color)', color.stroke || self._defaultStrokeColor
      );

      return {
        title: color.label,
        id: color.label.toLowerCase() + '-color',
        imageHtml: entryColorIconHtml,
        action: () => self.modeling.setColor(elements, color)
      };
    });
  
    return entries;
  }

}