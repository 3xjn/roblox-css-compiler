import * as css from 'css-tree';
import { canonicalProperty } from './aliases.js';

export type Validity = 'valid' | 'invalid' | 'deferred' | 'unknown';
const knownFunctions = new Set(['calc', 'min', 'max', 'clamp', 'rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix', 'url']);
const relativeColors = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color']);

/** Recognize the family/origin prefix; argument validity remains a later step. */
export function isRelativeColorSyntax(node: css.CssNode): boolean {
  return node.type === 'Function' && relativeColors.has(node.name.toLowerCase()) &&
    node.children.first?.type === 'Identifier' && node.children.first.name.toLowerCase() === 'from';
}

/** A failed lexer match may reflect newer syntax rather than an invalid value. */
export function hasUnfamiliarSyntax(ast: css.CssNode, property?: string): boolean {
  let unfamiliar = false;
  css.walk(ast, node => {
    if (node.type === 'Raw' || node.type === 'Function' && !knownFunctions.has(node.name.toLowerCase())) unfamiliar = true;
    if (isRelativeColorSyntax(node)) unfamiliar = true;
    // The pinned grammar predates this addition to the variant shorthand.
    if (property === 'font-variant' && node.type === 'Identifier' && ['text', 'emoji', 'unicode'].includes(node.name.toLowerCase())) unfamiliar = true;
    if (node.type === 'Function' && node.name.toLowerCase() === 'color') {
      const profile = node.children.first;
      if (profile?.type === 'Identifier') {
        const known = ['predefined-rgb', 'xyz-space'].some(type =>
          css.lexer.getType(type) && css.lexer.matchType(type, profile).matched,
        );
        if (!known) unfamiliar = true;
      }
    }
  });
  return unfamiliar;
}

/** Grammar validation is distinct from Roblox rendering capability. */
export function declarationValidity(property: string, value: string): Validity {
  if (property.startsWith('--')) return 'deferred';
  property = canonicalProperty(property);
  if (!css.lexer.getProperty(property)) return 'unknown';
  try {
    const ast = css.parse(value, { context: 'value', parseCustomProperty: true });
    let deferred = false;
    let unfamiliar = false;
    css.walk(ast, node => {
      if (node.type === 'Raw') unfamiliar = true;
      if (node.type === 'Function' && ['var', 'env', 'attr'].includes(node.name.toLowerCase())) deferred = true;
    });
    if (deferred) return 'deferred';
    if (unfamiliar) return 'unknown';
    const result = css.lexer.matchProperty(property, ast);
    if (result.matched) return 'valid';
    // A grammar library can lag emerging CSS functions. Preserve those for
    // backend diagnostics rather than treating them as invalid declarations.
    return hasUnfamiliarSyntax(ast, property) ? 'unknown' : 'invalid';
  } catch {
    return 'unknown';
  }
}
