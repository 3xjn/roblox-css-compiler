// Legacy names use their canonical property's grammar and metadata. Keep the
// source declaration name for cascade ordering and namesake inheritance.
const aliases = new Map([['word-wrap', 'overflow-wrap']]);

export function canonicalProperty(property: string): string {
  return aliases.get(property) ?? property;
}
