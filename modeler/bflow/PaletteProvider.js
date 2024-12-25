class BFlowPaletteProvider {
  static $inject = ['eventBus', 'palette', 'translate'];
  
  constructor(eventBus, palette, translate) {
      this.eventBus = eventBus;
      this.translate = translate;
  
      palette.registerProvider(this);
    }
  
    getPaletteEntries(element) {  // eslint-disable-line no-unused-vars
      return function(entries) {
        console.log(entries);
        delete entries['space-tool'];
        delete entries['create.subprocess-expanded'];
        delete entries['create.group'];
        delete entries['create.data-object'];
        delete entries['create.intermediate-event'];
        delete entries['create.participant-expanded'];
        return entries;
      };
    }
  }

export default {
    __init__: ["bFlowPaletteProvider"],
    bFlowPaletteProvider: ["type", BFlowPaletteProvider]
};
