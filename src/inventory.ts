import type { ConditionExpression, CssNode, FeatureOccurrence, Inventory, SelectorToken, SourceLocation, Stylesheet, ValueToken } from './schema.js';

export function inventoryStylesheet(sheet: Stylesheet): Inventory {
  const properties = new Map<string, FeatureOccurrence>();
  const descriptors = new Map<string, FeatureOccurrence>();
  const functions = new Map<string, FeatureOccurrence>();
  const selectors = new Map<string, FeatureOccurrence>();
  const atRules = new Map<string, FeatureOccurrence>();
  const conditions = new Map<string, FeatureOccurrence>();
  const valueKinds = new Map<string, FeatureOccurrence>();
  let rules = 0;
  let declarations = 0;
  let keyframeSteps = 0;

  function record(target: Map<string, FeatureOccurrence>, feature: string, source?: SourceLocation) {
    const entry = target.get(feature) ?? { feature, count: 0, sources: [] };
    entry.count++;
    if (source) entry.sources.push(source);
    target.set(feature, entry);
  }

  function values(tokens: ValueToken[], source?: SourceLocation) {
    for (const token of tokens) {
      record(valueKinds, token.kind === 'dimension' ? `dimension:${token.unit}` : token.kind, source);
      if (token.kind === 'function') record(functions, token.value, source);
      if (token.children) values(token.children, source);
    }
  }

  function conditionFeatures(expression: ConditionExpression, source?: SourceLocation) {
    const detail = expression.kind === 'feature' || expression.kind === 'media-type' ? `:${expression.name}`
      : expression.kind === 'unknown' ? `:${expression.text}`
      : expression.kind === 'general-enclosed' ? `:${expression.queryKind}:${expression.text}` : '';
    record(conditions, expression.kind + detail, source);
    if (expression.kind === 'and' || expression.kind === 'or') {
      for (const child of expression.operands) conditionFeatures(child, source);
    } else if (expression.kind === 'not') conditionFeatures(expression.operand, source);
  }

  function selectorFeatures(tokens: SelectorToken[], source?: SourceLocation) {
    for (const token of tokens) {
      if (token.namespace !== undefined) record(selectors, 'namespace', source);
      if (token.kind === 'pseudo') record(selectors, token.value, source);
      else if (token.kind === 'combinator') record(selectors, `combinator:${token.value.trim() || 'descendant'}`, source);
      else if (token.kind === 'attribute') record(selectors, `attribute:${token.operator ?? 'exists'}`, source);
      else record(selectors, token.kind, source);
      if (token.children) selectorFeatures(token.children, source);
      if (token.nth?.of) selectorFeatures(token.nth.of, source);
    }
  }

  function walk(nodes: CssNode[], descriptorOwner?: string) {
    for (const node of nodes) {
      if (node.kind === 'declaration') {
        declarations++;
        if (descriptorOwner) record(descriptors, `@${descriptorOwner}:${node.property}`, node.source);
        else record(properties, node.property, node.source);
        values(node.tokens, node.source);
      } else if (node.kind === 'rule') {
        rules++;
        for (const selector of node.selectors) selectorFeatures(selector.tokens, node.source);
        walk(node.children);
      } else if (node.kind === 'keyframe-step') {
        keyframeSteps++;
        walk(node.children);
      } else {
        record(atRules, node.name, node.source);
        values(node.tokens, node.source);
        if (node.condition) conditionFeatures(node.condition, node.source);
        if (node.children) walk(node.children, ['property', 'font-face', 'counter-style', 'font-palette-values', 'color-profile'].includes(node.name) ? node.name : undefined);
      }
    }
  }

  const entries = (map: Map<string, FeatureOccurrence>) => [...map.values()].sort((a, b) => a.feature.localeCompare(b.feature));
  walk(sheet.nodes);
  return { rules, declarations, keyframeSteps, properties: entries(properties), descriptors: entries(descriptors), functions: entries(functions), selectors: entries(selectors), atRules: entries(atRules), conditions: entries(conditions), valueKinds: entries(valueKinds) };
}
