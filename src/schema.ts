/** Versioned, JSON-compatible data consumed by the Roblox backend. */
export interface Stylesheet {
  version: 1;
  nodes: CssNode[];
  properties?: Record<string, PropertyMetadata>;
}

export interface PropertyMetadata {
  inherited: boolean;
  initial?: ValueToken[];
  initialText?: string;
  longhands?: string[];
  animationType?: string | string[];
}

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

export interface SelectorToken {
  kind: string;
  value: string;
  attribute?: string;
  operator?: string;
  insensitive?: boolean;
  namespace?: string | boolean;
  children?: SelectorToken[];
  nth?: { a: number; b: number; of?: SelectorToken[] };
  nthError?: string;
}

export interface Selector {
  text: string;
  tokens: SelectorToken[];
  specificity: [number, number, number];
}

export interface ValueToken {
  kind: string;
  value: string;
  /** Decoded CSS identifier when value preserves escape spelling. */
  identifier?: string;
  children?: ValueToken[];
  quote?: string;
  unit?: string;
  color?: RgbaColor;
  /** Context-free lexer classification, not a computed or renderable value. */
  syntaxType?: 'color' | 'length';
}

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

export type RangeOperand =
  | { kind: 'feature'; name: string }
  | { kind: 'value'; tokens: ValueToken[] };

export type ConditionExpression =
  | { kind: 'and' | 'or'; operands: ConditionExpression[] }
  | { kind: 'not'; operand: ConditionExpression }
  | { kind: 'media-type'; name: string }
  | { kind: 'feature'; name: string; tokens?: ValueToken[] }
  | { kind: 'range'; rangeOperands: RangeOperand[]; comparisons: string[] }
  | { kind: 'declaration'; property: string; tokens: ValueToken[] }
  | { kind: 'selector'; selectors: Selector[] }
  | { kind: 'general-enclosed'; queryKind: string; text: string }
  | { kind: 'unknown'; text: string };

export interface Declaration {
  kind: 'declaration';
  property: string;
  value: string;
  tokens: ValueToken[];
  important: boolean;
  validity?: 'valid' | 'invalid' | 'deferred' | 'unknown';
  source?: SourceLocation;
}

/** Normalized element-attached declarations, compiled with the existing CSS frontend. */
export interface InlineStyle {
  declarations: Declaration[];
  properties?: Record<string, PropertyMetadata>;
}

export interface Rule {
  kind: 'rule';
  selectors: Selector[];
  children: CssNode[];
  source?: SourceLocation;
}

export interface AtRule {
  kind: 'at-rule';
  name: string;
  params: string;
  tokens: ValueToken[];
  children?: CssNode[];
  condition?: ConditionExpression;
  registration?: PropertyRegistration;
  keyframes?: KeyframesDefinition;
  source?: SourceLocation;
}

export type KeyframesDefinition = { status: 'valid'; name: string } | { status: 'invalid'; reason: string };

export type PropertyRegistration =
  | { status: 'invalid'; reason: string }
  | { status: 'valid' | 'unchecked'; name: string; syntax: string; inherits: boolean; initial?: ValueToken[]; reason?: string; syntaxDefinition?: PropertySyntax };

export interface PropertySyntax {
  universal: boolean;
  branches: { kind: 'type' | 'keyword'; name: string; list: 'single' | 'space' | 'comma' }[];
}

export interface KeyframeStep {
  kind: 'keyframe-step';
  offsets: string[];
  /** Normalized offsets in [0, 1]; [] ignores an invalid selector list. */
  positions?: number[];
  children: CssNode[];
  source?: SourceLocation;
}

export type CssNode = Declaration | Rule | AtRule | KeyframeStep;

export interface FeatureOccurrence {
  feature: string;
  count: number;
  sources: SourceLocation[];
}

export interface Inventory {
  rules: number;
  declarations: number;
  keyframeSteps: number;
  properties: FeatureOccurrence[];
  descriptors: FeatureOccurrence[];
  functions: FeatureOccurrence[];
  selectors: FeatureOccurrence[];
  atRules: FeatureOccurrence[];
  conditions: FeatureOccurrence[];
  valueKinds: FeatureOccurrence[];
}
