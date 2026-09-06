const LIMITS={text:1000000,paragraphs:40000};
export function editorText(paragraphs){return paragraphs.map(p=>p.replaceAll('\n','\u2028')).join('\n')}
export function editorParagraphs(text){
  if(typeof text!=='string'||text.length>LIMITS.text)throw Error('편집할 원고는 100만 자까지 지원합니다.');
  const paragraphs=text.replace(/\r\n?/g,'\n').split('\n').map(p=>p.replaceAll('\u2028','\n'));
  if(paragraphs.length>LIMITS.paragraphs)throw Error('편집할 원고는 4만 문단까지 지원합니다.');
  return paragraphs;
}
export function retainChoices(before,after,choices){
  const key=(s,g)=>JSON.stringify([s.oldStart===null?null:s.oldStart+g.a[0],s.old.slice(...g.a),s.new.slice(...g.b)]);
  const old=new Map(),counts=new Map(),result={};
  for(const s of before.scenes)for(const g of s.segments)if(g.type==='change'){
    const k=key(s,g);old.set(k,old.has(k)?null:choices[g.id]||null);
  }
  for(const s of after.scenes)for(const g of s.segments)if(g.type==='change'){const k=key(s,g);counts.set(k,(counts.get(k)||0)+1)}
  for(const s of after.scenes)for(const g of s.segments)if(g.type==='change'){const k=key(s,g),v=old.get(k);if(v&&counts.get(k)===1)result[g.id]=v}
  return result;
}
