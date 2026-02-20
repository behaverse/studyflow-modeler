import * as yaml from 'js-yaml';

interface LinkMLSchema {
  id: string;
  name: string;
  title?: string;
  prefixes: Record<string, string>;
  imports?: string[];
  default_range?: string;
  default_prefix?: string;
  enums?: Record<string, LinkMLEnum>;
  types?: Record<string, LinkMLType>;
  classes?: Record<string, LinkMLClass>;
}

interface LinkMLEnum {
  description?: string;
  permissible_values: Record<string, {
    title?: string;
    description?: string;
    annotations?: {
      icon?: string;
      [key: string]: any;
    };
  }>;
}

interface LinkMLType {
  uri?: string;
  base?: string;
  description?: string;
}

interface LinkMLClass {
  abstract?: boolean;
  is_a?: string;
  mixins?: string[];
  exact_mappings?: string[];
  close_mappings?: string[];
  class_uri?: string;
  attributes?: Record<string, LinkMLAttribute>;
  description?: string;
  annotations?: {
    icon?: string;
    [key: string]: any;
  };
}

interface LinkMLAttribute {
  range?: string;
  identifier?: boolean;
  description?: string;
  required?: boolean;
  multivalued?: boolean;
  ifabsent?: string | boolean;
  categories?: string[];
  extensions?: {
    condition_language?: string;
    condition_body?: string;
  };
  comments?: string[];
}

interface ModdleSchema {
  name: string;
  uri: string;
  prefix: string;
  xml: {
    tagAlias: string;
  };
  associations: any[];
  enumerations: ModdleEnumeration[];
  types: ModdleType[];
}

interface ModdleEnumeration {
  name: string;
  isAbstract: boolean;
  description?: string;
  icon?: string;
  literalValues: Array<{
    name: string;
    value: string;
  }>;
}

interface ModdleType {
  name: string;
  description?: string;
  isAbstract?: boolean;
  superClass?: string[];
  extends?: string[];
  properties?: ModdleProperty[];
  icon?: string;
  meta?: Record<string, any>;
}

interface ModdleProperty {
  name: string;
  description?: string;
  isAttr: boolean;
  type?: string;
  default?: any;
  isMany?: boolean;
  redefines?: string;
  categories?: string[];
  condition?: {
    language: string;
    body: Record<string, any>;
  };
}

/**
 * BPMN type hierarchy — maps each BPMN type to its ancestor types.
 * Used to determine which studyflow "extends-like" abstract classes
 * propagate their properties to a given element type.
 */
