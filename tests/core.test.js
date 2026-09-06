import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {readHwpx,writeHwpx,LIMITS} from '../src/core/hwpx.js';
import {compareDocuments,selectedParagraphs,splitScenes,validateChoices,choiceCounts} from '../src/core/compare.js';
import {registerTools} from '../src/webmcp.js';
import {readHwp,writeHwp} from '../src/core/hwp.js';
import {readDocument,outputFormat,writeDocument} from '../src/core/document.js';
import {paragraphPresentation} from '../src/core/review.js';
import {Worker} from 'node:worker_threads';
const doc=paragraphs=>({paragraphs,name:'원고.hwpx',characters:paragraphs.join('').length,warnings:[]});
const compare=(a,b)=>compareDocuments(doc(a),doc(b));
const choices=(m,value)=>Object.fromEntries(m.scenes.flatMap(s=>s.segments.filter(g=>g.type==='change').map(g=>[g.id,value])));
function mutate(edit){const files=unzipSync(writeHwpx(['본문']));edit(files);return zipSync(files)}
test('HWPX round-trip preserves Korean, entities, emoji, tabs, soft breaks, blank paragraphs',()=>{
  const p=['제목','', '“한글 & <태그> \'인용\'” 🙂 𝄞','\t들여쓰기\n문단 안 줄바꿈','', '', '끝',''];
  const bytes=writeHwpx(p,{title:'제목 < & >'});assert.deepEqual(readHwpx(bytes).paragraphs,p);
  assert.equal(new DataView(bytes.buffer).getUint16(8,true),0,'mimetype must be stored, not deflated');
  assert.equal(strFromU8(bytes.slice(30,38)),'mimetype');
});
test('extracts all text runs once, preserving embedded table text order',()=>{
  const b=mutate(f=>{f['Contents/section0.xml']=strToU8('<hs:sec xmlns:hs="s" xmlns:hp="p"><hp:p><hp:run><hp:t>첫</hp:t></hp:run><hp:run><hp:t> 문장</hp:t><hp:tbl><hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>표 안</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl><hp:t>다음</hp:t></hp:run></hp:p><hp:p><hp:run><hp:t/></hp:run></hp:p></hs:sec>')});
  const result=readHwpx(b);assert.deepEqual(result.paragraphs,['첫 문장','표 안','다음','']);assert.ok(result.warnings.length);
});
test('content.hpf spine controls section order and rejects missing sections',()=>{
  const b=mutate(f=>{
    f['Contents/section1.xml']=strToU8(strFromU8(f['Contents/section0.xml']).replace('본문','먼저'));
    f['Contents/content.hpf']=strToU8('<package><manifest><item id="a" href="section0.xml"/><item id="b" href="section1.xml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>');
  });assert.deepEqual(readHwpx(b).paragraphs,['먼저','본문']);
  assert.throws(()=>readHwpx(mutate(f=>f['Contents/content.hpf']=strToU8('<package><item id="s" href="section8.xml"/><itemref idref="s"/></package>'))),/누락/);
});
test('rejects invalid extensions, counterfeit containers, malformed or unsafe XML, encrypted documents and large files',()=>{
  assert.throws(()=>readHwpx(writeHwpx(['x']),'file.hwp'),/HWPX/);
  assert.throws(()=>readHwpx(new Uint8Array([1,2,3])),/형식/);
  assert.throws(()=>readHwpx(zipSync({mimetype:strToU8('application/zip')})),/올바른/);
  assert.throws(()=>readHwpx(mutate(f=>f['Contents/section0.xml']=strToU8('<sec><p></sec>'))),/손상/);
  assert.throws(()=>readHwpx(mutate(f=>f['Contents/section0.xml']=strToU8('<!DOCTYPE sec [<!ENTITY x "foo">]><sec/>'))),/외부 개체/);
  assert.throws(()=>readHwpx(mutate(f=>f['META-INF/encryption.xml']=strToU8('<EncryptionData/>'))),/암호화/);
  assert.throws(()=>readHwpx(new Uint8Array(LIMITS.file+1)),/30 MB/);
  assert.throws(()=>readHwpx(mutate(f=>f['../unsafe']=strToU8('x'))),/경로/);
});
test('Enter twice means a blank paragraph; soft breaks alone never split scenes',()=>{
  const p=['제목','본문\n같은 문단','','','새 장면','','끝'];
  const s=splitScenes(p);assert.equal(s.length,3);assert.deepEqual(s.flatMap(x=>x.paragraphs),p);
  assert.deepEqual(splitScenes(['','','']).map(s=>s.paragraphs),[['','','']]);
  assert.deepEqual(splitScenes(['','첫 문장','']).map(s=>s.paragraphs),[['','첫 문장','']]);
});
const scenarios=[
  [[],[]],[[],['추가']],[['삭제'],[]],
  [['가','나','다'],['가','나 수정','다']],
  [['첫 장면','','끝 장면'],['첫 장면','','새 장면','','끝 장면']],
  [['장면 A','','장면 B','','장면 C'],['장면 C','','장면 A','','장면 B']],
  [['문단A','문단B','문단C'],['문단A','','문단B','','문단C']],
  [['  ','문장','',''],['','문장 수정','']],
];
for(const [a,b] of scenarios)test('all-old/all-new reconstruction: '+JSON.stringify(a).slice(0,45),()=>{
  const m=compare(a,b);assert.deepEqual(selectedParagraphs(m),a);assert.deepEqual(selectedParagraphs(m,choices(m,'old')),a);assert.deepEqual(selectedParagraphs(m,choices(m,'new')),b);
  for(const s of m.scenes)for(const g of s.segments.filter(x=>x.type==='change')){
    assert.deepEqual(g.rows.map(r=>r[0]).filter(x=>x!==null),Array.from({length:g.a[1]-g.a[0]},(_,i)=>i+g.a[0]));
    assert.deepEqual(g.rows.map(r=>r[1]).filter(x=>x!==null),Array.from({length:g.b[1]-g.b[0]},(_,i)=>i+g.b[0]));
  }
});
test('mixed choices keep unselected original paragraphs and survive HWPX export',()=>{
  const m=compare(['앞','옛 문장','사이','마지막'],['앞','새 문장','사이','변경된 끝']);
  const ids=Object.keys(choices(m,'new'));const picked={[ids[0]]:'new'};
  const output=selectedParagraphs(m,picked);assert.deepEqual(output,['앞','새 문장','사이','마지막']);
  assert.deepEqual(readHwpx(writeHwpx(output)).paragraphs,output);
  assert.deepEqual(choiceCounts(m,picked),{old:0,rev:1,pending:1,done:1});
  assert.throws(()=>validateChoices(m,{unknown:'new'}));assert.throws(()=>validateChoices(m,{[ids[0]]:'invalid'}));
});
test('random edits never lose original or revised content',()=>{
  let seed=421;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
  for(let n=0;n<80;n++){
    const a=Array.from({length:30},(_,i)=>random()<.2?'':'문단 '+i+' 테스트');const b=[...a];
    for(let j=0;j<10;j++){const index=Math.floor(random()*b.length);if(random()<.4)b.splice(index,1);else b.splice(index,random()<.5?1:0,random()<.2?'':'수정 '+n+' '+j);}
    const m=compare(a,b);assert.deepEqual(selectedParagraphs(m),a);assert.deepEqual(selectedParagraphs(m,choices(m,'new')),b);
  }
});
test('published example files match the reviewed texts exactly, including all blank paragraphs',async()=>{
  const docs=[];
  for(const v of ['원문','개고안']){
    const name='한_쪽이_너무_유리한_게임_'+v;
    const txt=await readFile(new URL('../examples/'+name+'.txt',import.meta.url),'utf8');
    const file=await readFile(new URL('../public/examples/'+name+'.hwpx',import.meta.url));
    const d=readHwpx(file,name+'.hwpx');assert.deepEqual(d.paragraphs,txt.replace(/\r\n/g,'\n').split('\n'));docs.push(d);
  }
  const m=compareDocuments(...docs);assert.ok(m.totalChanges>10);assert.equal(docs[0].paragraphs.length,docs[1].paragraphs.length);
  assert.ok(docs[1].characters/docs[0].characters>.95);
  assert.deepEqual(selectedParagraphs(m,choices(m,'new')),docs[1].paragraphs);
});
test('180,000+ character manuscript can be compared and exported without truncation',()=>{
  const a=Array.from({length:1600},(_,i)=>i%40===39?'':i+' '+ '그는 창밖을 바라보았다. 멀리서 돌아오는 사람의 발소리가 들렸다. '.repeat(4));
  const b=a.map((p,i)=>i%17===0?p.replace('창밖','문밖'):p);assert.ok(a.join('').length>180000);
  const m=compare(a,b);const output=selectedParagraphs(m,choices(m,'new'));assert.deepEqual(output,b);assert.deepEqual(readHwpx(writeHwpx(output)).paragraphs,b);
});
test('WebMCP registration adapter validates inputs and cleans up (mock contract only)',async()=>{
  const registered=[];let page='use',loaded=false;
  const stop=registerTools({getSummary:()=>({loaded}),demo:async()=>{loaded=true},showPage:p=>{page=p}}, {registerTool:(tool,options)=>registered.push({tool,options})});
  assert.equal(registered.length,3);const [read,start,nav]=registered.map(r=>r.tool);
  assert.equal(read.annotations.readOnlyHint,true);assert.deepEqual(read.execute({}),{loaded:false});
  assert.deepEqual(await start.execute({}),{loaded:true});assert.throws(()=>read.execute({extra:1}));
  assert.throws(()=>nav.execute({page:'bad'}));assert.equal(page,'use');assert.deepEqual(nav.execute({page:'guide'}),{page:'guide'});assert.equal(page,'guide');
  stop();assert.ok(registered.every(r=>r.options.signal.aborted));
});
test('consecutive changed paragraphs can be selected independently and display one resolved text',()=>{
  const a=['첫 번째 문단입니다.','두 번째 문단입니다.','세 번째 문단입니다.'];
  const b=['첫 번째 문단을 고칩니다.','두 번째 문단을 고칩니다.','세 번째 문단을 고칩니다.'];
  const m=compare(a,b),s=m.scenes[0],changes=s.segments.filter(g=>g.type==='change');assert.equal(changes.length,3);
  const picked={[changes[1].id]:'new'};assert.deepEqual(selectedParagraphs(m,picked),[a[0],b[1],a[2]]);
  assert.deepEqual(paragraphPresentation(s,changes[1],'new'),{resolved:true,choice:'new',text:b[1]});
  assert.equal(paragraphPresentation(s,changes[1],undefined).resolved,false);assert.deepEqual(s.old,a);assert.deepEqual(s.new,b);
});
test('sentence and paragraph split/merge/rewrite descriptions are distinct',()=>{
  const one=compare(['문을 열고 창문을 닫았다.'],['문을 열었다. 창문을 닫았다.']).scenes[0].segments[0];
  assert.equal(one.description.label,'문장 나눔');assert.equal(one.description.before,1);assert.equal(one.description.after,2);
  const merged=compare(['문을 열었다. 창문을 닫았다.'],['문을 열고 창문을 닫았다.']).scenes[0].segments[0];assert.equal(merged.description.label,'문장 합침');
  const rewrite=compare(['눈부시게 찬란한 여름의 태양.'],['곰팡이 냄새 밴 지하실.']).scenes[0].segments[0];assert.equal(rewrite.description.label,'문장 교체');
  const split=compare(['문을 열었다. 창문을 닫았다.'],['문을 열었다.','창문을 닫았다.']);
  assert.ok(split.scenes[0].segments.filter(g=>g.type==='change').every(g=>g.description.structure==='문단 나눔 1 → 2'));
});
test('real HWP container round-trip and extension-based output policy',()=>{
  const p=['HWP 원고','', '한글 🙂 <>& 및 “인용”','\t탭\n줄 바꿈','', '끝'];
  const b=writeHwp(p);assert.deepEqual([...b.subarray(0,8)],[208,207,17,224,161,177,26,225]);assert.deepEqual(readHwp(b).paragraphs,p);
  for(const [a,b,expected] of [['hwp','hwp','hwp'],['hwp','hwpx','hwpx'],['hwpx','hwp','hwpx'],['hwpx','hwpx','hwpx']])assert.equal(outputFormat(a,b),expected);
  for(const format of ['hwp','hwpx'])assert.deepEqual(readDocument(writeDocument(p,format),`원고.${format}`).paragraphs,p);
  assert.throws(()=>readHwp(new Uint8Array([1,2,3])),/HWP 5/);
});
test('all published example text survives HWP export without metadata or macros',async()=>{
  for(const v of ['원문','개고안']){
    const text=await readFile(new URL('../examples/한_쪽이_너무_유리한_게임_'+v+'.txt',import.meta.url),'utf8');
    const p=text.replace(/\r\n/g,'\n').split('\n');assert.deepEqual(readHwp(writeHwp(p)).paragraphs,p);
  }
});
test('worker compares mixed formats and exports selections with the automatic format',async()=>{
  const worker=new Worker(new URL('./worker-adapter.js',import.meta.url));
  let id=0;const call=(type,payload)=>new Promise((resolve,reject)=>{const n=++id;worker.once('message',data=>data.error?reject(Error(data.error)):resolve(data.result));worker.once('error',reject);worker.postMessage({id:n,type,payload})});
  try{
    const a=['제목','','옛 문장입니다.','마지막 문장'],b=['제목','','새 문장입니다.','마지막 문장'];
    for(const formats of [['hwp','hwp'],['hwp','hwpx'],['hwpx','hwp'],['hwpx','hwpx']]){
      const m=await call('compare',{old:{name:'원문.'+formats[0],buffer:writeDocument(a,formats[0]).buffer},new:{name:'개고.'+formats[1],buffer:writeDocument(b,formats[1]).buffer}});
      assert.equal(m.outputFormat,outputFormat(...formats));assert.ok(m.fingerprint.length===64);
      const result=await call('export',{choices:choices(m,'new'),format:'document',title:'결과'});
      assert.deepEqual(readDocument(result.buffer,'결과.'+m.outputFormat).paragraphs,b);
    }
  }finally{await worker.terminate()}
});
