import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import CFB from 'cfb';
import {inflateSync,deflateSync,unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {readHwp,writeHwp,hwpRecords} from '../src/core/hwp.js';
import {readHwpx,writeHwpx} from '../src/core/hwpx.js';
import {readDocument,writeDocument} from '../src/core/document.js';
import {splitScenes,compareDocuments,selectedParagraphs} from '../src/core/compare.js';
import {selectedFormats,editFormats,splitEditorFormat} from '../src/core/formatting.js';

const formats=(paragraphs,breaks=[])=>paragraphs.map((text,i)=>({paragraph:breaks.includes(i)?{pageBreakBefore:true}:{},runs:[{text,style:{}}]}));
const doc=(paragraphs,breaks=[])=>({name:'fixture.hwp',format:'hwp',paragraphs,formatting:formats(paragraphs,breaks),characters:paragraphs.join('').length,warnings:[]});
const breaks=d=>d.formatting?.flatMap((f,i)=>f?.paragraph?.pageBreakBefore?[i]:[])||[];
const choices=m=>Object.fromEntries(m.scenes.flatMap(s=>s.segments.filter(g=>g.type==='change').map(g=>[g.id,'new'])));
function lossless(a,b){const m=compareDocuments(a,b);assert.deepEqual(selectedParagraphs(m,{}),a.paragraphs);assert.deepEqual(selectedParagraphs(m,choices(m)),b.paragraphs);return m}
const parts=m=>[...new Map(m.scenes.map(s=>[s.partKey,{title:s.partTitle,status:s.partStatus}])).values()];

function record(tag,level,data){const bytes=new Uint8Array(4+data.length);new DataView(bytes.buffer).setUint32(0,(tag|(level<<10)|(data.length<<20))>>>0,true);bytes.set(data,4);return bytes}
// Independently set the documented PARA_HEADER byte, rather than trusting our writer.
// https://cdn.hancom.com/link/docs/한글문서파일형식_5.0_revision1.3.pdf, tables 58–59.
function fixture(paragraphs,flags={},nestedAt=-1,automaticAt=-1){
 const cfb=CFB.read(writeHwp(paragraphs),{type:'array'}),entryPath=cfb.FullPaths.find(p=>p.endsWith('/BodyText/Section0')),entry=CFB.find(cfb,entryPath);
 let n=-1;const records=[];
 for(const r of hwpRecords(inflateSync(Uint8Array.from(entry.content)))){
  const data=r.data.slice();let level=r.level;
  if(r.tag===66){n++;data[11]=flags[n]??(n===0?3:0);if(n===nestedAt)level=2;}
  if(r.tag===67&&n===nestedAt)level=3;
  records.push(record(r.tag,level,data));
  if(r.tag===68&&n===automaticAt){const cache=new Uint8Array(36);new DataView(cache.buffer).setUint32(32,1,true);records.push(record(69,1,cache));}
 }
 const joined=new Uint8Array(records.reduce((n,r)=>n+r.length,0));let offset=0;
 for(const r of records){joined.set(r,offset);offset+=r.length;}
 CFB.utils.cfb_add(cfb,entryPath,deflateSync(joined));
 return Uint8Array.from(CFB.write(cfb,{type:'array',fileType:'cfb'}));
}

test('HWP reads Ctrl+Enter, not section/column flags or automatic page layout',()=>{
 const p=['시작','구역','다단','단','수동 쪽','구역과 쪽','자동 쪽'];
 const bytes=fixture(p,{1:1,2:2,3:8,4:4,5:5},-1,6),copy=bytes.slice(),d=readHwp(bytes);
 assert.deepEqual(d.paragraphs,p);assert.deepEqual(breaks(d),[4,5]);assert.deepEqual(bytes,copy);
 assert.equal(splitScenes(d.paragraphs,d.formatting).length,3);
 assert.equal(readHwp(fixture(p,{},-1,6)).formatting,undefined);
});

test('a page break in nested HWP text does not split the main manuscript',()=>{
 const d=readHwp(fixture(['본문','표 안의 문단','이어지는 본문'],{1:4},1));
 assert.deepEqual(breaks(d),[]);assert.equal(splitScenes(d.paragraphs,d.formatting).length,1);
});

test('HWPX reads explicit page attributes and paragraph-style page breaks',()=>{
 const z=unzipSync(writeHwpx(['시작','수동 쪽','단 나누기','문단 속성의 쪽'],{formatting:formats(['시작','수동 쪽','단 나누기','문단 속성의 쪽'])}));
 let section=strFromU8(z['Contents/section0.xml']);
 section=section.replace(/(<hp:p id="1"[^>]*pageBreak=")0/,(_,prefix)=>prefix+'true');
 section=section.replace(/(<hp:p id="2"[^>]*columnBreak=")0/,(_,prefix)=>prefix+'1');
 const paraRef=section.match(/<hp:p id="3"[^>]*paraPrIDRef="(\d+)"/)[1];
 const header=strFromU8(z['Contents/header.xml']);
 const originalStyle=header.match(new RegExp('<hh:paraPr\\b[^>]*\\bid="'+paraRef+'"[\\s\\S]*?</hh:paraPr>'))[0];
 const newId=1000,style=originalStyle.replace(/\bid="\d+"/,`id="${newId}"`).replace('pageBreakBefore="0"','pageBreakBefore="1"');
 z['Contents/header.xml']=strToU8(header.replace('</hh:paraProperties>',style+'</hh:paraProperties>'));
 z['Contents/section0.xml']=strToU8(section.replace(/(<hp:p id="3"[^>]*paraPrIDRef=")\d+/,(_,prefix)=>prefix+newId));
 assert.deepEqual(breaks(readHwpx(zipSync(z))),[1,3]);
});

test('empty and consecutive manual breaks create no empty parts or lost paragraphs',()=>{
 const p=['시작','','','','다음 부','',''];const d=doc(p,[0,2,3,6]);
 const scenes=splitScenes(p,d.formatting);assert.deepEqual(scenes.flatMap(s=>s.paragraphs),p);
 assert.equal(scenes.length,2);assert(scenes.every(s=>s.pageBreakBefore));
 assert.deepEqual(parts(lossless(d,d)).map(p=>p.title),['1부','2부']);
});

test('headings and page breaks at the same position create only one boundary',()=>{
 const p=['1부 숲','숲의 시작','','숲의 다음 장면','2부 바다','바다의 시작'];
 const d=doc(p,[4]);assert.deepEqual(parts(lossless(d,d)).map(p=>p.title),['1부 숲','2부 바다']);
});

test('a title page and epilogue do not duplicate numbered part labels',()=>{
 const p=['책 제목','','1부','숲의 시작','2부','바다의 시작','에필로그','끝의 이야기'];
 const d=doc(p,[2,4,6]);
 assert.deepEqual(parts(lossless(d,d)).map(p=>p.title),['머리말','1부','2부','에필로그']);
});

test('an inserted unnamed part does not shift later parts',()=>{
 const a=doc(['참나무 숲에서 새들이 울었다.','','이끼 낀 나뭇가지를 보았다.','바다에서 돛을 올리고 파도를 헤쳤다.','','선장은 항구에 배를 댔다.'],[3]);
 const b=doc([...a.paragraphs.slice(0,3),'도시의 지하철 승강장에 전광판이 번쩍였다.','자동차는 도로를 달렸다.',...a.paragraphs.slice(3)],[3,5]);
 const m=lossless(a,b);
 assert.deepEqual(parts(m).map(p=>p.status),['matched','added','matched']);
 assert(m.scenes.some(s=>s.partTitle==='3부'&&s.old.includes(a.paragraphs[3])&&s.new.includes(a.paragraphs[3])));
 assert(m.scenes.filter(s=>s.partStatus==='added').every(s=>!s.old.length));
});

test('deleted unnamed parts and one-sided manual breaks remain lossless',()=>{
 const p=['숲속의 나무와 새','바다의 파도와 돛','도시의 자동차와 지하철'];
 const a=doc(p,[1,2]),b=doc([p[0],p[2]],[1]);
 assert(parts(lossless(a,b)).some(p=>p.status==='deleted'));
 lossless(doc(p),a);lossless(a,doc(p));
});

test('adding text or splitting a paragraph never duplicates the inherited page break',()=>{
 const p=['첫 부','둘째 부'],f=formats(p,[1]);
 assert.deepEqual(breaks({formatting:editFormats(p,[...p,'덧붙인 문단'],f)}),[1]);
 assert.deepEqual(breaks({formatting:editFormats(p,['첫 부','둘째 부 수정','추가 문단'],f)}),[1]);
 assert.deepEqual(breaks({formatting:splitEditorFormat('둘째 부\n추가 문단',{...f[1],runs:[{text:'둘째 부\n추가 문단',style:{}}]})}),[0]);
});

for(const format of ['hwp','hwpx'])test(format+' export keeps selected manual boundaries and all text',()=>{
 const a=doc(['숲의 문단','바다의 문단'],[1]),b=doc(['숲의 문단','바다의 수정 문단'],[1]),m=lossless(a,b);
 for(const c of [{},choices(m)]){
  const p=selectedParagraphs(m,c),formatting=selectedFormats(m,c,{original:a,revised:b});
  const d=readDocument(writeDocument(p,format,{formatting}),'fixture.'+format);
  assert.deepEqual(d.paragraphs,p);assert.deepEqual(breaks(d),[1]);
 }
});

test('worker saves, restores, edits and exports manual part boundaries',async()=>{
 const worker=new Worker(new URL('./worker-adapter.js',import.meta.url));let id=0;
 const call=(type,payload)=>new Promise((resolve,reject)=>{worker.once('message',r=>r.error?reject(Error(r.error)):resolve(r.result));worker.postMessage({id:++id,type,payload})});
 try{
  const bytes=fixture(['숲의 문단','바다의 문단'],{1:4});
  const m=await call('compare',{old:{name:'old.hwp',buffer:bytes},new:{name:'new.hwp',buffer:bytes}});
  assert.equal(parts(m).length,2);
  const snapshot=await call('snapshot',{}),restored=await call('restore',{snapshot});
  assert.equal(restored.fingerprint,m.fingerprint);assert.deepEqual(parts(restored),parts(m));
  const tampered=structuredClone(snapshot);delete tampered.documents.revised.formatting[1].paragraph.pageBreakBefore;
  await assert.rejects(call('restore',{snapshot:tampered}),/맞지 않습니다/);
  const edited=await call('edit-paragraph',{fingerprint:m.fingerprint,choices:{},index:1,text:'바다의 문단\n바다의 다음 문단'});
  assert.equal(parts(edited.comparison).length,2);
  const updated=await call('snapshot',{});assert.deepEqual(breaks(updated.documents.revised),[1]);
  const exported=await call('export-revised',{});assert.deepEqual(breaks(readHwp(exported.buffer)),[1]);
  const oldDoc={name:'legacy.hwp',format:'hwp',paragraphs:['예전 문단'],warnings:[]};
  const fingerprint=createHash('sha256').update(JSON.stringify([5,oldDoc.paragraphs,oldDoc.paragraphs,undefined,undefined])).digest('hex');
  const old=await call('restore',{snapshot:{algorithmVersion:3,fingerprint,documents:{original:oldDoc,revised:oldDoc}}});
  assert.equal(old.fingerprint,fingerprint);assert.equal(old.totalChanges,0);
 }finally{await worker.terminate()}
});