const BPMN_ANCESTORS: Record<string, string[]> = {
  'bpmn:Task': ['bpmn:Activity', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:UserTask': ['bpmn:Task', 'bpmn:Activity', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:SubProcess': ['bpmn:Activity', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:StartEvent': ['bpmn:CatchEvent', 'bpmn:Event', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:EndEvent': ['bpmn:ThrowEvent', 'bpmn:Event', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:ExclusiveGateway': ['bpmn:Gateway', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:ParallelGateway': ['bpmn:Gateway', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:InclusiveGateway': ['bpmn:Gateway', 'bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:DataStoreReference': ['bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:DataStore': ['bpmn:RootElement', 'bpmn:BaseElement'],
  'bpmn:DataObject': ['bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:DataObjectReference': ['bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:Process': ['bpmn:FlowElementsContainer', 'bpmn:CallableElement', 'bpmn:BaseElement'],
  'bpmn:Activity': ['bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:BaseElement': [],
  'bpmn:Event': ['bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
  'bpmn:Gateway': ['bpmn:FlowNode', 'bpmn:FlowElement', 'bpmn:BaseElement'],
};

class LinkMLToModdleConverter {
  private linkmlSchema: LinkMLSchema;
  private moddleSchema: ModdleSchema;

  /** studyflow class name → BPMN type (all mapped classes) */
  private bpmnMappings: Map<string, string> = new Map();

  /**
   * BPMN type → studyflow class name (only abstract "extends-like" classes
   * whose properties propagate to all BPMN elements of that type).
   * E.g., bpmn:BaseElement → Element, bpmn:Activity → Activity.
   */
  private bpmnExtendsClasses: Map<string, string> = new Map();

  /**
   * Classes whose BPMN mapping comes from `class_uri` (not `is_a`).
   * These use the moddle `extends` mechanism — their properties become
   * XML attributes on the BPMN element itself.
   * Classes mapped via `is_a` use standalone extension elements instead.
   */
  private classUriClasses: Set<string> = new Set();

  constructor(linkmlSchemaContent: string) {
    this.linkmlSchema = yaml.load(linkmlSchemaContent) as LinkMLSchema;

    this.moddleSchema = {
      name: this.linkmlSchema.title || this.linkmlSchema.name || 'studyflow',
      uri: this.linkmlSchema.id || 'http://behaverse.org/schemas/studyflow',
      prefix: this.linkmlSchema.default_prefix || 'studyflow',
      xml: {
        tagAlias: 'lowerCase'
      },
      associations: [],
      enumerations: [],
      types: []
    };

    this.initializeBPMNMappings();
  }

  private initializeBPMNMappings(): void {
    if (!this.linkmlSchema.classes) return;

    for (const [className, classData] of Object.entries(this.linkmlSchema.classes)) {
      let bpmnType: string | null = null;
      let fromClassUri = false;

      if (classData.class_uri?.startsWith('bpmn:')) {
        bpmnType = classData.class_uri;
        fromClassUri = true;
      } else if (classData.is_a?.startsWith('bpmn:')) {
        bpmnType = classData.is_a;
      } else if (classData.exact_mappings) {
        for (const mapping of classData.exact_mappings) {
          if (mapping.startsWith('bpmn:')) {
            bpmnType = mapping;
          }
        }
      }

      if (bpmnType) {
        this.bpmnMappings.set(className, bpmnType);

        // Abstract classes mapped via is_a with own attributes propagate
        // via BPMN hierarchy (their props get flattened into concrete types).
        // class_uri classes are NOT added here — they use moddle `extends`
        // and their props live on the BPMN element directly.
        if (!fromClassUri &&
            classData.abstract &&
            classData.attributes &&
            Object.keys(classData.attributes).length > 0) {
          this.bpmnExtendsClasses.set(bpmnType, className);
        }

        // Classes mapped via class_uri use moddle `extends`
        if (fromClassUri) {
          this.classUriClasses.add(className);
        }
      }
    }
  }

  /**
   * Get the BPMN base type for a studyflow class, walking the is_a chain.
   */
  private getBpmnType(className: string): string | null {
    if (this.bpmnMappings.has(className)) {
      return this.bpmnMappings.get(className)!;
    }
    const classData = this.linkmlSchema.classes?.[className];
    if (!classData) return null;
    if (classData.is_a && !classData.is_a.startsWith('bpmn:')) {
      return this.getBpmnType(classData.is_a);
    }
    return null;
  }

  /**
   * Collect attributes from abstract studyflow classes that map to BPMN
   * ancestors of the given BPMN type.
   *
   * For example, for bpmn:Task:
   *   - bpmn:Activity ancestor → Activity class props (url, isDataOperation, …)
   *   - bpmn:BaseElement ancestor → Element class props (documentation, checklist)
   */
  private collectBpmnAncestorAttributes(
    bpmnType: string,
    visited: Set<string>
  ): Record<string, LinkMLAttribute> {
    const ancestors = BPMN_ANCESTORS[bpmnType] || [];
    const allBpmnTypes = [bpmnType, ...ancestors];
    let attrs: Record<string, LinkMLAttribute> = {};

    for (const bt of allBpmnTypes) {
      const sfClass = this.bpmnExtendsClasses.get(bt);
      if (sfClass && !visited.has(sfClass)) {
        const ancestorAttrs = this.collectAllAttributes(sfClass, visited);
        attrs = { ...attrs, ...ancestorAttrs };
      }
    }

    return attrs;
  }

  /**
   * Collect ALL attributes for a class by walking:
   * 1. is_a chain (studyflow parent classes)
   * 2. BPMN ancestry (for extends-like abstract classes)
   * 3. Mixins
   * 4. Own attributes (override inherited)
   *
   * This produces the FLAT set of all properties for a given class,
   * suitable for generating self-contained extension element types.
   */
  private collectAllAttributes(
    className: string,
    visited: Set<string> = new Set()
  ): Record<string, LinkMLAttribute> {
    if (visited.has(className)) return {};
    visited.add(className);

    const classes = this.linkmlSchema.classes;
    if (!classes?.[className]) return {};

    const classData = classes[className];
    let attrs: Record<string, LinkMLAttribute> = {};

    // 1. Walk is_a chain — studyflow parents
    if (classData.is_a && !classData.is_a.startsWith('bpmn:') && classes[classData.is_a]) {
      attrs = { ...attrs, ...this.collectAllAttributes(classData.is_a, visited) };
    }

    // 2. Walk BPMN ancestry — collect from extends-like studyflow classes
    const bpmnType = classData.class_uri?.startsWith('bpmn:')
      ? classData.class_uri
      : classData.is_a?.startsWith('bpmn:')
        ? classData.is_a
        : null;
    if (bpmnType) {
      attrs = { ...attrs, ...this.collectBpmnAncestorAttributes(bpmnType, visited) };
    }

    // 3. Walk mixins
    if (classData.mixins) {
      for (const mixin of classData.mixins) {
        if (classes[mixin]) {
          attrs = { ...attrs, ...this.collectAllAttributes(mixin, visited) };
        }
      }
    }

    // 4. Own attributes (override inherited)
    if (classData.attributes) {
      attrs = { ...attrs, ...classData.attributes };
    }

    return attrs;
  }

  // ─── Enum / Type conversion ────────────────────────────────────────

  private convertEnums(): void {
    if (!this.linkmlSchema.enums) return;

    for (const [enumName, enumData] of Object.entries(this.linkmlSchema.enums)) {
      const literalValues = Object.entries(enumData.permissible_values).map(([value, valueData]) => ({
        name: valueData.title || this.formatEnumValueName(value),
        value: value,
        icon: valueData.annotations?.icon
      }));

      this.moddleSchema.enumerations.push({
        name: enumName,
        isAbstract: true,
        description: enumData.description,
        literalValues
      });
    }
  }

  private formatEnumValueName(value: string): string {
    return value
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  private convertTypes(): void {
    if (!this.linkmlSchema.types) return;

    for (const [typeName, typeData] of Object.entries(this.linkmlSchema.types)) {
      this.moddleSchema.types.push({
        name: typeName,
        description: typeData.description,
        superClass: ['String']
      });
    }
  }

  // ─── Attribute conversion ──────────────────────────────────────────

  private convertLinkMLTypeToModdle(linkmlType: string): string {
    const typeMapping: Record<string, string> = {
      'string': 'String',
      'boolean': 'Boolean',
      'integer': 'Integer',
      'float': 'Float',
      'double': 'Double'
    };
    return typeMapping[linkmlType.toLowerCase()] || linkmlType;
  }

  /**
   * Convert LinkML attributes to moddle properties.
   * All properties are isAttr:true (serialised as XML attributes on the
   * wrapper extension element).
   */
  private convertAttributes(
    attributes: Record<string, LinkMLAttribute>
  ): ModdleProperty[] {
    const properties: ModdleProperty[] = [];

    for (const [attrName, attrData] of Object.entries(attributes)) {
      if (attrName === 'id') continue;

      const property: ModdleProperty = {
        name: attrName,
        description: attrData.description,
        isAttr: true,
        type: attrData.range ? this.convertLinkMLTypeToModdle(attrData.range) : 'String'
      };

      // Default values from ifabsent
      if (attrData.ifabsent !== undefined) {
        if (typeof attrData.ifabsent === 'boolean') {
          property.default = attrData.ifabsent;
        } else if (typeof attrData.ifabsent === 'string') {
          const match = attrData.ifabsent.match(/^string\((.+)\)$/);
          if (match) {
            property.default = match[1];
          } else if (attrData.ifabsent === 'false') {
            property.default = false;
          } else if (attrData.ifabsent === 'true') {
            property.default = true;
          }
        }
      }

      if (attrData.multivalued) {
        property.isMany = true;
      }

      if (attrData.categories?.length) {
        property.categories = attrData.categories;
      }

      if (attrData.extensions?.condition_body) {
        try {
          property.condition = {
            language: attrData.extensions.condition_language || 'json',
            body: JSON.parse(attrData.extensions.condition_body)
          };
        } catch (e) {
          console.warn(`Failed to parse condition for ${attrName}:`, e);
        }
      }

      properties.push(property);
    }

    return properties;
  }

  // ─── Class conversion (extension element types) ────────────────────

  /**
   * Convert LinkML classes to moddle extension element types.
   *
   * Each studyflow class becomes a standalone moddle type with
   * superClass: ["Element"] (moddle base). Properties from the LinkML
   * inheritance chain are FLATTENED into each type so that the wrapper
   * extension element is self-contained.
   *
   * Abstract "extends-like" classes (Element, Activity) whose sole
   * purpose is to propagate properties via BPMN ancestry are SKIPPED
   * from the output to avoid naming conflicts (e.g., studyflow:Element
   * would shadow moddle's built-in Element type).
   *
   * Classes mapped via `class_uri` use `extends` — their properties
   * become XML attributes on the BPMN element (e.g.,
   * `<bpmn2:startEvent studyflow:requiresConsent="true" />`).
   * Classes mapped via `is_a` use standalone extension elements.
   */
  private convertClasses(): void {
    if (!this.linkmlSchema.classes) return;

    // Collect the set of class names to skip
    const skipClasses = new Set<string>();
    for (const sfClassName of this.bpmnExtendsClasses.values()) {
      skipClasses.add(sfClassName);
    }

    for (const [className, classData] of Object.entries(this.linkmlSchema.classes)) {
      if (skipClasses.has(className)) continue;

      const bpmnType = this.getBpmnType(className);

      // class_uri → extends (attrs on BPMN element); is_a → extension element
      const useExtends = this.classUriClasses.has(className);

      const moddleType: ModdleType = {
        name: className,
        description: classData.description,
      };

      if (useExtends) {
        // Properties become XML attributes on the BPMN element itself.
        moddleType.extends = [bpmnType];
      } else {
        // Standalone extension element type inside <extensionElements>.
        moddleType.superClass = ['Element'];
      }

      if (classData.abstract !== undefined) {
        moddleType.isAbstract = classData.abstract;
      }

      // Store BPMN type mapping in meta (only for extension element types)
      if (bpmnType && !useExtends) {
        moddleType.meta = { bpmnType };
      }

      // Collect properties:
      // - For extends types, only OWN attributes (mixin/ancestor props are
      //   already on the BPMN type through its own hierarchy).
      // - For extension element types, FLATTEN everything so the wrapper
      //   is self-contained.
      const allAttrs = useExtends
        ? (classData.attributes || {})
        : this.collectAllAttributes(className);
      if (Object.keys(allAttrs).length > 0) {
        moddleType.properties = this.convertAttributes(allAttrs);
      }

      // Icon
      if (classData.annotations?.icon) {
        moddleType.icon = classData.annotations.icon;
      }

      this.moddleSchema.types.push(moddleType);
    }
  }

  // ─── Public API ────────────────────────────────────────────────────

  public convert(): void {
    this.convertEnums();
    this.convertTypes();
    this.convertClasses();
  }

  public getSchema(): ModdleSchema {
    return this.moddleSchema;
  }

  public toJSON(): string {
    return JSON.stringify(this.moddleSchema, null, 2);
  }
}

/**
 * Convert LinkML YAML schema to Moddle JSON schema
 * @param linkmlYamlContent - The LinkML schema as a YAML string
 * @returns The Moddle schema as a JSON string
 */
export function convertLinkMLToModdle(linkmlYamlContent: string): string {
  const converter = new LinkMLToModdleConverter(linkmlYamlContent);
  converter.convert();
  return converter.toJSON();
}

/**
 * Convert LinkML YAML schema to Moddle schema object
 * @param linkmlYamlContent - The LinkML schema as a YAML string
 * @returns The Moddle schema object
 */
export function convertLinkMLToModdleObject(linkmlYamlContent: string): ModdleSchema {
  const converter = new LinkMLToModdleConverter(linkmlYamlContent);
  converter.convert();
  return converter.getSchema();
}

export { LinkMLToModdleConverter, ModdleSchema };
