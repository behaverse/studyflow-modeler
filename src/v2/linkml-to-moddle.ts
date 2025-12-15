import * as yaml from 'js-yaml';

interface LinkMLSchema {
  id: string;
  name: string;
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
}

interface LinkMLAttribute {
  range?: string;
  identifier?: boolean;
  description?: string;
  required?: boolean;
  multivalued?: boolean;
  ifabsent?: string | boolean;
  annotations?: {
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
  attributes?: ModdleProperty[];
}

interface ModdleProperty {
  name: string;
  description?: string;
  isAttr: boolean;
  type?: string;
  default?: any;
  isMany?: boolean;
  condition?: {
    language: string;
    body: Record<string, any>;
  };
}

class LinkMLToModdleConverter {
  private linkmlSchema: LinkMLSchema;
  private moddleSchema: ModdleSchema;
  private bpmnMappings: Map<string, string> = new Map();

  constructor(linkmlSchemaContent: string) {
    this.linkmlSchema = yaml.load(linkmlSchemaContent) as LinkMLSchema;

    this.moddleSchema = {
      name: 'Behaverse Studyflow BPMN Extension',
      uri: this.linkmlSchema.id || 'http://behaverse.org/schemas/studyflow',
      prefix: this.linkmlSchema.default_prefix || 'studyflow',
      xml: {
        tagAlias: 'lowerCase'
      },
      associations: [],
      enumerations: [],
      types: []
    };

    // Initialize BPMN mappings
    this.initializeBPMNMappings();
  }

  private initializeBPMNMappings(): void {
    if (!this.linkmlSchema.classes) return;

    for (const [className, classData] of Object.entries(this.linkmlSchema.classes)) {
      // Check class_uri first
      if (classData.class_uri && classData.class_uri.startsWith('bpmn:')) {
        this.bpmnMappings.set(className, classData.class_uri);
      }
      // Then check exact_mappings
      else if (classData.exact_mappings) {
        for (const mapping of classData.exact_mappings) {
          if (mapping.startsWith('bpmn:')) {
            this.bpmnMappings.set(className, mapping);
          }
        }
      }
    }
  }

  private convertEnums(): void {
    if (!this.linkmlSchema.enums) return;

    for (const [enumName, enumData] of Object.entries(this.linkmlSchema.enums)) {
      const literalValues = Object.entries(enumData.permissible_values).map(([value, valueData]) => ({
        name: valueData.title || this.formatEnumValueName(value),
        value: value
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
    // Convert kebab-case or snake_case to Title Case
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
        superClass: ['String'] // Default for custom types
      });
    }
  }

  private getSuperClasses(classData: LinkMLClass, className: string): string[] {
    const superClasses: string[] = [];

    // Check for BPMN mappings from class_uri
    const bpmnMapping = this.bpmnMappings.get(className);
    if (bpmnMapping) {
      superClasses.push(bpmnMapping);
    }

    // Check for is_a (inheritance) - always add parent class
    if (classData.is_a) {
      superClasses.push(classData.is_a);
    }

    // Add studyflow:Element for classes with mixins that include Element
    if (classData.mixins && classData.mixins.includes('Element') && className !== 'Element') {
      superClasses.push(`${this.moddleSchema.prefix}:Element`);
    }

    return superClasses;
  }


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

  private convertAttributes(attributes: Record<string, LinkMLAttribute>): ModdleProperty[] {
    const properties: ModdleProperty[] = [];

    for (const [attrName, attrData] of Object.entries(attributes)) {
      // Skip 'id' attribute as it's handled by BPMN base classes
      if (attrName === 'id') continue;

      const property: ModdleProperty = {
        name: attrName,
        description: attrData.description,
        isAttr: true,
        type: attrData.range ? this.convertLinkMLTypeToModdle(attrData.range) : 'String'
      };

      // Handle default values from ifabsent
      if (attrData.ifabsent !== undefined) {
        if (typeof attrData.ifabsent === 'boolean') {
          property.default = attrData.ifabsent;
        } else if (typeof attrData.ifabsent === 'string') {
          // Parse ifabsent values like "string(custom)" or "false"
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

      // Handle multivalued (isMany)
      if (attrData.multivalued) {
        property.isMany = true;
      }

      // Handle conditions from annotations
      if (attrData.annotations?.condition_body) {
        try {
          property.condition = {
            language: attrData.annotations.condition_language || 'json',
            body: JSON.parse(attrData.annotations.condition_body)
          };
        } catch (e) {
          // If parsing fails, skip the condition
          console.warn(`Failed to parse condition for ${attrName}:`, e);
        }
      }

      properties.push(property);
    }

    return properties;
  }

  private convertClasses(): void {
    if (!this.linkmlSchema.classes) return;

    for (const [className, classData] of Object.entries(this.linkmlSchema.classes)) {
      const moddleType: ModdleType = {
        name: className,
        description: classData.description
      };

      // Only set isAbstract if it's explicitly true or false in the schema
      if (classData.abstract !== undefined) {
        moddleType.isAbstract = classData.abstract;
      }

      // Handle superClass and extends
      const superClasses = this.getSuperClasses(classData, className);
      if (superClasses.length > 0) {
        // Special handling: StartEvent, EndEvent, and Dataset use extends for BPMN types
        const usesExtends = ['StartEvent', 'EndEvent', 'Dataset'].includes(className);

        if (usesExtends) {
          const bpmnTypes = superClasses.filter(sc => sc.startsWith('bpmn:'));
          const otherTypes = superClasses.filter(sc => !sc.startsWith('bpmn:'));

          if (bpmnTypes.length > 0) {
            moddleType.extends = bpmnTypes;
          }
          if (otherTypes.length > 0) {
            moddleType.superClass = otherTypes;
          }
        } else {
          // All other classes: everything goes into superClass
          moddleType.superClass = superClasses;
        }
      }

      // Handle mixins - but don't add duplicates
      if (classData.mixins && classData.mixins.length > 0) {
        if (!moddleType.superClass) {
          moddleType.superClass = [];
        }
        // Only add mixins that aren't already in superClass
        for (const mixin of classData.mixins) {
          if (!moddleType.superClass.includes(mixin) && !moddleType.superClass.includes(`${this.moddleSchema.prefix}:${mixin}`)) {
            moddleType.superClass.push(mixin);
          }
        }
      }

      // Convert attributes to properties
      if (classData.attributes && Object.keys(classData.attributes).length > 0) {
        moddleType.properties = this.convertAttributes(classData.attributes);
      }

      this.moddleSchema.types.push(moddleType);
    }
  }

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
