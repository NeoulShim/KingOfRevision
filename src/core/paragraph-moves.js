import {heading} from './structure.js';
import {describeChange} from './change-description.js';
// Link only unique verbatim paragraphs; repeated prose is ambiguous.
export function markParagraphMoves(scenes){
 const groups=new Map();for(const s of scenes){const key=s.partKey||'document';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(s)}
 for(const group of groups.values()){
  const occurrences={old:new Map(),new:new Map()},changed={old:new Map(),new:new Map()};
  for(const s of group)for(const side of ['old','new']){
   for(const p of s[side])occurrences[side].set(p,(occurrences[side].get(p)||0)+1);
   for(const g of s.segments)if(g.type==='change'){const range=g[side==='old'?'a':'b'];if(range[1]-range[0]===1){const p=s[side][range[0]];if(p.trim()&&!heading(p))changed[side].set(p,{s,g})}}
  }
  const candidates=new Set([...changed.old.keys()].filter(p=>occurrences.old.get(p)===1&&occurrences.new.get(p)===1&&changed.new.has(p)&&changed.old.get(p).g!==changed.new.get(p).g));
  for(const s of group){s.segments=s.segments.flatMap(g=>{
   if(g.type!=='change'||g.a[1]-g.a[0]!==1||g.b[1]-g.b[0]!==1||!candidates.has(s.old[g.a[0]])&&!candidates.has(s.new[g.b[0]]))return [g];
   const x=g.a[0],y=g.b[0];return [{...g,a:[x,x+1],b:[y,y],kind:'deleted',rows:[[x,null,null]],description:describeChange(s.old[x],null,null)},{...g,a:[x+1,x+1],b:[y,y+1],kind:'added',rows:[[null,y,null]],description:describeChange(null,s.new[y],null)}];
  });let n=0;for(const g of s.segments)if(g.type==='change'){g.number=++n;g.id=s.id+'-c'+n}s.changes=n;}
  const source=new Map(),target=new Map();for(const s of group)for(const g of s.segments)if(g.type==='change'){
   if(g.a[1]>g.a[0]&&g.b[1]===g.b[0])source.set(s.old[g.a[0]],{s,g});if(g.b[1]>g.b[0]&&g.a[1]===g.a[0])target.set(s.new[g.b[0]],{s,g});
  }
  for(const p of candidates){const a=source.get(p),b=target.get(p);if(!a||!b)continue;const from=a.s.oldStart+a.g.a[0]+1,to=b.s.newStart+b.g.b[0]+1;
   for(const [entry,other,role] of [[a,b,'from'],[b,a,'to']]){entry.g.move={peerId:other.g.id,role,from,to,peerScene:other.s.id};entry.g.description={...entry.g.description,kind:'move',label:role==='from'?'문단 이동 · 이전 위치':'문단 이동 · 새 위치',structure:'원문 '+from+'문단 → 개고 '+to+'문단 · 두 위치 함께 선택'};}
  }
  const counts={old:group.reduce((n,s)=>n+s.old.filter(p=>p.trim()&&!heading(p)).length,0),new:group.reduce((n,s)=>n+s.new.filter(p=>p.trim()&&!heading(p)).length,0)};for(const s of group)s.paragraphCounts=counts;
 }
}
export function linkedChoices(model,input){const out={...input};for(const s of model.scenes)for(const g of s.segments)if(g.move){const a=out[g.id],b=out[g.move.peerId];if(a&&b&&a!==b)throw Error('이동한 문단의 두 위치에는 같은 선택을 적용해 주세요.');if(a||b)out[g.id]=out[g.move.peerId]=a||b;}return out;}
