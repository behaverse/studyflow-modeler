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
  
  
  export default function ColorPopupProvider(config, bpmnRendererConfig, popupMenu, modeling, translate) {
    this._popupMenu = popupMenu;
    this._modeling = modeling;
    this._translate = translate;
  
    this._colors = config && config.colors || COLORS;
    this._defaultFillColor = bpmnRendererConfig && bpmnRendererConfig.defaultFillColor || 'white';
    this._defaultStrokeColor = bpmnRendererConfig && bpmnRendererConfig.defaultStrokeColor || 'rgb(34, 36, 42)';
  
    this._popupMenu.registerProvider('color-picker', this);
  }
  
  
  ColorPopupProvider.$inject = [
    'config.colorPicker',
    'config.bpmnRenderer',
    'popupMenu',
    'modeling',
    'translate'
  ];
  
  
  ColorPopupProvider.prototype.getEntries = function(elements) {
    var self = this;
  
    var colorIconHtml = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 25" height="100%" width="100%">
        <rect rx="2" x="1" y="1" width="22" height="22" fill="var(--fill-color)" stroke="var(--stroke-color)" style="stroke-width:2"></rect>
      </svg>
    `;
  
    var entries = this._colors.map(function(color) {
  
      var entryColorIconHtml = colorIconHtml.replace('var(--fill-color)', color.fill || self._defaultFillColor)
        .replace('var(--stroke-color)', color.stroke || self._defaultStrokeColor);
  
      return {
        title: self._translate(color.label),
        id: color.label.toLowerCase() + '-color',
        imageHtml: entryColorIconHtml,
        action: createAction(self._modeling, elements, color)
      };
    });
  
    return entries;
  };
  
  
  function createAction(modeling, element, color) {
    return function() {
      modeling.setColor(element, color);
    };
  }