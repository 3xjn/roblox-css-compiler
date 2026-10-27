import postcss, { type ChildNode, type Node } from 'postcss';
import nesting from 'postcss-nesting';
import valueParser from 'postcss-value-parser';
import { compileSelectors } from './selectors.js';
import { compileValue } from './values.js';
import { compileCondition } from './conditions.js';
import { declarationValidity } from './validity.js';
import { propertyMetadata } from './properties.js';
import { compileRegistration } from './registrations.js';
import { compileKeyframes, compileKeyframePositions } from './keyframes.js';
import type { CssNode, Declaration, InlineStyle, SourceLocation, Stylesheet, ValueToken } from './schema.js';

function location(node: Node): { source?: SourceLocation } {
  const start = node.source?.start;
  if (!start) return {};
  return {
    source: {
      file: node.source?.input.file ?? '<css>',
      line: start.line,
      column: start.column,
    },
  };
}

function valueToken(node: valueParser.Node): ValueToken {
  const token: ValueToken = { kind: node.type, value: node.value };
  if (node.type === 'function') token.children = node.nodes.map(valueToken);
  if (node.type === 'string') token.quote = node.quote;
  return token;
}

function convert(node: ChildNode, keyframes = false): CssNode | undefined {
  if (node.type === 'comment') return undefined;
  if (node.type === 'decl') {
    const property = node.prop.startsWith('--') ? node.prop : node.prop.toLowerCase();
    return {
      kind: 'declaration', property, value: node.value,
      tokens: compileValue(node.value),
      important: node.important === true, validity: declarationValidity(property, node.value), ...location(node),
    };
  }
  if (node.type === 'rule') {
    if (keyframes) {
      return {
        kind: 'keyframe-step', offsets: node.selectors, positions: compileKeyframePositions(node.selectors),
        children: convertChildren(node.nodes), ...location(node),
      };
    }
    return {
      kind: 'rule',
      selectors: compileSelectors(node.selector),
      children: convertChildren(node.nodes), ...location(node),
    };
  }
  if (node.type === 'atrule') {
    const condition = compileCondition(node.name.toLowerCase(), node.params);
    return {
      kind: 'at-rule', name: node.name.toLowerCase(), params: node.params,
      tokens: valueParser(node.params).nodes.map(valueToken),
      ...(condition ? { condition } : {}),
      ...(node.name.toLowerCase() === 'property' ? { registration: compileRegistration(node) } : {}),
      ...(/^(?:-webkit-)?keyframes$/i.test(node.name) ? { keyframes: compileKeyframes(node) } : {}),
      ...(node.nodes ? { children: convertChildren(node.nodes, /^(?:-webkit-)?keyframes$/i.test(node.name)) } : {}),
      ...location(node),
    };
  }
  throw new Error('Unexpected CSS node');
}

function convertChildren(nodes: ChildNode[], keyframes = false): CssNode[] {
  return nodes.flatMap(node => {
    const converted = convert(node, keyframes);
    return converted ? [converted] : [];
  });
}

/** Plain CSS entry point. Tailwind is deliberately not a dependency. */
export async function compileCss(css: string, options: { from?: string } = {}): Promise<Stylesheet> {
  const result = await postcss([nesting()]).process(css, {
    from: options.from ?? '<css>', map: false,
  });
  const nodes = convertChildren(result.root.nodes);
  return { version: 1, nodes, properties: propertyMetadata(nodes) };
}

/** Compile a declaration list; selectors and at-rules do not belong in an inline style. */
export function compileInlineStyle(css: string, options: { from?: string } = {}): InlineStyle {
  const root = postcss.parse(css, { from: options.from ?? '<inline-css>' });
  if (root.nodes.some(node => node.type !== 'decl' && node.type !== 'comment')) {
    throw new Error('Inline CSS accepts declarations only');
  }
  const declarations = convertChildren(root.nodes) as Declaration[];
  return { declarations, properties: propertyMetadata(declarations) };
}
