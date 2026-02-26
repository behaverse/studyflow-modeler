import { createStudyflowExtension, getStudyflowDefaults, isExtendsType } from '../extensionElements';

type MenuEntry = {
  id: string;
  label: string;
  imageHtml?: string;
  bpmnType: string;
  extensionType: string | null;
};

const PRIMITIVE_TYPES = ['String', 'Boolean', 'Integer', 'Float', 'Double'];

export default class SchemaCreateMenuProvider {
  static $inject = ['popupMenu', 'bpmnFactory', 'elementFactory', 'create'];

  private _popupMenu: any;
  private _bpmnFactory: any;
  private _elementFactory: any;
  private _create: any;
  private _moddle: any;
  private _schemaPrefix: string;
  private _entries: MenuEntry[];

  constructor(
    popupMenu: any,
    bpmnFactory: any,
    elementFactory: any,
    create: any,
    schemaPrefix: string,
  ) {
    this._popupMenu = popupMenu;
    this._bpmnFactory = bpmnFactory;
    this._elementFactory = elementFactory;
    this._create = create;
    this._moddle = bpmnFactory._model;
    this._schemaPrefix = schemaPrefix;

    this._entries = this._buildEntries();

    this._popupMenu.registerProvider(`${schemaPrefix}-create`, this);
  }

  private _buildEntries(): MenuEntry[] {
    const moddle = this._moddle as any;

    const pkg =
      typeof moddle.getPackage === 'function'
        ? moddle.getPackage(this._schemaPrefix)
        : (moddle.packages ? moddle.packages[this._schemaPrefix] : undefined);

    if (!pkg?.types) {
      return [];
    }

    return pkg.types
      .filter((type: any) => {
        if (type.isAbstract) return false;
        if (type.name === 'Study') return false;
        if (type.superClass && type.superClass.some((sc: string) => PRIMITIVE_TYPES.includes(sc))) {
          return false;
        }
        if (type.extends?.length) return false;
        if (!type.meta?.bpmnType) return false;
        return true;
      })
      .map((type: any) => {
        const extensionType =
          this._schemaPrefix === 'studyflow' ? `${this._schemaPrefix}:${type.name}` : null;

        return {
          id: `create-${this._schemaPrefix}-${type.name}`,
          label: type.name,
          bpmnType: type.meta.bpmnType as string,
          extensionType,
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
          id: this._schemaPrefix,
          name: this._schemaPrefix.charAt(0).toUpperCase() + this._schemaPrefix.slice(1),
        },
        action: this._createAction(opt.bpmnType, opt.extensionType),
      };
    });

    return entries;
  }

  private _createAction(bpmnType: string, extensionType: string | null) {
    const bpmnFactory = this._bpmnFactory;
    const elementFactory = this._elementFactory;
    const create = this._create;
    const moddle = this._moddle;
    const popupMenu = this._popupMenu;
    const schemaPrefix = this._schemaPrefix;

    const createShapeWithExtension = () => {
      const prefix = extensionType
        ? extensionType.split(':')[1]
        : (bpmnType.includes(':') ? bpmnType.split(':')[1] : bpmnType);
      const generatedId = moddle.ids.nextPrefixed(`${prefix}_`, { $type: bpmnType } as any);

      let extendedDefaults: Record<string, any> = {};
      if (extensionType && schemaPrefix === 'studyflow' && isExtendsType(extensionType, moddle)) {
        extendedDefaults = getStudyflowDefaults(extensionType, moddle);
      }

      const businessObject = bpmnFactory.create(bpmnType, {
        ...extendedDefaults,
        id: generatedId,
      });

      businessObject.id = businessObject.id || generatedId;

      if (extensionType && schemaPrefix === 'studyflow' && !isExtendsType(extensionType, moddle)) {
        const defaults = getStudyflowDefaults(extensionType, moddle);
        createStudyflowExtension(businessObject, extensionType, moddle, defaults);
      }

      const shape = elementFactory.createShape({
        type: bpmnType,
        businessObject,
      });

      return shape;
    };

    const startCreate = (event: any) => {
      const shape = createShapeWithExtension();
      create.start(event, shape);
      popupMenu.close();
    };

    return {
      click: startCreate,
      dragstart: startCreate,
    };
  }
}

