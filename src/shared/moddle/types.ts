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
  examples?: ModdleExample[];
}

export interface ModdleExample {
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
    [key: string]: any;
  };
  condition?: {
    language: string;
    body: Record<string, any>;
  };
}
