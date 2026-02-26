type MenuEntry = {
  id: string;
  label: string;
  imageHtml?: string;
  bpmnType: string;
  omniflowType: string;
};

const PRIMITIVE_TYPES = ['String', 'Boolean', 'Integer', 'Float', 'Double'];

export default class OmniflowCreateMenuProvider {
  static $inject = ['popupMenu', 'bpmnFactory', 'elementFactory', 'create'];

  private _popupMenu: any;
  private _bpmnFactory: any;
  private _elementFactory: any;
  private _create: any;
  private _moddle: any;
  private _entries: MenuEntry[];

  constructor(popupMenu: any, bpmnFactory: any, elementFactory: any, create: any) {
    this._popupMenu = popupMenu;
    this._bpmnFactory = bpmnFactory;
    this._elementFactory = elementFactory;
    this._create = create;
    this._moddle = bpmnFactory._model;

    this._entries = this._buildEntries();

    this._popupMenu.registerProvider('omniflow-create', this);
  }

  private _buildEntries(): MenuEntry[] {
    const moddle = this._moddle;
    const pkg = moddle.getPackage('omniflow');

    if (!pkg?.types) {
      return [];
    }

    return pkg.types
      .filter((type: any) => {
        if (type.isAbstract) return false;
        if (type.superClass && type.superClass.some((sc: string) => PRIMITIVE_TYPES.includes(sc))) {
          return false;
        }
        if (type.extends?.length) return false;
        if (!type.meta?.bpmnType) return false;
        return true;
      })
      .map((type: any) => {
        const omniflowType = `omniflow:${type.name}`;
        return {
          id: `create-omniflow-${type.name}`,
          label: type.name,
          bpmnType: type.meta.bpmnType as string,
          omniflowType,
          imageHtml: type.icon
            ? `<span class="${type.icon}" style="font-size: 18px;"></span>`
            : undefined,
        };
      });
  }

  getPopupMenuEntries(_element: any) {
    const entries: Record<string, any> = {};

    this._entries.forEach((opt) => {
      entries[opt.id] = {
        label: opt.label,
        imageHtml: opt.imageHtml,
        group: {
          id: 'omniflow',
          name: 'Omniflow',
        },
        action: this._createAction(opt.bpmnType),
      };
    });

    return entries;
  }

  private _createAction(bpmnType: string) {
    const bpmnFactory = this._bpmnFactory;
    const elementFactory = this._elementFactory;
    const create = this._create;
    const moddle = this._moddle;
    const popupMenu = this._popupMenu;

    const createShape = () => {
      const prefix = bpmnType.includes(':') ? bpmnType.split(':')[1] : bpmnType;
      const generatedId = moddle.ids.nextPrefixed(`${prefix}_`, { $type: bpmnType } as any);

      const businessObject = bpmnFactory.create(bpmnType, {
        id: generatedId,
      });

      businessObject.id = businessObject.id || generatedId;

      const shape = elementFactory.createShape({
        type: bpmnType,
        businessObject,
      });

      return shape;
    };

    const startCreate = (event: any) => {
      const shape = createShape();
      create.start(event, shape);
      popupMenu.close();
    };

    return {
      click: startCreate,
      dragstart: startCreate,
    };
  }
}

