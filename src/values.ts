import * as css from 'css-tree';
import { isRelativeColorSyntax } from './validity.js';
import { converter, parse } from 'culori';
import type { RgbaColor, ValueToken } from './schema.js';

const rgb = converter('rgb');

// CSS Color 4 HWB conversion, with channels normalized to 1 for 100%.
// Using the existing HSL converter avoids Culori's HSV singularity at B=1
// when W is extended below zero. Keep compiler and runtime semantics aligned.
function hwb(hue: number, white: number, black: number) {
  if (white + black >= 1) {
    const scale = Math.max(Math.abs(white), Math.abs(black));
    const gray = (white / scale) / (white / scale + black / scale);
    return { mode: 'rgb' as const, r: gray, g: gray, b: gray };
  }
  const base = rgb({ mode: 'hsl', h: hue, s: 1, l: 0.5 });
  const remaining = 1 - white - black;
  return { mode: 'rgb' as const,
    r: base.r * remaining + white,
    g: base.g * remaining + white,
    b: base.b * remaining + white };
}

function color(node: css.CssNode): RgbaColor | undefined {
  if (node.type !== 'Identifier' && node.type !== 'Hash' && node.type !== 'Function') return undefined;
  // Missing components have interpolation semantics; never silently turn them into zero.
  let missing = false;
  css.walk(node, child => { if (child.type === 'Identifier' && child.name === 'none') missing = true; });
  if (missing) return undefined;
  const parsed = parse(css.generate(node));
  if (!parsed) return undefined;
  // Culori preserves extended channel values. CSS's rgb() notation instead
  // clamps its parsed channels, and hsl() clamps negative saturation before
  // conversion. Oklab/OkLCh also constrain L and negative C. Other channel
  // excursions must retain their extended gamut values.
  const normalized = parsed.mode === 'hwb' ? { ...hwb(parsed.h ?? 0, parsed.w, parsed.b), alpha: parsed.alpha ?? 1 }
    : parsed.mode === 'hsl' ? { ...parsed, s: Math.max(0, parsed.s) }
    : parsed.mode === 'oklab' ? { ...parsed, l: Math.max(0, Math.min(1, parsed.l)) }
    : parsed.mode === 'oklch' ? { ...parsed, l: Math.max(0, Math.min(1, parsed.l)), c: Math.max(0, parsed.c) }
    : parsed.mode === 'lab' ? { ...parsed, l: Math.max(0, Math.min(100, parsed.l)) }
    : parsed.mode === 'lch' ? { ...parsed, l: Math.max(0, Math.min(100, parsed.l)), c: Math.max(0, parsed.c) }
    : parsed;
  const result = rgb(normalized);
  const alpha = result.alpha ?? 1;
  if (![result.r, result.g, result.b, alpha].every(Number.isFinite)) return undefined;
  const boundedRgb = node.type === 'Function' && ['rgb', 'rgba'].includes(node.name.toLowerCase());
  const channel = (value: number) => boundedRgb ? Math.max(0, Math.min(1, value)) : value;
  return { r: channel(result.r), g: channel(result.g), b: channel(result.b), alpha: Math.max(0, Math.min(1, alpha)) };
}

function colored(node: css.CssNode, token: ValueToken): ValueToken[] {
  const colorSyntax = isRelativeColorSyntax(node) || Boolean(css.lexer.matchType('color', node).matched);
  let value: RgbaColor | undefined;
  if (colorSyntax) {
    // A normalizer's syntax gap must not discard the CSS parser's token tree.
    // In particular, arbitrary numeric math is not input to the color parser.
    try { value = color(node); } catch { /* Preserve structured syntax for runtime resolution. */ }
  }
  return [{ ...token, ...(value ? { color: value } : {}), ...(colorSyntax ? { syntaxType: 'color' as const } : {}) }];
}

function lower(node: css.CssNode): ValueToken[] {
  switch (node.type) {
    case 'Value': return node.children.toArray().flatMap(lower);
    case 'Number': return [{ kind: 'number', value: node.value }];
    case 'Dimension': return [{ kind: 'dimension', value: node.value, unit: node.unit.toLowerCase(),
      ...(css.lexer.matchType('length', node).matched ? { syntaxType: 'length' as const } : {}) }];
    case 'Percentage': return [{ kind: 'percentage', value: node.value }];
    case 'Identifier': return colored(node, { kind: 'word', value: node.name,
      ...(node.name.includes('\\') ? { identifier: css.ident.decode(node.name) } : {}) });
    case 'Hash': return colored(node, { kind: 'hash', value: node.value });
    case 'String': return [{ kind: 'string', value: node.value, quote: '"' }];
    case 'WhiteSpace': return [{ kind: 'space', value: node.value }];
    case 'Operator': {
      // CSS-tree includes required whitespace in '+'/'-' operator values.
      // The token kind carries separation; math backends need the operator.
      const operator = node.value.trim();
      return [{ kind: operator === ',' ? 'div' : 'operator', value: operator }];
    }
    case 'Function': return colored(node, { kind: 'function', value: node.name, children: node.children.toArray().flatMap(lower) });
    case 'Parentheses': return [{ kind: 'function', value: '', children: node.children.toArray().flatMap(lower) }];
    case 'Brackets': return [{ kind: 'block', value: '[', children: node.children.toArray().flatMap(lower) }];
    default: return [{ kind: 'raw', value: css.generate(node) }];
  }
}

/** CSS-tree separates dimensions and arithmetic operators, including unspaced '*'. */
export function compileValue(value: string): ValueToken[] {
  try {
    return lower(css.parse(value, { context: 'value', parseCustomProperty: true }));
  } catch {
    // Keep new/unknown syntax intact. A backend must diagnose it before use.
    return [{ kind: 'raw', value }];
  }
}
