export interface SchemaAttributeDefinition {
  range?: string;
  identifier?: boolean;
  description?: string;
  required?: boolean;
  multivalued?: boolean;
  ifabsent?: string | boolean;
  categories?: string[];
  annotations?: {
    [key: string]: any;
  };
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

export interface ModdleExample {
  value?: string;
  attributes?: Record<string, SchemaAttributeDefinition>;
  object?: Record<string, any> & {
    type?: string;
    mixins?: string[];
    flowElements?: Array<Record<string, any>>;
    attributes?: Record<string, SchemaAttributeDefinition>;
  };
  description?: string;
}

export interface ModdleSchema {
  name: string;
  uri: string;
  prefix: string;
  icon?: string;
  xml: {
    tagAlias: string;
  };
  associations: any[];
  enumerations: ModdleEnumeration[];
  types: ModdleType[];
  examples?: ModdleExample[];
}

export interface ModdleEnumeration {
  name: string;
  isAbstract: boolean;
  description?: string;
  icon?: string;
  literalValues: Array<{
    name: string;
    value: string;
    description?: string;
    icon?: string;
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
    hidden?: boolean;
    [key: string]: any;
  };
  condition?: {
    language: string;
    body: Record<string, any>;
  };
}
