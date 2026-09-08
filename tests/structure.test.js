import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {heading} from '../src/core/structure.js';
import {compareDocuments,selectedParagraphs,splitScenes} from '../src/core/compare.js';
const doc=p=>({name:'test.txt',format:'txt',paragraphs:p,characters:p.join('').length,warnings:[]});
const model=(a,b)=>compareDocuments(doc(a),doc(b));
const adopt=m=>Object.fromEntries(m.scenes.flatMap(s=>s.segments.filter(g=>g.type==='change').map(g=>[g.id,'new'])));
function lossless(a,b){const m=model(a,b);assert.deepEqual(selectedParagraphs(m,{}),a);assert.deepEqual(selectedParagraphs(m,adopt(m)),b);return m}
const a=['1부 숲','나무와 이끼로 가득한 숲속을 걸었다.','','새벽의 새들이 나뭇가지에서 지저귀었다.','2부 바다','푸른 바다 위에서 돛을 올리고 파도를 헤쳤다.','','선장은 항구에 배를 댔다.'];
test('standalone part and chapter titles split without requiring empty paragraphs',()=>{for(const s of ['1부','제 2 장: 출발','Part IV Arrival','Chapter 3'])assert(heading(s));for(const s of ['1부에서 일어난 일이다.','그는 2장짜리 편지를 썼다.','첫 문단\n1부'])assert.equal(heading(s),null);assert.deepEqual(splitScenes(a).flatMap(s=>s.paragraphs),a);assert(splitScenes(a).some(s=>s.paragraphs[0]==='2부 바다'))});
test('new part inserted and later part renumbered stays an addition instead of replacing following text',()=>{const b=[...a.slice(0,4),'2부 도시','기차역의 전광판이 번쩍이고 자동차들이 경적을 울렸다.','','지하철 승강장에는 승객들이 모였다.',...a.slice(4).map(p=>p==='2부 바다'?'3부 바다':p)];const m=lossless(a,b),added=m.scenes.filter(s=>s.partStatus==='added');assert(added.length);assert(added.every(s=>s.old.length===0&&s.partTitle==='2부 도시'));assert(m.scenes.some(s=>s.partTitle==='3부 바다'&&s.old.includes('2부 바다')))});
test('deleted part stays deleted while later parts survive',()=>{const b=a.slice(4);const m=lossless(a,b);assert(m.scenes.filter(s=>s.partStatus==='deleted').every(s=>s.new.length===0));assert(m.scenes.some(s=>s.partStatus==='deleted'&&s.partTitle==='1부 숲'));assert(m.scenes.some(s=>s.partStatus==='matched'&&s.partTitle==='2부 바다'))});
test('repeated generic paragraphs never bridge differently titled parts',()=>{const m=lossless(['1부 여름','그는 말했다.','다음 날이었다.'],['1부 겨울','전혀 다른 내용.','그는 말했다.']);assert(m.scenes.some(s=>s.partStatus==='deleted'));assert(m.scenes.some(s=>s.partStatus==='added'))});
test('rewritten part with preserved heading can contain additions/deletions without losing either manuscript',()=>{const m=lossless(a,['1부 숲','달 표면에 우주선이 착륙했다.','','지구와의 통신이 끊겼다.',...a.slice(4)]);assert(m.scenes.some(s=>s.partTitle==='1부 숲'&&s.partStatus==='matched'))});
test('title-free unrelated scenes are not force-paired',()=>{const m=lossless(['같은 시작','','사과 배 귤 수박','','같은 끝'],['같은 시작','','증기기관차 철로 신호등','','같은 끝']);assert(m.scenes.some(s=>s.old.includes('사과 배 귤 수박')&&!s.new.length));assert(m.scenes.some(s=>s.new.includes('증기기관차 철로 신호등')&&!s.old.length))});
test('large rewrite and added paragraphs preserve all text without quadratic positional guesses',()=>{const old=['1부 과거',...Array.from({length:450},(_,i)=>'오래된 기록 '+i)];const rev=['1부 과거',...Array.from({length:500},(_,i)=>'새로운 이야기 '+i)];lossless(old,rev)});
test('legacy saved comparison fingerprints and choices remain restorable',async()=>{const worker=new Worker(new URL('./worker-adapter.js',import.meta.url));let id=0;const call=(type,payload)=>new Promise((resolve,reject)=>{worker.once('message',r=>r.error?reject(Error(r.error)):resolve(r.result));worker.postMessage({id:++id,type,payload})});try{const old=doc(a),revised=doc(a.slice(4)),fingerprint=createHash('sha256').update(JSON.stringify([2,old.paragraphs,revised.paragraphs])).digest('hex');const restored=await call('restore',{snapshot:{fingerprint,documents:{original:old,revised}}});assert.equal(restored.fingerprint,fingerprint);assert.equal(restored.algorithmVersion,1);const edited=await call('edit',{fingerprint,choices:{},text:revised.paragraphs.join('\n')+'\n추가'});assert.equal(edited.comparison.algorithmVersion,3);const snapshot=await call('snapshot',{});assert.equal((await call('restore',{snapshot})).fingerprint,edited.comparison.fingerprint)}finally{await worker.terminate()}});
import {validateChoices} from '../src/core/compare.js';
import {selectedFormats} from '../src/core/formatting.js';
const moves=m=>m.scenes.flatMap(s=>s.segments).filter(g=>g.move);
test('moved paragraph links both positions and either choice keeps exactly one copy',()=>{
 const a=['1부 여름','사과를 한 입 베어 물었다.','창문 밖에는 비가 내렸다.','멀리 기적이 울렸다.'],b=[a[0],a[2],a[3],a[1],'그는 우산을 폈다.'];const m=lossless(a,b),linked=moves(m);assert.equal(linked.length,2);assert.deepEqual(m.scenes[0].paragraphCounts,{old:3,new:4});
 for(const g of linked)for(const value of ['old','new']){const c=validateChoices(m,{[g.id]:value});assert.equal(c[g.move.peerId],value);assert.equal(selectedParagraphs(m,c).filter(p=>p===a[1]).length,1)}
 assert.throws(()=>validateChoices(m,{[linked[0].id]:'old',[linked[1].id]:'new'}));
 const c={[linked[0].id]:'new'};const docs={original:{formatting:a.map(text=>({runs:[{text,style:{bold:true}}]}))},revised:{formatting:b.map(text=>({runs:[{text,style:{italic:true}}]}))}};
 const output=selectedParagraphs(m,c),formats=selectedFormats(m,c,docs);assert.equal(formats.length,output.length);assert.equal(formats[output.indexOf(a[1])].runs[0].style.italic,true);
});
test('moves across scenes in one part are linked but repeated prose and cross-part moves are not',()=>{
 const a=['1부 여름','이동하는 고유 문단.','','여기에 남는 문단.','2부 겨울','다른 부의 문단.'];const b=['1부 여름','','여기에 남는 문단.','이동하는 고유 문단.','2부 겨울','다른 부의 문단.'];assert.equal(moves(lossless(a,b)).length,2);
 const c=['1부 여름','','여기에 남는 문단.','2부 겨울','다른 부의 문단.','이동하는 고유 문단.'];assert.equal(moves(lossless(a,c)).length,0);
 assert.equal(moves(lossless(['1부','반복','유일','반복'],['1부','유일','반복','반복'])).filter(g=>g.move.from===2||g.move.from===4).length,0);
});
test('paragraph move permutations and insertions preserve every source paragraph',()=>{for(let n=0;n<30;n++){const a=['1부',...Array.from({length:12},(_,i)=>'고유 문단 '+i)];const b=[a[0],...a.slice(1+n%10),...a.slice(1,1+n%10),'새 문단'];lossless(a,b)}});
test('version two snapshots keep their original comparison identifiers',async()=>{const worker=new Worker(new URL('./worker-adapter.js',import.meta.url));const call=(type,payload)=>new Promise((resolve,reject)=>{worker.once('message',r=>r.error?reject(Error(r.error)):resolve(r.result));worker.postMessage({id:1,type,payload})});try{const original=doc(['1부','하나','둘','셋']),revised=doc(['1부','둘','셋','하나']);const fingerprint=createHash('sha256').update(JSON.stringify([4,original.paragraphs,revised.paragraphs,undefined,undefined])).digest('hex');const result=await call('restore',{snapshot:{algorithmVersion:2,fingerprint,documents:{original,revised}}});assert.equal(result.algorithmVersion,2);assert.equal(moves(result).length,0);assert.equal(result.fingerprint,fingerprint)}finally{await worker.terminate()}});
