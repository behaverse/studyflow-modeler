import { createExtensionElement, getDefaults, isExtendsType, setAppliedType, setProperty } from '../extensions';
import type { Example as ElementExample } from '../moddle/examples';
import { resolveBpmnCreateType } from '../moddle/resolveBpmnType';

type MenuEntry = {
  id: string;
  label: string;
  imageHtml?: string;
  bpmnType: string;
  extensionType: string | null;
};

type TemplateMenuEntry = {
  id: string;
  label: string;
  description?: string;
  imageHtml?: string;
  template: ElementExample;
};

type ElementExamplesService = {
  getBySchemaPrefix: (prefix: string) => ElementExample[];
  createElement: (template: ElementExample) => any;
};

const PRIMITIVE_TYPES = ['String', 'Boolean', 'Integer', 'Float', 'Double'];
const HIDDEN_TYPES = new Set(['Study', 'StartEvent', 'EndEvent', 'SequenceFlow']);

export default class SchemaPopupMenu {
  static $inject = ['popupMenu', 'bpmnFactory', 'elementFactory', 'create'];

  private _popupMenu: any;
  private _bpmnFactory: any;
  private _elementFactory: any;
  private _create: any;
  private _moddle: any;
  private _schemaPrefix: string;
  private _entries: MenuEntry[];
  private _templateEntries: TemplateMenuEntry[];
  private _elementTemplates: ElementExamplesService;

  constructor(
    popupMenu: any,
    bpmnFactory: any,
    elementFactory: any,
    create: any,
    elementTemplates: ElementExamplesService,
    schemaPrefix: string,
  ) {
    this._popupMenu = popupMenu;
    this._bpmnFactory = bpmnFactory;
    this._elementFactory = elementFactory;
    this._create = create;
    this._elementTemplates = elementTemplates;
    this._moddle = bpmnFactory._model;
    this._schemaPrefix = schemaPrefix;

    this._entries = this._buildEntries();
    this._templateEntries = this._buildTemplateEntries();

    this._popupMenu.registerProvider(`${schemaPrefix}-create`, this);
  }

  private _buildTemplateEntries(): TemplateMenuEntry[] {
    return this._elementTemplates
      .getBySchemaPrefix(this._schemaPrefix)
      .map((template) => ({
        id: `create-template-${this._schemaPrefix}-${template.id}`,
        label: template.name,
        description: template.description,
        imageHtml: template.iconClass
          ? `<span class="${template.iconClass}" style="font-size: 18px;"></span>`
          : undefined,
        template,
      }));
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
        if (type.isAbstract || HIDDEN_TYPES.has(type.name)) return false;
        if (type.superClass?.some((sc: string) => PRIMITIVE_TYPES.includes(sc))) return false;
        if (Array.isArray(type.meta?.flowElements) && type.meta.flowElements.length > 0) return false;
        return true;
      })
      .map((type: any) => {
        const extensionType = `${this._schemaPrefix}:${type.name}`;
        const bpmnType = resolveBpmnCreateType(moddle, type);

        if (!bpmnType) {
          return null;
        }

        return {
          id: `create-${this._schemaPrefix}-${type.name}`,
          label: type.name,
          bpmnType,
          extensionType,
          imageHtml: type.meta?.icon
            ? `<span class="${type.meta?.icon}" style="font-size: 18px;"></span>`
            : undefined,
        };
      })
      .filter((entry: MenuEntry | null): entry is MenuEntry => entry !== null);
  }

  getPopupMenuEntries(_element: any) {
    const entries: Record<string, any> = {};

    this._entries.forEach((opt) => {
      entries[opt.id] = {
        label: opt.label,
        imageHtml: opt.imageHtml,
        // group: {
        //   id: this._schemaPrefix,
        //   name: schemaName,
        // },
        action: this._createAction(opt.bpmnType, opt.extensionType),
      };
    });

    this._templateEntries.forEach((opt) => {
      entries[opt.id] = {
        label: opt.label,
        description: opt.description,
        imageHtml: opt.imageHtml,
        ...(opt.template.templateSource === 'schema-example' && {
          group: {
            id: `${this._schemaPrefix}-examples`,
            name: `Examples`,
          },
        }),
        action: this._createTemplateAction(opt.template),
      };
    });

    return entries;
  }

  private _createTemplateAction(template: ElementExample) {
    const create = this._create;
    const popupMenu = this._popupMenu;
    const elementTemplates = this._elementTemplates;

    const startCreate = (event: any) => {
      const createdElement = elementTemplates.createElement(template);

      if (Array.isArray(createdElement)) {
        create.start(event, createdElement, {
          hints: {
            autoSelect: [createdElement[0]],
          },
        });
      } else {
        create.start(event, createdElement);
      }

      popupMenu.close();
    };

    return {
      click: startCreate,
      dragstart: startCreate,
    };
  }

  private _createAction(bpmnType: string, extensionType: string | null) {
    const bpmnFactory = this._bpmnFactory;
    const elementFactory = this._elementFactory;
    const create = this._create;
    const moddle = this._moddle;
    const popupMenu = this._popupMenu;
    const createShapeWithExtension = () => {
      const prefix = extensionType
        ? extensionType.split(':')[1]
        : (bpmnType.includes(':') ? bpmnType.split(':')[1] : bpmnType);
      const generatedId = moddle.ids.nextPrefixed(`${prefix}_`, { $type: bpmnType } as any);

      const businessObject = bpmnFactory.create(bpmnType, {
        id: generatedId,
      });

      businessObject.id = businessObject.id || generatedId;

      if (extensionType && isExtendsType(extensionType, moddle)) {
        setAppliedType(businessObject, extensionType);
        const extendedDefaults = getDefaults(extensionType, moddle);
        for (const [propertyName, defaultValue] of Object.entries(extendedDefaults)) {
          setProperty(businessObject, propertyName, defaultValue);
        }
      }

      if (extensionType && !isExtendsType(extensionType, moddle)) {
        const defaults = getDefaults(extensionType, moddle);
        createExtensionElement(businessObject, extensionType, moddle, defaults);
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

