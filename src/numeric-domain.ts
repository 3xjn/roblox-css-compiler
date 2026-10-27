import * as css from 'css-tree';

export interface NumericRange { readonly minimum?: number; readonly maximum?: number; readonly integer?: boolean }
export interface NumericDomain { readonly zero: boolean; readonly ranges: readonly NumericRange[] }
interface Analysis { nullable: boolean; ranges: NumericRange[]; unknown: boolean }
const primitive = new Set(['number','integer','length','percentage','angle','time','frequency','resolution','flex','dimension']);
const nonnumeric = new Set(['ident','custom-ident','dashed-ident','string','url','hex-color','unicode-range','an-plus-b','id-selector','hash-token']);
const none = (): Analysis => ({ nullable:false,ranges:[],unknown:false });

/** Project a CSS definition onto one numeric token. Strings preserve an explicit
 * unit even at zero; booleans retain React's legacy number/implicit-px mode. */
export function compileNumericDomain(property: string, mode: boolean | string): NumericDomain {
  const unit = typeof mode === 'string' ? mode : mode ? 'px' : '';
  const prototype = `1${unit}`;
  if (property.startsWith('--')) return { zero:true,ranges:[{}] };
  const active = new Set<string>();
  function reference(kind:'type'|'property', name:string): Analysis {
    const key=`${kind}:${name}`;
    if(active.has(key)) return { ...none(),unknown:true };
    active.add(key);
    const definition=kind==='type'?css.lexer.getType(name):css.lexer.getProperty(name);
    let result:Analysis;
    if(definition?.syntax) result=walk(definition.syntax);
    else if(kind==='type'&&primitive.has(name)) {
      const matched=css.lexer.matchType(name,prototype).matched;
      result={...none(),ranges:matched?[...(name==='integer'?[{integer:true}]:[{}])]:[]};
    } else if(kind==='type'&&(nonnumeric.has(name)||name==='zero'||name.endsWith('()'))) result=none();
    else if(kind==='type'&&(name==='declaration-value'||name==='any-value')) result={nullable:true,ranges:[{}],unknown:false};
    else result={...none(),unknown:true};
    active.delete(key);
    return result;
  }
  function walk(node:css.DSNode):Analysis {
    if(node.type==='Type') {
      const result=reference('type',node.name);
      if(!node.opts) return result;
      const ranges=result.ranges.flatMap(range=>{
        const minimum=Math.max(range.minimum??-Infinity,node.opts!.min??-Infinity);
        const maximum=Math.min(range.maximum??Infinity,node.opts!.max??Infinity);
        if(minimum>maximum)return[];
        return [{...(minimum!==-Infinity?{minimum}:{}),...(maximum!==Infinity?{maximum}:{}),...(range.integer?{integer:true}:{})}];
      });
      return {...result,ranges};
    }
    if(node.type==='Property')return reference('property',node.name);
    if(node.type==='Keyword'&&!unit&&/^-?\d+$/.test(node.name)) {
      const value=Number(node.name);
      return {...none(),ranges:value!==0&&Number.isFinite(value)?[{minimum:value,maximum:value}]:[]};
    }
    // CSS-tree gives separators special empty-match behavior. Until that
    // sequence is projected, reject it rather than infer a numeric domain.
    if(node.type==='Comma')return {...none(),unknown:true,nullable:true};
    if(node.type==='Multiplier') {
      const result=walk(node.term);
      if(node.min>1&&!result.nullable)return none();
      if(node.min>1&&result.nullable)return{...none(),unknown:true};
      return {...result,nullable:node.min===0||result.nullable};
    }
    if(node.type==='Group') {
      const terms=node.terms.map(walk);
      const alternatives=node.combinator==='|'||node.combinator==='||';
      const candidates=alternatives?terms:terms.filter((_,index)=>terms.every((term,other)=>index===other||term.nullable));
      return {
        nullable:!node.disallowEmpty&&(node.combinator==='|'?terms.some(term=>term.nullable):node.combinator==='||'?false:terms.every(term=>term.nullable)),
        ranges:candidates.flatMap(term=>term.ranges),unknown:candidates.some(term=>term.unknown),
      };
    }
    return none();
  }
  const result=reference('property',property);
  if(result.unknown&&!result.ranges.some(range=>range.minimum===undefined&&range.maximum===undefined&&!range.integer)) {
    throw Error(`Numeric style grammar needs an adapter: ${property}`);
  }
  return {zero:!!css.lexer.matchProperty(property,typeof mode==='string'?`0${unit}`:'0').matched,ranges:result.ranges};
}
