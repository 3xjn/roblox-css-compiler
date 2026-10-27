import selectorParser from 'postcss-selector-parser';
import { selectorSpecificity } from '@csstools/selector-specificity';
import { parse, generate } from 'css-tree';
import type { Selector, SelectorToken } from './schema.js';

const nthPseudos = new Set([':nth-child', ':nth-last-child', ':nth-of-type', ':nth-last-of-type']);

function nthToken(node: selectorParser.Pseudo, result: SelectorToken): void {
  try {
    // Reuse CSS-tree's CSS Syntax An+B parser, not a string split/regex grammar.
    const selector = parse(node.toString(), { context: 'selector' });
    if (selector.type !== 'Selector' || selector.children.size !== 1) throw new Error('Expected one nth pseudo');
    const pseudo = selector.children.first;
    if (pseudo?.type !== 'PseudoClassSelector' || pseudo.children?.size !== 1) throw new Error('Missing nth argument');
    const nth = pseudo.children.first;
    if (nth?.type !== 'Nth') throw new Error('Unparsed nth argument');
    let a: number;
    let b: number;
    if (nth.nth.type === 'Identifier') {
      const name = nth.nth.name.toLowerCase();
      if (name !== 'odd' && name !== 'even') throw new Error('Unknown nth keyword');
      a = 2;
      b = name === 'odd' ? 1 : 0;
    } else {
      a = Number(nth.nth.a ?? 0);
      b = Number(nth.nth.b ?? 0);
    }
    // A bounded exact numeric contract shared with the Luau double backend.
    if (![a, b].every(value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647)) {
      throw new Error('Nth coefficients outside the supported signed 32-bit range');
    }
    const normalized: NonNullable<SelectorToken['nth']> = { a, b };
    if (nth.selector) {
      if (result.value.endsWith('of-type')) throw new Error('of-selector lists are not allowed in nth-of-type');
      const list = selectorParser().astSync(generate(nth.selector));
      for (const branch of list.nodes) {
        const first = branch.nodes.find(item => item.type !== 'comment');
        if (!first || first.type === 'combinator') throw new Error('Nth of-filter requires nonrelative selectors');
      }
      normalized.of = list.nodes.map(token);
    }
    result.nth = normalized;
  } catch (error) {
    result.nthError = error instanceof Error ? error.message : 'Invalid nth argument';
  }
}

function token(node: selectorParser.Node): SelectorToken {
  const result: SelectorToken = { kind: node.type, value: node.value ?? '' };
  if (node.type === 'pseudo') {
    result.value = result.value.toLowerCase();
    if (nthPseudos.has(result.value)) {
      nthToken(node, result);
      return result;
    }
  }
  if ('namespace' in node && node.namespace !== undefined) result.namespace = node.namespace;
  if (node.type === 'attribute') {
    result.attribute = node.attribute;
    if (node.operator !== undefined) result.operator = node.operator;
    if (node.insensitive !== undefined) result.insensitive = node.insensitive;
  }
  if ('nodes' in node && node.nodes) result.children = node.nodes.map(token);
  return result;
}

export function compileSelectors(source: string): Selector[] {
  return selectorParser().astSync(source).nodes.map(selector => {
    const specificity = selectorSpecificity(selector);
    return {
      text: selector.toString(), tokens: selector.nodes.map(token),
      specificity: [specificity.a, specificity.b, specificity.c],
    };
  });
}
