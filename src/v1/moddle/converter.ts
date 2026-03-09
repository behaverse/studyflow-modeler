import * as yaml from 'js-yaml';

import {
  BPMN_ANCESTORS,
  BPMN_REDEFINES,
  GLOBAL_BPMN_MAPPINGS
} from './constants';
import type {
  LinkMLAttribute,
  LinkMLSchema,
  LinkMLExample,
  ModdleProperty,
  ModdleSchema,
  ModdleType
} from './types';

const RESERVED_EXAMPLE_KEYS = new Set([
  'type',
  'name',
  'keywords',
  'icon',
  'attributes',
  'mixins',
  'flowElements'
]);

const RESERVED_FLOW_NODE_KEYS = new Set([
  'id',
  'x',
  'y',
  'type',
  'name',
  'keywords',
  'icon',
  'attributes',
  'mixins',
  'flowElements'
]);

export class LinkMLToModdleConverter {
  private linkmlSchema: LinkMLSchema;
  private moddleSchema: ModdleSchema;
  private generatedExampleTypeCount = 0;

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
      icon: this.linkmlSchema.annotations?.icon,
      xml: {
        tagAlias: 'lowerCase'
      },
      associations: [],
      enumerations: [],
      types: []
    };

    this.initializeBPMNMappings();
  }

  private resolveDirectBpmnMapping(classData: {
    class_uri?: string;
    is_a?: string;
    exact_mappings?: string[];
  }): { bpmnType: string | null; fromClassUri: boolean } {
    if (classData.class_uri?.startsWith('bpmn:')) {
      return { bpmnType: classData.class_uri, fromClassUri: true };
    }

    if (classData.is_a?.startsWith('bpmn:')) {
      return { bpmnType: classData.is_a, fromClassUri: false };
    }

    if (classData.is_a) {
      const mappedParent = this.resolveBpmnMapping(classData.is_a);
      if (mappedParent) {
        return { bpmnType: mappedParent, fromClassUri: false };
      }
    }

    if (classData.exact_mappings) {
      for (const mapping of classData.exact_mappings) {
        if (mapping.startsWith('bpmn:')) {
          return { bpmnType: mapping, fromClassUri: false };
        }

        const resolvedMapping = this.resolveBpmnMapping(mapping);
        if (resolvedMapping) {
          return { bpmnType: resolvedMapping, fromClassUri: false };
        }
      }
    }

    return { bpmnType: null, fromClassUri: false };
  }

  private registerBpmnMapping(className: string, bpmnType: string): void {
    this.bpmnMappings.set(className, bpmnType);

    const aliases = this.getReferenceCandidates(className);
    for (const alias of aliases) {
      this.bpmnMappings.set(alias, bpmnType);
      GLOBAL_BPMN_MAPPINGS.set(alias, bpmnType);
    }
  }

  private shouldPropagateBpmnAttributes(
    fromClassUri: boolean,
    classData: { abstract?: boolean; attributes?: Record<string, LinkMLAttribute> }
  ): boolean {
    return Boolean(
      !fromClassUri &&
      classData.abstract &&
      classData.attributes &&
      Object.keys(classData.attributes).length > 0
    );
  }

  private initializeBPMNMappings(): void {
    if (!this.linkmlSchema.classes) return;

    for (const [className, classData] of Object.entries(this.linkmlSchema.classes)) {
      const { bpmnType, fromClassUri } = this.resolveDirectBpmnMapping(classData);

      if (bpmnType) {
        this.registerBpmnMapping(className, bpmnType);

        // Abstract classes mapped via is_a with own attributes propagate
        // via BPMN hierarchy (their props get flattened into concrete types).
        // class_uri classes are NOT added here — they use moddle `extends`
        // and their props live on the BPMN element directly.
        if (this.shouldPropagateBpmnAttributes(fromClassUri, classData)) {
          this.bpmnExtendsClasses.set(bpmnType, className);
        }

        // Classes mapped via class_uri use moddle `extends`
        if (fromClassUri) {
          this.classUriClasses.add(className);
        }
      }
    }
  }

  private stripPrefix(classRef: string): string {
    const idx = classRef.indexOf(':');
    return idx === -1 ? classRef : classRef.slice(idx + 1);
  }

  private getReferenceCandidates(classRef: string): string[] {
    const localName = this.stripPrefix(classRef);
    const candidates = [classRef, localName];

    if (this.linkmlSchema.name) {
      candidates.push(`${this.linkmlSchema.name}:${localName}`);
    }

    if (this.linkmlSchema.default_prefix) {
      candidates.push(`${this.linkmlSchema.default_prefix}:${localName}`);
    }

    return Array.from(new Set(candidates));
  }

  private resolveClassKey(classRef: string): string | null {
    const classes = this.linkmlSchema.classes;
    if (!classes) return null;

    for (const candidate of this.getReferenceCandidates(classRef)) {
      if (classes[candidate]) {
        return candidate;
      }
    }

    return null;
  }

  private resolveBpmnMapping(classRef: string): string | null {
    for (const candidate of this.getReferenceCandidates(classRef)) {
      if (this.bpmnMappings.has(candidate)) {
        return this.bpmnMappings.get(candidate)!;
      }
      if (GLOBAL_BPMN_MAPPINGS.has(candidate)) {
        return GLOBAL_BPMN_MAPPINGS.get(candidate)!;
      }
    }
    return null;
  }

  private isBpmnReference(classRef: string | undefined): boolean {
    if (!classRef) {
      return false;
    }

    if (classRef.startsWith('bpmn:')) {
      return true;
    }

    if (this.resolveClassKey(classRef)) {
      return false;
    }

    return this.resolveBpmnMapping(classRef) !== null;
  }

  private getParentClassReference(classData: { is_a?: string }): string | null {
    if (!classData.is_a) {
      return null;
    }

    const parentClass = this.resolveClassKey(classData.is_a);
    if (parentClass) {
      return parentClass;
    }

    if (this.isBpmnReference(classData.is_a)) {
      return null;
    }

    return classData.is_a;
  }

  private inferAttributeRange(value: any): string | null {
    if (typeof value === 'boolean') {
      return 'boolean';
    }

    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'integer' : 'float';
    }

    if (typeof value === 'string') {
      return 'string';
    }

    return null;
  }

  private inferAttributeFromExampleValue(value: any): LinkMLAttribute | null {
    if (Array.isArray(value)) {
      const scalarRanges = value
        .map((entry) => this.inferAttributeRange(entry))
        .filter((range): range is string => range !== null);

      const uniqueRanges = Array.from(new Set(scalarRanges));
      const range = uniqueRanges.length === 1 ? uniqueRanges[0] : 'string';

      return {
        range,
        multivalued: true,
      };
    }

    const inferredRange = this.inferAttributeRange(value);
    if (!inferredRange) {
      return null;
    }

    return {
      range: inferredRange,
    };
  }

  private mergeMissingAttributes(
    target: Record<string, LinkMLAttribute>,
    source: Record<string, LinkMLAttribute>
  ): Record<string, LinkMLAttribute> {
    for (const [key, value] of Object.entries(source)) {
      if (!Object.prototype.hasOwnProperty.call(target, key)) {
        target[key] = value;
      }
    }

    return target;
  }

  private collectExampleScopedAttributes(
    classKey: string,
    obj: Record<string, any>,
    exampleAttributes: Record<string, LinkMLAttribute> | undefined,
    reservedKeys: Set<string>
  ): Record<string, LinkMLAttribute> {
    const scopedAttributes: Record<string, LinkMLAttribute> = {};
    const declaredForClass = this.getClassAttributes(classKey, this.classUriClasses.has(classKey));

    this.mergeMissingAttributes(scopedAttributes, exampleAttributes ?? {});
    this.mergeMissingAttributes(
      scopedAttributes,
      (obj.attributes as Record<string, LinkMLAttribute> | undefined) ?? {}
    );

    for (const [key, value] of Object.entries(obj)) {
      if (reservedKeys.has(key) || key.includes(':') || value === undefined) {
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(declaredForClass, key)) {
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(scopedAttributes, key)) {
        continue;
      }

      const inferredAttribute = this.inferAttributeFromExampleValue(value);
      if (!inferredAttribute) {
        continue;
      }

      scopedAttributes[key] = inferredAttribute;
    }

    return scopedAttributes;
  }

  private nextExampleScopedTypeName(baseClassKey: string): string {
    const baseLocalName = this.stripPrefix(baseClassKey);

    while (true) {
      this.generatedExampleTypeCount += 1;
      const candidate = `${baseLocalName}Example${this.generatedExampleTypeCount}`;

      const collidesWithClasses = this.resolveClassKey(candidate) !== null;
      const collidesWithGeneratedTypes = this.moddleSchema.types.some((type) => type.name === candidate);

      if (!collidesWithClasses && !collidesWithGeneratedTypes) {
        return candidate;
      }
    }
  }

  private createExampleScopedType(
    baseClassKey: string,
    scopedAttributes: Record<string, LinkMLAttribute>
  ): string {
    const scopedTypeName = this.nextExampleScopedTypeName(baseClassKey);
    const bpmnType = this.getBpmnType(baseClassKey);
    const baseUsesExtends = this.classUriClasses.has(baseClassKey);
    const scopedType: ModdleType = {
      name: scopedTypeName,
      superClass: [baseClassKey],
      meta: {
        bpmnType: bpmnType ?? undefined,
        exampleScopedType: true,
        exampleScopedExtends: baseUsesExtends,
        exampleScopedBaseType: `${this.moddleSchema.prefix}:${this.stripPrefix(baseClassKey)}`,
      },
    };

    if (baseUsesExtends && bpmnType) {
      scopedType.extends = [bpmnType];
    }

    if (Object.keys(scopedAttributes).length > 0) {
      scopedType.properties = this.convertAttributes(scopedAttributes);

      if (baseUsesExtends && scopedType.properties) {
        this.applyRedefines(scopedType.properties);
      }
    }

    this.moddleSchema.types.push(scopedType);

    return scopedTypeName;
  }

  private rewriteExampleObject(
    obj: Record<string, any> | undefined,
    exampleAttributes: Record<string, LinkMLAttribute> | undefined,
    reservedKeys: Set<string>
  ): Record<string, any> | undefined {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    const rewrittenObject: Record<string, any> = { ...obj };

    if (Array.isArray(obj.flowElements)) {
      rewrittenObject.flowElements = obj.flowElements.map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return entry;
        }

        if (
          typeof entry.sourceRef === 'string'
          && typeof entry.targetRef === 'string'
        ) {
          return { ...entry };
        }

        return this.rewriteExampleObject(
          entry,
          entry.attributes as Record<string, LinkMLAttribute> | undefined,
          RESERVED_FLOW_NODE_KEYS
        );
      });
    }

    const typeRef = rewrittenObject.type;
    if (typeof typeRef !== 'string' || typeRef.startsWith('bpmn:')) {
      return rewrittenObject;
    }

    const classKey = this.resolveClassKey(typeRef);
    if (!classKey) {
      return rewrittenObject;
    }

    const scopedAttributes = this.collectExampleScopedAttributes(
      classKey,
      rewrittenObject,
      exampleAttributes,
      reservedKeys
    );

    if (Object.keys(scopedAttributes).length === 0) {
      return rewrittenObject;
    }

    rewrittenObject.type = this.createExampleScopedType(classKey, scopedAttributes);

    return rewrittenObject;
  }

  private convertExamples(): void {
    if (!this.linkmlSchema.examples?.length) {
      return;
    }

    this.moddleSchema.examples = this.linkmlSchema.examples.map((example) => ({
      ...example,
      object: this.rewriteExampleObject(
        example.object,
        example.attributes,
        RESERVED_EXAMPLE_KEYS
      ),
    }));
  }

  private getAncestorClassReferences(classData: { is_a?: string }): string[] {
    const ancestors: string[] = [];
    const visited = new Set<string>();
    let currentRef = this.getParentClassReference(classData);

    while (currentRef) {
      const currentKey = this.resolveClassKey(currentRef);
      const currentId = currentKey || currentRef;

      if (visited.has(currentId)) {
        break;
      }

      visited.add(currentId);
      ancestors.push(currentId);

      if (!currentKey) {
        break;
      }

      const currentData = this.linkmlSchema.classes?.[currentKey];
      if (!currentData) {
        break;
      }

      currentRef = this.getParentClassReference(currentData);
    }

    return ancestors;
  }

  private getOwnerReferenceCandidates(classRef: string): string[] {
    const resolvedClassKey = this.resolveClassKey(classRef);
    const candidates = new Set<string>([
      classRef,
      this.stripPrefix(classRef)
    ]);

    if (resolvedClassKey) {
      candidates.add(resolvedClassKey);
      candidates.add(this.stripPrefix(resolvedClassKey));

      if (!resolvedClassKey.includes(':')) {
        candidates.add(`${this.moddleSchema.prefix}:${resolvedClassKey}`);
      }
    } else if (!classRef.includes(':')) {
      candidates.add(`${this.moddleSchema.prefix}:${classRef}`);
    }

    return Array.from(candidates);
  }

  private findAncestorPropertyOwner(
    classData: { is_a?: string },
    propertyName: string
  ): string | null {
    for (const ancestorRef of this.getAncestorClassReferences(classData)) {
      const ancestorClassKey = this.resolveClassKey(ancestorRef);
      if (!ancestorClassKey) {
        continue;
      }

      const ancestorUseExtends = this.classUriClasses.has(ancestorClassKey);
      const ancestorAttrs = this.getClassAttributes(ancestorClassKey, ancestorUseExtends);

      if (ancestorAttrs[propertyName]) {
        return ancestorClassKey;
      }
    }

    return null;
  }

  /**
   * Get the BPMN base type for a studyflow class, walking the is_a chain.
   */
  private getBpmnType(className: string, visited: Set<string> = new Set()): string | null {
    const resolvedFromMap = this.resolveBpmnMapping(className);
    if (resolvedFromMap) {
      return resolvedFromMap;
    }

    const classKey = this.resolveClassKey(className);
    if (!classKey || visited.has(classKey)) return null;
    visited.add(classKey);

    const classData = this.linkmlSchema.classes?.[classKey];
    if (!classData?.is_a || classData.is_a.startsWith('bpmn:')) {
      return null;
    }

    const fromParentMap = this.resolveBpmnMapping(classData.is_a);
    if (fromParentMap) {
      return fromParentMap;
    }

    return this.getBpmnType(classData.is_a, visited);
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
        attrs = this.mergeAttributesInOrder(attrs, ancestorAttrs);
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
    const classes = this.linkmlSchema.classes;
    const classKey = this.resolveClassKey(className);
    if (!classes || !classKey) return {};
    if (visited.has(classKey)) return {};
    visited.add(classKey);

    const classData = classes[classKey];
    let attrs: Record<string, LinkMLAttribute> = {};

    // 1. Walk the studyflow inheritance chain first so parent metadata
    // such as `hidden`, `default`, and conditions survives into children.
    const parentClassRef = this.getParentClassReference(classData);
    if (parentClassRef) {
      attrs = this.mergeAttributesInOrder(
        attrs,
        this.collectAllAttributes(parentClassRef, visited)
      );
    }

    // 2. Walk BPMN ancestry — collect from extends-like studyflow classes
    // (This is separate from is_a hierarchy and represents BPMN-level
    // extension properties propagated via abstract mapped classes.)
    const bpmnType = classData.class_uri?.startsWith('bpmn:')
      ? classData.class_uri
      : classData.is_a
        ? this.resolveBpmnMapping(classData.is_a)
        : null;
    if (bpmnType) {
      attrs = this.mergeAttributesInOrder(
        attrs,
        this.collectBpmnAncestorAttributes(bpmnType, visited)
      );
    }

    // 3. Walk mixins — additive properties only (no hierarchy propagation)
    if (classData.mixins) {
      for (const mixin of classData.mixins) {
        attrs = this.mergeAttributesInOrder(
          attrs,
          this.collectMixinAttributes(mixin, visited)
        );
      }
    }

    // 4. Own attributes (override inherited/additive attributes)
    if (classData.attributes) {
      attrs = this.mergeAttributesInOrder(attrs, classData.attributes);
    }

    return attrs;
  }

  private collectMixinAttributes(
    mixinRef: string,
    visited: Set<string>
  ): Record<string, LinkMLAttribute> {
    const classes = this.linkmlSchema.classes;
    const mixinKey = this.resolveClassKey(mixinRef);
    if (!classes || !mixinKey || visited.has(`mixin:${mixinKey}`)) return {};
    visited.add(`mixin:${mixinKey}`);

    const mixinData = classes[mixinKey];
    if (!mixinData) return {};

    let attrs: Record<string, LinkMLAttribute> = {};

    if (mixinData.mixins) {
      for (const nestedMixin of mixinData.mixins) {
        attrs = this.mergeAttributesInOrder(
          attrs,
          this.collectMixinAttributes(nestedMixin, visited)
        );
      }
    }

    if (mixinData.attributes) {
      attrs = this.mergeAttributesInOrder(attrs, mixinData.attributes);
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
      string: 'String',
      boolean: 'Boolean',
      integer: 'Integer',
      float: 'Float',
      double: 'Double'
    };
    return typeMapping[linkmlType.toLowerCase()] || linkmlType;
  }

  private parseDefaultValue(ifabsent: string | boolean | undefined): boolean | string | undefined {
    if (ifabsent === undefined) return undefined;
    if (typeof ifabsent === 'boolean') return ifabsent;
    if (typeof ifabsent === 'number') return ifabsent;

    const match = ifabsent.match(/^string\((.+)\)$/);
    if (match) {
      return match[1];
    }

    if (ifabsent === 'false') return false;
    if (ifabsent === 'true') return true;

    return undefined;
  }

  private getAnnotationPrimitive(
    annotations: LinkMLAttribute['annotations'] | undefined,
    key: string
  ): string | boolean | number | undefined {
    const value = annotations?.[key];

    return typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number'
      ? value
      : undefined;
  }

  private getAnnotationString(
    annotations: LinkMLAttribute['annotations'] | undefined,
    key: string
  ): string | undefined {
    const value = this.getAnnotationPrimitive(annotations, key);

    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private getAnnotationBoolean(
    annotations: LinkMLAttribute['annotations'] | undefined,
    key: string
  ): boolean | undefined {
    const value = this.getAnnotationPrimitive(annotations, key);

    if (typeof value === 'boolean') {
      return value;
    }

    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }

    return undefined;
  }

  private getAttributeMetadata(attrData: LinkMLAttribute): {
    defaultValue?: string | boolean | number;
    redefines?: string;
    replaces?: string;
    hidden: boolean;
    conditionLanguage?: string;
    conditionBody?: string;
  } {
    const annotations = attrData.annotations;
    const moddleExt = attrData.extensions?.moddle;
    const studyflowExt = attrData.extensions?.studyflow;

    const defaultValue =
      this.getAnnotationPrimitive(annotations, 'moddle.default') ??
      (typeof moddleExt?.default === 'string' ||
      typeof moddleExt?.default === 'boolean' ||
      typeof moddleExt?.default === 'number'
        ? moddleExt.default
        : undefined);

    const redefines = this.getAnnotationString(annotations, 'moddle.redefines') ??
      (typeof moddleExt?.redefines === 'string' && moddleExt.redefines.length > 0
        ? moddleExt.redefines
        : undefined);

    const replaces = this.getAnnotationString(annotations, 'moddle.replaces') ??
      (typeof moddleExt?.replaces === 'string' && moddleExt.replaces.length > 0
        ? moddleExt.replaces
        : undefined);

    const hidden = this.getAnnotationBoolean(annotations, 'studyflow.hidden') ?? Boolean(studyflowExt?.hidden);

    const conditionLanguage = this.getAnnotationString(annotations, 'studyflow.condition.language') ??
      (typeof studyflowExt?.condition?.language === 'string'
        ? studyflowExt.condition.language
        : undefined);

    const conditionBody = this.getAnnotationString(annotations, 'studyflow.condition.body') ??
      (typeof studyflowExt?.condition?.body === 'string'
        ? studyflowExt.condition.body
        : undefined);

    return {
      defaultValue,
      redefines,
      replaces,
      hidden,
      conditionLanguage,
      conditionBody
    };
  }

  private parseCondition(conditionLanguage: string | undefined, conditionBody: string): ModdleProperty['condition'] {
    try {
      return {
        language: conditionLanguage || 'json',
        body: JSON.parse(conditionBody)
      };
    } catch (e) {
      return undefined;
    }
  }

  /**
   * Merge attributes while preserving source order.
   * Existing keys are reinserted so overrides follow source position.
   */
  private mergeAttributesInOrder(
    target: Record<string, LinkMLAttribute>,
    source: Record<string, LinkMLAttribute>
  ): Record<string, LinkMLAttribute> {
    for (const [key, value] of Object.entries(source)) {
      if (Object.prototype.hasOwnProperty.call(target, key)) {
        delete target[key];
      }
      target[key] = value;
    }

    return target;
  }

  private buildModdleProperty(
    attrName: string,
    attrData: LinkMLAttribute,
    order: number
  ): ModdleProperty {
    const property: ModdleProperty = {
      name: attrName,
      description: attrData.description,
      isAttr: true,
      type: attrData.range ? this.convertLinkMLTypeToModdle(attrData.range) : 'String',
      meta: {
        order
      }
    };

    const meta = this.getAttributeMetadata(attrData);

    const defaultValue = meta.defaultValue ?? this.parseDefaultValue(attrData.ifabsent);
    if (defaultValue !== undefined) {
      property.default = defaultValue;
    }

    if (attrData.multivalued) {
      property.isMany = true;
    }

    if (attrData.categories?.length) {
      property.categories = attrData.categories;
    }

    if (meta.conditionBody) {
      const condition = this.parseCondition(
        meta.conditionLanguage,
        meta.conditionBody
      );

      if (condition) {
        property.condition = condition;
      } else {
        console.warn(`Failed to parse condition for ${attrName}`);
      }
    }

    if (meta.redefines) {
      property.redefines = meta.redefines;
    }

    if (meta.replaces) {
      property.replaces = meta.replaces;
    }

    property.hidden = meta.hidden;

    return property;
  }

  /**
   * Convert LinkML attributes to moddle properties.
   * All properties are isAttr:true (serialised as XML attributes on the
   * wrapper extension element).
   */
  private convertAttributes(
    attributes: Record<string, LinkMLAttribute>
  ): ModdleProperty[] {
    return Object.entries(attributes)
      .filter(([attrName]) => attrName !== 'id')
      .map(([attrName, attrData], index) => this.buildModdleProperty(attrName, attrData, index + 1));
  }

  private applyRedefines(properties: ModdleProperty[]): void {
    for (const prop of properties) {
      const redef = BPMN_REDEFINES[prop.name];
      if (redef) {
        prop.redefines = redef;
      }
    }
  }

  private inferParentRedefines(
    properties: ModdleProperty[],
    classData: { is_a?: string }
  ): void {
    for (const property of properties) {
      if (property.redefines || property.replaces) continue;

      const ownerClassKey = this.findAncestorPropertyOwner(classData, property.name);
      if (!ownerClassKey) continue;

      property.redefines = `${this.moddleSchema.prefix}:${ownerClassKey}#${property.name}`;
    }
  }

  private sanitizeExplicitRedefines(
    properties: ModdleProperty[],
    classData: { is_a?: string },
    useExtends: boolean
  ): void {
    if (useExtends) return;

    const allowedOwners = new Set<string>();
    const allowedOwnerLocalNames = new Set<string>();

    for (const ancestorRef of this.getAncestorClassReferences(classData)) {
      for (const candidate of this.getOwnerReferenceCandidates(ancestorRef)) {
        allowedOwners.add(candidate);
        allowedOwnerLocalNames.add(this.stripPrefix(candidate));
      }
    }

    for (const property of properties) {
      if (!property.redefines) continue;

      const owner = property.redefines.split('#')[0];
      const ownerLocalName = owner ? this.stripPrefix(owner) : '';
      const hasAllowedOwner = Boolean(
        owner && (allowedOwners.has(owner) || allowedOwnerLocalNames.has(ownerLocalName))
      );

      if (!hasAllowedOwner) {
        console.warn(
          `[moddle-converter] Dropping invalid redefines '${property.redefines}' on property '${property.name}'`
        );
        delete property.redefines;
      }
    }
  }

  private getSkipClasses(): Set<string> {
    return new Set<string>(this.bpmnExtendsClasses.values());
  }

  private getClassAttributes(
    className: string,
    useExtends: boolean
  ): Record<string, LinkMLAttribute> {
    const allAttrs = this.collectAllAttributes(className);

    if (useExtends) {
      // For direct BPMN extension types, keep only additive properties
      // defined on the class/mixins (no propagated BPMN ancestor attrs).
      const classes = this.linkmlSchema.classes;
      const classKey = this.resolveClassKey(className);
      if (!classes || !classKey) return {};

      const classData = classes[classKey];
      let attrs: Record<string, LinkMLAttribute> = {};

      if (classData.mixins) {
        const visited = new Set<string>();
        for (const mixin of classData.mixins) {
          attrs = this.mergeAttributesInOrder(
            attrs,
            this.collectMixinAttributes(mixin, visited)
          );
        }
      }

      if (classData.attributes) {
        attrs = this.mergeAttributesInOrder(attrs, classData.attributes);
      }

      return attrs;
    }

    return allAttrs;
  }

  private getSuperClassList(
    classData: { is_a?: string },
    useExtends: boolean,
    bpmnType: string | null
  ): string[] | undefined {
    const parentClass = this.getParentClassReference(classData);
    if (parentClass) {
      return [parentClass];
    }

    if (!useExtends || !bpmnType) {
      return ['Element'];
    }

    return undefined;
  }

  private createModdleType(
    className: string,
    classData: {
      description?: string;
      abstract?: boolean;
      is_a?: string;
      mixins?: string[];
      annotations?: { icon?: string };
      attributes?: Record<string, LinkMLAttribute>;
    },
    bpmnType: string | null,
    useExtends: boolean
  ): ModdleType {
    const moddleType: ModdleType = {
      name: className,
      description: classData.description
    };

    const superClass = this.getSuperClassList(classData, useExtends, bpmnType);
    if (superClass) {
      moddleType.superClass = superClass;
    }

    if (useExtends && bpmnType) {
      // `extends` denotes BPMN type extension/redefinition.
      moddleType.extends = [bpmnType];
    }

    if (classData.abstract !== undefined) {
      moddleType.isAbstract = classData.abstract;
    }

    if (bpmnType && !useExtends) {
      moddleType.meta = { bpmnType };
    }

    const allAttrs = this.getClassAttributes(className, useExtends);
    if (Object.keys(allAttrs).length > 0) {
      moddleType.properties = this.convertAttributes(allAttrs);

      if (moddleType.properties) {
        this.sanitizeExplicitRedefines(moddleType.properties, classData, useExtends);
      }

      if (useExtends && moddleType.properties) {
        this.applyRedefines(moddleType.properties);
      }

      if (!useExtends && moddleType.properties) {
        this.inferParentRedefines(moddleType.properties, classData);
      }
    }

    if (classData.annotations?.icon) {
      moddleType.icon = classData.annotations.icon;
    }

    return moddleType;
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
   * from the output to avoid naming conflicts (e.g., sf:Element
   * would shadow moddle's built-in Element type).
   *
   * Classes mapped via `class_uri` use `extends` — their properties
   * become XML attributes on the BPMN element (e.g.,
   * `<bpmn2:startEvent sf:requiresConsent="true" />`).
   * Classes mapped via `is_a` use standalone extension elements.
   */
  private convertClasses(): void {
    if (!this.linkmlSchema.classes) return;

    const skipClasses = this.getSkipClasses();

    for (const [className, classData] of Object.entries(this.linkmlSchema.classes)) {
      if (skipClasses.has(className)) continue;

      const bpmnType = this.getBpmnType(className);
      const useExtends = this.classUriClasses.has(className);

      const moddleType = this.createModdleType(className, classData, bpmnType, useExtends);

      this.moddleSchema.types.push(moddleType);
    }
  }

  // ─── Public API ────────────────────────────────────────────────────

  public convert(): void {
    this.convertEnums();
    this.convertTypes();
    this.convertClasses();
    this.convertExamples();
  }

  public getSchema(): ModdleSchema {
    return this.moddleSchema;
  }

  public toJSON(): string {
    return JSON.stringify(this.moddleSchema, null, 2);
  }
}
