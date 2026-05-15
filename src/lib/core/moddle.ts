// Shapes of moddle YAML schemas (`*.moddle.yaml`). Kept loose — bpmn-moddle
// itself treats most of this as `any`.

export type ModdleSchema = {
  name: string;
  prefix: string;
  icon?: string;
  xml: { tagAlias: string };
  associations: any[];
  enumerations: ModdleEnumeration[];
  types: ModdleType[];
  templates?: ModdleTemplate[];
};

export type ModdleTemplate = {
  description?: string;
  object?: any;
};

export type ModdleEnumeration = {
  name: string;
  isAbstract: boolean;
  description?: string;
  icon?: string;
  literalValues: Array<{ name: string; value: string; description?: string; icon?: string }>;
};

export type ModdleType = {
  name: string;
  description?: string;
  isAbstract?: boolean;
  superClass?: string[];
  extends?: string[];
  properties?: ModdleProperty[];
  icon?: string;
  meta?: any;
};

export type ModdleProperty = {
  name: string;
  type?: string;
  description?: string;
  isAttr: boolean;
  isBody?: boolean;
  default?: any;
  isMany?: boolean;
  redefines?: string;
  replaces?: string;
  meta?: any;
};
