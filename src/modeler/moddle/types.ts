export interface ModdleSchema {
  name: string;
  prefix: string;
  icon?: string;
  xml: {
    tagAlias: string;
  };
  associations: any[];
  enumerations: ModdleEnumeration[];
  types: ModdleType[];
  templates?: ModdleTemplate[];
}

export interface ModdleTemplate {
  description?: string;
  object?: Record<string, any> & {
    type?: string;
    mixins?: string[];
    flowElements?: Array<Record<string, any>>;
  };
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
    /** Default flowElements to materialize when this type is instantiated as a subprocess. */
    flowElements?: Array<Record<string, any>>;
    [key: string]: any;
  };
}

export interface ModdleProperty {
  name: string;
  type?: string;
  description?: string;
  isAttr: boolean;
  isBody?: boolean;
  default?: any;
  isMany?: boolean;
  redefines?: string;
  replaces?: string;
  meta?: {
    categories?: string[];
    order?: number;
    hidden?: boolean;
    /** For enum-typed properties: render an editable text input with the enum literals as suggestions. */
    editable?: boolean;
    /** Conditional visibility - property is shown only when `body` matches the element. */
    condition?: {
      language: string;
      body: Record<string, any>;
    };
    [key: string]: any;
  };
}
