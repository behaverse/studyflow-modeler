export default class BpmnCreateTemplateFilterProvider {
  static $inject = ['popupMenu'];

  private _popupMenu: any;

  constructor(popupMenu: any) {
    this._popupMenu = popupMenu;
    this._popupMenu.registerProvider('bpmn-create', this);
  }

  getPopupMenuEntries(_element: any) {
    return (entries: Record<string, any>) => {
      Object.keys(entries).forEach((key) => {
        if (key.startsWith('create.template-')) {
          delete entries[key];
        }
      });

      return entries;
    };
  }
}
