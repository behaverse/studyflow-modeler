import { getStudyflowDefaults, isExtendsType, createStudyflowExtension } from '../extensionElements';

type MenuEntry = {
  id: string;
  label: string;
  imageHtml?: string;
  bpmnType: string;
  studyflowType: string;
};

const PRIMITIVE_TYPES = ['String', 'Boolean', 'Integer', 'Float', 'Double'];

export default class StudyflowCreateMenuProvider {
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

    this._popupMenu.registerProvider('studyflow-create', this);
  }

  private _buildEntries(): MenuEntry[] {
    const moddle = this._moddle;
    const pkg = moddle.getPackage('studyflow');

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
        const studyflowType = `studyflow:${type.name}`;
        return {
          id: `create-studyflow-${type.name}`,
          label: type.name,
          bpmnType: type.meta.bpmnType as string,
          studyflowType,
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
          id: 'studyflow',
          name: 'Studyflow',
        },
        action: this._createAction(opt.bpmnType, opt.studyflowType),
      };
    });

    return entries;
  }

  private _createAction(bpmnType: string, studyflowType: string) {
    const bpmnFactory = this._bpmnFactory;
    const elementFactory = this._elementFactory;
    const create = this._create;
    const moddle = this._moddle;
    const popupMenu = this._popupMenu;

    const createShapeWithExtension = () => {
      const prefix = studyflowType.split(':')[1] || bpmnType.replace(/[^A-Za-z0-9_]/g, '_');
      const generatedId = moddle.ids.nextPrefixed(`${prefix}_`, { $type: bpmnType } as any);

      let extendedDefaults: Record<string, any> = {};
      if (studyflowType && isExtendsType(studyflowType, moddle)) {
        extendedDefaults = getStudyflowDefaults(studyflowType, moddle);
      }

      const businessObject = bpmnFactory.create(bpmnType, {
        ...extendedDefaults,
        id: generatedId,
      });

      businessObject.id = businessObject.id || generatedId;

      if (studyflowType && !isExtendsType(studyflowType, moddle)) {
        const defaults = getStudyflowDefaults(studyflowType, moddle);
        createStudyflowExtension(businessObject, studyflowType, moddle, defaults);
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

