import * as css from 'css-tree';
import type { AtRule } from 'postcss';
import type { PropertyRegistration } from './schema.js';
import { compileValue } from './values.js';
import { registrationSyntax, registrationInitial, type SyntaxResult } from './registration-syntax.js';

/** Validate descriptor shape with the existing CSS lexer; typed computation is separate. */
export function compileRegistration(node: AtRule): PropertyRegistration {
  const invalid = (reason: string): PropertyRegistration => ({ status: 'invalid', reason });
  if (!node.nodes) return invalid('Property registration requires a descriptor block.');
  try {
    if (!css.lexer.matchAtrulePrelude('property', node.params).matched) return invalid('Invalid custom-property name.');
  } catch {
    return invalid('Custom-property name could not be parsed.');
  }
  const name = compileValue(node.params);
  if (name.length !== 1 || name[0]?.kind !== 'word') return invalid('Expected one custom-property name.');
  let syntax: string | undefined;
  let syntaxResult: SyntaxResult | undefined;
  let inherits: boolean | undefined;
  let initial: string | undefined;
  for (const descriptor of node.nodes) {
    if (descriptor.type !== 'decl' || descriptor.important) continue;
    const property = descriptor.prop.toLowerCase();
    if (!['syntax', 'inherits', 'initial-value'].includes(property)) continue;
    try {
      if (!css.lexer.matchAtruleDescriptor('property', property, descriptor.value).matched) continue;
      const value = compileValue(descriptor.value);
      if (property === 'syntax' && value.length === 1 && value[0]?.kind === 'string') {
        const text = value[0].value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');
        if (text) {
          const result = registrationSyntax(text);
          if (result.status !== 'invalid') {
            syntax = text;
            syntaxResult = result;
          }
        }
      } else if (property === 'inherits' && value.length === 1 && value[0]?.kind === 'word') {
        const text = value[0].value.toLowerCase();
        if (text === 'true' || text === 'false') inherits = text === 'true';
      } else if (property === 'initial-value') initial = descriptor.value;
    } catch {
      // Invalid descriptors are ignored without erasing an earlier valid one.
    }
  }
  if (syntax === undefined || inherits === undefined) return invalid('A syntax string and inherits boolean are required.');
  if (syntax !== '*' && initial === undefined) return invalid('Typed registrations require an initial-value descriptor.');
  const initialResult: SyntaxResult = syntaxResult?.definition && initial !== undefined
    ? registrationInitial(syntaxResult.definition, initial) : { status: syntaxResult?.status ?? 'unchecked' };
  if (initialResult.status === 'invalid') return invalid(initialResult.reason ?? 'Invalid registered initial value.');
  const unchecked = syntaxResult?.status !== 'valid' || initialResult.status !== 'valid';
  return {
    status: unchecked ? 'unchecked' : 'valid',
    name: name[0].value, syntax, inherits,
    ...(initial !== undefined ? { initial: compileValue(initial) } : {}),
    ...(syntaxResult?.definition ? { syntaxDefinition: syntaxResult.definition } : {}),
    ...(unchecked ? { reason: syntaxResult?.reason ?? initialResult.reason ?? 'Registration requires further frontend validation.' } : {}),
  };
}
