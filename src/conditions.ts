import * as css from 'css-tree';
import { compileSelectors } from './selectors.js';
import { compileValue } from './values.js';
import type { ConditionExpression, RangeOperand } from './schema.js';

function operand(node: css.CssNode): RangeOperand {
  return node.type === 'Identifier'
    ? { kind: 'feature', name: node.name.toLowerCase() }
    : { kind: 'value', tokens: compileValue(css.generate(node)) };
}

function combine(kind: 'and' | 'or', operands: ConditionExpression[]): ConditionExpression {
  return operands.length === 1 ? operands[0]! : { kind, operands };
}

function unknown(node: css.CssNode): ConditionExpression {
  return { kind: 'unknown', text: css.generate(node) };
}

function lower(node: css.CssNode): ConditionExpression {
  switch (node.type) {
    case 'MediaQueryList': return combine('or', node.children.toArray().map(lower));
    case 'AtrulePrelude': return combine('and', node.children.toArray().map(lower));
    case 'MediaQuery': {
      const items: ConditionExpression[] = [];
      if (node.mediaType) items.push({ kind: 'media-type', name: node.mediaType.toLowerCase() });
      if (node.condition) items.push(lower(node.condition));
      const expression = combine('and', items);
      return node.modifier?.toLowerCase() === 'not' ? { kind: 'not', operand: expression } : expression;
    }
    case 'Condition': {
      const nodes = node.children.toArray();
      if (nodes[0]?.type === 'Identifier' && nodes[0].name.toLowerCase() === 'not') {
        return nodes.length === 2 ? { kind: 'not', operand: lower(nodes[1]!) } : unknown(node);
      }
      const operands: ConditionExpression[] = [];
      let operator: 'and' | 'or' | undefined;
      for (let index = 0; index < nodes.length; index++) {
        const child = nodes[index]!;
        if (index % 2 === 0) {
          if (child.type === 'Identifier') return unknown(node);
          operands.push(lower(child));
        } else {
          if (child.type !== 'Identifier') return unknown(node);
          const name = child.name.toLowerCase();
          if (name !== 'and' && name !== 'or') return unknown(node);
          if (operator && operator !== name) return unknown(node);
          operator = name;
        }
      }
      return nodes.length % 2 === 1 ? combine(operator ?? 'and', operands) : unknown(node);
    }
    case 'Feature': return {
      kind: 'feature', name: node.name.toLowerCase(),
      ...(node.value ? { tokens: compileValue(css.generate(node.value)) } : {}),
    };
    case 'FeatureRange': {
      const operands = [operand(node.left), operand(node.middle)];
      const comparisons = [node.leftComparison];
      if (node.right && node.rightComparison) {
        operands.push(operand(node.right));
        comparisons.push(node.rightComparison);
      }
      return { kind: 'range', rangeOperands: operands, comparisons };
    }
    case 'SupportsDeclaration': return {
      kind: 'declaration', property: node.declaration.property.startsWith('--')
        ? node.declaration.property : node.declaration.property.toLowerCase(),
      tokens: compileValue(css.generate(node.declaration.value)),
    };
    case 'FeatureFunction':
      if (node.kind === 'supports' && node.feature.toLowerCase() === 'selector') {
        return { kind: 'selector', selectors: compileSelectors(css.generate(node.value)) };
      }
      return unknown(node);
    case 'GeneralEnclosed': return {
      kind: 'general-enclosed', queryKind: node.kind, text: css.generate(node),
    };
    default: return unknown(node);
  }
}

/** Unsupported grammar is retained explicitly and never converted to truthiness. */
export function compileCondition(name: string, params: string): ConditionExpression | undefined {
  if (name !== 'media' && name !== 'supports' && name !== 'container') return undefined;
  try {
    return lower(css.parse(params, { context: 'atrulePrelude', atrule: name, parseCustomProperty: true }));
  } catch {
    return { kind: 'unknown', text: params };
  }
}
