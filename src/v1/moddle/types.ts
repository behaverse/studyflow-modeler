export interface LinkMLSchema {
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
  examples?: LinkMLExample[];
}

export interface LinkMLEnum {
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

export interface LinkMLType {
  uri?: string;
  base?: string;
  description?: string;
}

export interface LinkMLExample {
  /** String representation of the example */
  value?: string;
  /** Direct object representation of the example */
  object?: Record<string, any>;
  /** Description of what the example is doing */
  description?: string;
}

export interface LinkMLClass {
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

export interface LinkMLAttribute {
  range?: string;
  identifier?: boolean;
  description?: string;
  required?: boolean;
  multivalued?: boolean;
  ifabsent?: string | boolean;
  categories?: string[];
  extensions?: {
    moddle?: {
      redefines?: string;
      replaces?: string;
      default?: string | boolean | number;
      [key: string]: any;
    };
    studyflow?: {
      hidden?: boolean;
      condition?: {
        language?: string;
        body?: string;
        [key: string]: any;
      };
      [key: string]: any;
    };
    [key: string]: any;
  };
  comments?: string[];
}

export interface ModdleSchema {
  name: string;
  uri: string;
  prefix: string;
  xml: {
    tagAlias: string;
  };
  associations: any[];
  enumerations: ModdleEnumeration[];
  types: ModdleType[];
  examples?: LinkMLExample[];
}

export interface ModdleEnumeration {
  name: string;
  isAbstract: boolean;
  description?: string;
  icon?: string;
  literalValues: Array<{
    name: string;
    value: string;
  }>;
}

export interface ModdleType {
  name: string;
  description?: string;
  isAbstract?: boolean;
  superClass?: string[];
  extends?: string[];
  properties?: ModdleProperty[];
  icon?: string;
  meta?: {
    bpmnType?: string;
    [key: string]: any;
  };
}

export interface ModdleProperty {
  name: string;
  description?: string;
  isAttr: boolean;
  type?: string;
  default?: any;
  isMany?: boolean;
  redefines?: string;
  replaces?: string;
  categories?: string[];
  hidden?: boolean;
  meta?: {
    order?: number;
    [key: string]: any;
  };
  condition?: {
    language: string;
    body: Record<string, any>;
  };
}
