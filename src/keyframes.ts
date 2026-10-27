import type { AtRule as PostcssAtRule } from 'postcss';
import { compileValue } from './values.js';
import type { KeyframesDefinition } from './schema.js';

const forbidden = new Set(['none', 'default', 'initial', 'inherit', 'unset', 'revert', 'revert-layer']);

/** Keep escaped source spelling in the IR while recording the identifier's identity. */
export function compileKeyframes(node: PostcssAtRule): KeyframesDefinition {
  if (!node.nodes) return { status: 'invalid', reason: 'keyframes-block-required' };
  const parts = compileValue(node.params).filter(token => token.kind !== 'space' && token.kind !== 'comment');
  const token = parts[0];
  if (parts.length !== 1 || !token || (token.kind !== 'word' && token.kind !== 'string')) {
    return { status: 'invalid', reason: 'keyframes-name-required' };
  }
  const name = token.identifier ?? token.value;
  if (token.kind === 'word' && forbidden.has(name.toLowerCase())) {
    return { status: 'invalid', reason: 'reserved-keyframes-name' };
  }
  return { status: 'valid', name };
}

/** CSS Animations 1 offsets; timeline-range selectors need further metadata. */
export function compileKeyframePositions(offsets: string[]): number[] {
  const positions: number[] = [];
  for (const offset of offsets) {
    const parts = compileValue(offset).filter(token => token.kind !== 'space' && token.kind !== 'comment');
    const token = parts[0];
    if (parts.length !== 1 || !token) return [];
    const name = (token.identifier ?? token.value).toLowerCase();
    const value = token.kind === 'word' && name === 'from' ? 0
      : token.kind === 'word' && name === 'to' ? 1
        : token.kind === 'percentage' ? Number(token.value) / 100 : NaN;
    if (!Number.isFinite(value) || value < 0 || value > 1) return [];
    if (!positions.includes(value)) positions.push(value);
  }
  return positions;
}
