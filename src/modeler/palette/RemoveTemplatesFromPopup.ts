export default class RemoveTemplatesFromPopup {
  static $inject = ['popupMenu'];

  constructor(popupMenu: any) {
    popupMenu.registerProvider('bpmn-create', this);
  }

  getPopupMenuEntries(_element: any) {
    return (entries: Record<string, any>) => {
      for (const key of Object.keys(entries)) {
        if (key.startsWith('create.template-')) delete entries[key];
      }
      return entries;
    };
  }
}
