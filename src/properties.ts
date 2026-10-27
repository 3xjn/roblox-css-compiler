import fs from 'node:fs';
import { compileValue } from './values.js';
import { declarationValidity } from './validity.js';
import { canonicalProperty } from './aliases.js';
import type { CssNode, PropertyMetadata } from './schema.js';

interface PropertyData {
  inherited: boolean;
  initial: string | string[];
  status: string;
  animationType?: string | string[];
}

// MDN data is CC0. Only property metadata is shipped; no Node dependency enters Roblox.
const data = JSON.parse(fs.readFileSync(new URL(import.meta.resolve('mdn-data/css/properties.json')), 'utf8')) as Record<string, PropertyData>;

// These newer shorthand/reset relationships are incomplete in pinned MDN data.
const variantLonghands = ['font-variant-ligatures', 'font-variant-position', 'font-variant-caps',
  'font-variant-numeric', 'font-variant-alternates', 'font-variant-east-asian', 'font-variant-emoji'];
const fontLonghands = ['font-style', 'font-weight', 'font-width', 'font-size', 'line-height', 'font-family',
  'font-feature-settings', 'font-kerning', 'font-language-override', 'font-optical-sizing',
  'font-size-adjust', 'font-variation-settings', ...variantLonghands];
function longhands(property: string, entry: PropertyData): string[] | undefined {
  if (property === 'animation') return [...new Set([
    ...(Array.isArray(entry.initial) ? entry.initial : []), 'animation-range-start', 'animation-range-end',
  ])];
  if (property === 'font') return fontLonghands;
  if (property === 'font-variant') return variantLonghands;
  if (!Array.isArray(entry.initial)) return undefined;
  return property === 'text-decoration' ? [...new Set([...entry.initial, 'text-decoration-thickness'])] : entry.initial;
}

export function propertyMetadata(nodes: CssNode[]): Record<string, PropertyMetadata> {
  const result: Record<string, PropertyMetadata> = {};
  function add(property: string) {
    property = canonicalProperty(property);
    if (result[property]) return;
    const entry = data[property];
    if (!entry || property.startsWith('--')) return;
    const info: PropertyMetadata = { inherited: entry.inherited };
    if (entry.animationType !== undefined) info.animationType = structuredClone(entry.animationType);
    result[property] = info;
    if (property === 'all') {
      // Use the existing metadata catalogue, not a second hand-maintained list.
      // Exclude other shorthands: all's targets must enter the cascade as leaves.
      info.longhands = Object.keys(data).filter(name =>
        name !== 'all' && name !== 'direction' && name !== 'unicode-bidi' &&
        !name.startsWith('--') && !longhands(name, data[name]!),
      ).sort();
      for (const longhand of info.longhands) add(longhand);
    } else if (longhands(property, entry)) {
      const targets = longhands(property, entry)!;
      info.longhands = [...targets];
      for (const longhand of targets) add(longhand);
    } else if (typeof entry.initial === 'string') {
      info.initialText = entry.initial;
      if (declarationValidity(property, entry.initial) === 'valid') info.initial = compileValue(entry.initial);
    }
  }
  function visit(children: CssNode[]) {
    for (const node of children) {
      if (node.kind === 'declaration') add(node.property);
      else if (node.children) visit(node.children);
    }
  }
  visit(nodes);
  for (const [property, entry] of Object.entries(data)) {
    if (entry.inherited && entry.status === 'standard') add(property);
  }
  return result;
}
