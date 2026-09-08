import {heading,structuralPairs} from './structure.js';
import {formatSignature} from './formatting.js';
import { diffArrays, diffChars } from 'diff';
import {describeChange} from './change-description.js';

export function splitScenes(paragraphs){
  if(!paragraphs.length)return [{paragraphs:[],start:0,index:0}];
  const scenes=[];let start=0,seenText=false,afterBlank=false;
  for(let i=0;i<paragraphs.length;i++){
    const blank=paragraphs[i].trim()==='';
    if(!blank&&seenText&&(afterBlank||heading(paragraphs[i]))){scenes.push({paragraphs:paragraphs.slice(start,i),start,index:scenes.length});start=i;seenText=false;}
    if(!blank)seenText=true;afterBlank=blank&&seenText;
  }
  scenes.push({paragraphs:paragraphs.slice(start),start,index:scenes.length});return scenes;
}
function grams(text){const value=text.replace(/\s+/g,'').normalize('NFC');const set=new Set();const stride=Math.max(1,Math.floor(value.length/2200));for(let i=0;i<value.length-1;i+=stride)set.add(value.slice(i,i+2));return set}
function dice(a,b){if(!a.size&&!b.size)return 1;let same=0;for(const key of a)if(b.has(key))same++;return 2*same/(a.size+b.size)}
function align(a,b,textOf,threshold=.28){
  if(!a.length)return b.map((_,j)=>[null,j]);if(!b.length)return a.map((_,i)=>[i,null]);
  const aa=a.map(v=>grams(textOf(v))),bb=b.map(v=>grams(textOf(v))),n=a.length,m=b.length;
  // Bound dynamic programming for very large rewrites. Positional pairing affects display only.
  if(n*m>160000)return [...a.map((_,i)=>[i,null]),...b.map((_,j)=>[null,j])];
  const score=Array.from({length:n},()=>new Float32Array(m)),dp=Array.from({length:n+1},()=>new Float32Array(m+1));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--){const similarity=dice(aa[i],bb[j]);score[i][j]=similarity>=threshold?similarity-.18:0;dp[i][j]=Math.max(dp[i+1][j],dp[i][j+1],dp[i+1][j+1]+score[i][j])}
  let i=0,j=0;const rows=[];
  while(i<n||j<m){if(i<n&&j<m&&score[i][j]>0&&Math.abs(dp[i][j]-dp[i+1][j+1]-score[i][j])<.0001){rows.push([i++,j++])}else if(i<n&&(j===m||dp[i+1][j]>=dp[i][j+1]))rows.push([i++,null]);else rows.push([null,j++]);}return rows;
}
function chunks(a,b){
  const result=diffArrays(a,b,{timeout:6000});
  if(!result)throw Error('변경이 너무 많아 비교 시간이 길어졌습니다. 원고를 부별로 나누어 비교해 주세요.');
  let i=0,j=0;const out=[];
  for(let k=0;k<result.length;k++){
    const part=result[k];
    if(!part.added&&!part.removed){out.push({type:'equal',a:[i,i+part.count],b:[j,j+part.count]});i+=part.count;j+=part.count;continue}
    const startI=i,startJ=j;
    while(k<result.length&&(result[k].added||result[k].removed)){if(result[k].added)j+=result[k].count;else i+=result[k].count;k++}k--;
    out.push({type:'change',a:[startI,i],b:[startJ,j]});
  }return out;
}
function alignScenes(oldScenes,newScenes){
  const oldKeys=oldScenes.map(s=>s.paragraphs.join('\n')),newKeys=newScenes.map(s=>s.paragraphs.join('\n'));
  if(oldScenes.length===1&&newScenes.length===1&&!heading(oldScenes[0].paragraphs[0]||'')&&!heading(newScenes[0].paragraphs[0]||''))return [[0,0]];
  const changes=chunks(oldKeys,newKeys),pairs=[];
  for(const c of changes){if(c.type==='equal'){for(let k=0;k<c.a[1]-c.a[0];k++)pairs.push([c.a[0]+k,c.b[0]+k]);}else{for(const [a,b] of align(oldKeys.slice(...c.a),newKeys.slice(...c.b),s=>s,.38))pairs.push([a===null?null:c.a[0]+a,b===null?null:c.b[0]+b]);}}return pairs;
}
function inline(a,b){if(a===b)return null;const parts=diffChars(a,b,{timeout:30,maxEditLength:2400});if(!parts)return null;return [parts.filter(p=>!p.added).map(p=>[p.value,!!p.removed]),parts.filter(p=>!p.removed).map(p=>[p.value,!!p.added])];}
function pairGaps(aligned){
  const result=[];let old=[],rev=[];
  const flush=()=>{for(let i=0;i<Math.max(old.length,rev.length);i++)result.push([old[i]??null,rev[i]??null]);old=[];rev=[]};
  for(const [x,y] of aligned){if(x!==null&&y!==null){flush();result.push([x,y])}else{if(x!==null)old.push(x);if(y!==null)rev.push(y)}}flush();return result;
}
function paragraphPairs(a,b){const pairs=align(a,b,s=>s,.3);return a.length*b.length>160000?pairs:pairGaps(pairs)}
export function compareDocuments(original,revised){
  const oldScenes=splitScenes(original.paragraphs),newScenes=splitScenes(revised.paragraphs),pairs=structuralPairs(oldScenes,newScenes,alignScenes);
  let total=0,removed=0,added=0;
  const scenes=pairs.map(({a:oi,b:ni,...structure},index)=>{
    const a=oi===null?[]:oldScenes[oi].paragraphs,b=ni===null?[]:newScenes[ni].paragraphs;
    const segments=[];let number=0;
    for(const block of chunks(a,b)){
      if(block.type==='equal'){
        let start=0;const count=block.a[1]-block.a[0];
        for(let i=0;i<count;i++){const ax=block.a[0]+i,by=block.b[0]+i,af=original.formatting?.[oldScenes[oi].start+ax],bf=revised.formatting?.[newScenes[ni].start+by];if(!af&&!bf||formatSignature(a[ax],af)===formatSignature(b[by],bf))continue;
          if(i>start)segments.push({type:'equal',a:[block.a[0]+start,ax],b:[block.b[0]+start,by]});
          const description=describeChange(a[ax],b[by],null,{oldParagraphs:1,newParagraphs:1});description.kind='format';description.label='서식 변경';description.structure='';
          segments.push({type:'change',id:`s${index+1}-c${++number}`,number,a:[ax,ax+1],b:[by,by+1],kind:'modified',rows:[[ax,by,null]],description});total++;removed++;added++;start=i+1;
        }
        if(start<count)segments.push({type:'equal',a:[block.a[0]+start,block.a[1]],b:[block.b[0]+start,block.b[1]]});continue;
      }
      let oldCursor=block.a[0],newCursor=block.b[0];
      for(const [x,y] of paragraphPairs(a.slice(...block.a),b.slice(...block.b))){
        const ax=x===null?null:block.a[0]+x,by=y===null?null:block.b[0]+y;
        const g={type:'change',id:`s${index+1}-c${++number}`,number,a:[oldCursor,oldCursor+(ax===null?0:1)],b:[newCursor,newCursor+(by===null?0:1)],kind:ax===null?'added':by===null?'deleted':'modified',rows:[[ax,by,ax!==null&&by!==null?inline(a[ax],b[by]):null]]};
        g.description=describeChange(ax===null?null:a[ax],by===null?null:b[by],g.rows[0][2],{oldParagraphs:block.a[1]-block.a[0],newParagraphs:block.b[1]-block.b[0]});
        oldCursor=g.a[1];newCursor=g.b[1];segments.push(g);
        total++;removed+=ax===null?0:1;added+=by===null?0:1;
      }
    }
    const title=(a.find(p=>p.trim())||b.find(p=>p.trim())||'빈 문서').trim().slice(0,60);
    return {...structure,id:`s${index+1}`,title,old:a,new:b,oldIndex:oi,newIndex:ni,oldStart:oi===null?null:oldScenes[oi].start,newStart:ni===null?null:newScenes[ni].start,changes:number,segments};
  });
  return {original:{name:original.name,characters:original.characters,paragraphs:original.paragraphs.length,sceneCount:oldScenes.length,warnings:original.warnings||[]},revised:{name:revised.name,characters:revised.characters,paragraphs:revised.paragraphs.length,sceneCount:newScenes.length,warnings:revised.warnings||[]},scenes,totalChanges:total,removed,added};
}
export function selectedParagraphs(comparison,choices={}){
  const output=[];
  for(const scene of comparison.scenes)for(const g of scene.segments){const useNew=g.type==='change'&&choices[g.id]==='new';output.push(...scene[useNew?'new':'old'].slice(...(useNew?g.b:g.a)));}
  return output;
}
export function choiceCounts(comparison,choices){const ids=new Set(comparison.scenes.flatMap(s=>s.segments.filter(g=>g.type==='change').map(g=>g.id)));let old=0,rev=0;for(const [id,v] of Object.entries(choices)){if(!ids.has(id))continue;if(v==='old')old++;if(v==='new')rev++;}return {old,rev,pending:comparison.totalChanges-old-rev,done:old+rev}}
export function validateChoices(comparison,input){if(!input||typeof input!=='object'||Array.isArray(input))throw Error('선택 기록 형식이 올바르지 않습니다.');const ids=new Set(comparison.scenes.flatMap(s=>s.segments.filter(g=>g.type==='change').map(g=>g.id)));for(const [k,v] of Object.entries(input))if(!ids.has(k)||!['old','new'].includes(v))throw Error('이 비교에 맞지 않는 선택 기록입니다.');return {...input}}
