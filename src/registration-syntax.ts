import * as css from 'css-tree';
import type { PropertySyntax } from './schema.js';
import { compileValue } from './values.js';
import { hasUnfamiliarSyntax } from './validity.js';

export type SyntaxResult = { status: 'valid' | 'invalid' | 'unchecked'; definition?: PropertySyntax; reason?: string };
const types = new Set(['length', 'number', 'percentage', 'length-percentage', 'string', 'color', 'image', 'url', 'integer', 'angle', 'time', 'resolution', 'transform-function', 'custom-ident', 'transform-list']);

/** Restrict the existing definition parser's AST to Properties & Values API 1. */
export function registrationSyntax(text: string): SyntaxResult {
  if (text === '*') return { status: 'valid', definition: { universal: true, branches: [] } };
  // The frontend's definition scanner is ASCII-oriented. Preserve cases it
  // cannot establish rather than treating valid CSS identifiers as invalid.
  if (Array.from(text).some(character => character.codePointAt(0)! > 127) || text.includes('\\')) {
    return { status: 'unchecked', reason: 'Non-ASCII/escaped syntax identifiers require further frontend support.' };
  }
  if (text.includes('{') || text.includes('}')) return { status: 'invalid', reason: 'Range multipliers are not permitted in registration syntax.' };
  try {
    const ast = css.definitionSyntax.parse(text);
    if (ast.explicit || ast.disallowEmpty || !ast.terms.length || (ast.terms.length > 1 && ast.combinator !== '|')) throw new Error('Expected ordered alternatives.');
    const branches: PropertySyntax['branches'] = ast.terms.map(term => {
      let list: 'single' | 'space' | 'comma' = 'single';
      if (term.type === 'Multiplier') {
        if (term.min !== 1 || term.max !== 0) throw new Error('Only + and # multipliers are permitted.');
        list = term.comma ? 'comma' : 'space';
        term = term.term;
      }
      if (term.type === 'Type' && types.has(term.name) && term.opts === null) {
        if (term.name === 'transform-list' && list !== 'single') throw new Error('transform-list is already multiplied.');
        return { kind: 'type', name: term.name, list };
      }
      if (term.type === 'Keyword' && css.lexer.matchType('custom-ident', term.name).matched) {
        return { kind: 'keyword', name: term.name, list };
      }
      throw new Error('Unsupported component in registration syntax.');
    });
    return { status: 'valid', definition: { universal: false, branches } };
  } catch (error) {
    return { status: 'invalid', reason: error instanceof Error ? error.message : 'Invalid registration syntax.' };
  }
}

const absoluteUnits = new Set(['px', 'cm', 'mm', 'q', 'in', 'pt', 'pc', 'deg', 'grad', 'rad', 'turn', 's', 'ms', 'dpi', 'dpcm', 'dppx', 'x']);
const fontUnits = new Set(['em', 'rem', 'ex', 'rex', 'cap', 'rcap', 'ch', 'rch', 'ic', 'ric', 'lh', 'rlh']);

/** Literal-only proof. Math, images and other computations stay unchecked. */
export function registrationInitial(definition: PropertySyntax, initial: string): SyntaxResult {
  if (definition.universal) return { status: 'valid' };
  try {
    const ast = css.parse(initial, { context: 'value', parseCustomProperty: true });
    let dependent = false;
    css.walk(ast, node => {
      if (node.type === 'Function' && ['var', 'attr'].includes(node.name.toLowerCase())) dependent = true;
    });
    if (dependent) return { status: 'invalid', reason: 'Typed initial value depends on element data or custom properties.' };
    let unknownGrammar = false;
    for (const branch of definition.branches) {
      const component = branch.kind === 'type' ? `<${branch.name}>` : branch.name;
      const grammar = component + (branch.list === 'comma' ? '#' : branch.list === 'space' ? '+' : '');
      const match = css.lexer.match(grammar, ast);
      if (!match.matched) {
        if (match.error?.name === 'SyntaxReferenceError') unknownGrammar = true;
        continue;
      }
      const tokens = ast.type === 'Value' ? ast.children.toArray() : [];
      if (branch.kind === 'keyword') {
        if (tokens.some(token => token.type === 'Identifier' && css.ident.decode(token.name) !== branch.name)) continue;
        return { status: 'valid' };
      }
      if (branch.name === 'custom-ident' || branch.name === 'string') return { status: 'valid' };
      if (branch.name === 'color') {
        const value = compileValue(initial);
        if (value.length === 1 && value[0]?.color) return { status: 'valid' };
        if (tokens.length === 1 && tokens[0]?.type === 'Identifier' && css.ident.decode(tokens[0].name).toLowerCase() === 'currentcolor') {
          return { status: 'invalid', reason: 'Typed initial color depends on the element color.' };
        }
      }
      let independent = true;
      let fontDependent = false;
      let functionValue = false;
      css.walk(ast, node => {
        if (node.type === 'Function') functionValue = true;
        if (node.type === 'Dimension') {
          const unit = node.unit.toLowerCase();
          if (fontUnits.has(unit)) fontDependent = true;
          else if (!absoluteUnits.has(unit)) independent = false;
        } else if (!['Value', 'Number', 'Percentage', 'Operator', 'WhiteSpace'].includes(node.type)) independent = false;
      });
      if (fontDependent && !functionValue) return { status: 'invalid', reason: 'Typed initial value uses font-relative units.' };
      if (independent) return { status: 'valid' };
      return { status: 'unchecked', reason: 'Initial value matching succeeded lexically; computational independence and computed typing need further validation.' };
    }
    return unknownGrammar || hasUnfamiliarSyntax(ast) ? { status: 'unchecked', reason: 'Initial-value grammar or unfamiliar value syntax requires further frontend support.' }
      : { status: 'invalid', reason: 'Initial value does not match the registered syntax.' };
  } catch {
    return { status: 'unchecked', reason: 'Initial value could not be established by the frontend.' };
  }
}
