import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {editorText,editorParagraphs,retainChoices} from '../src/core/editing.js';
import {compareDocuments,selectedParagraphs} from '../src/core/compare.js';
import {writeDocument,readDocument} from '../src/core/document.js';
const doc=paragraphs=>({name:'원고.hwpx',paragraphs,characters:paragraphs.join('').length,warnings:[]});
const adopt=m=>Object.fromEntries(m.scenes.flatMap(s=>s.segments.filter(g=>g.type==='change').map(g=>[g.id,'new'])));
test('editor round-trip preserves soft breaks, paragraphs, blank scenes and Unicode',()=>{
  const p=['제목','','문단 안\n줄바꿈 🙂','다음 문단','',''];assert.deepEqual(editorParagraphs(editorText(p)),p);
  assert.deepEqual(editorParagraphs('첫 문단\r\n\r\n두 번째'),['첫 문단','','두 번째']);
  assert.throws(()=>editorParagraphs('x'.repeat(1000001)),/100만/);assert.throws(()=>editorParagraphs('\n'.repeat(40000)),/4만/);
});
test('unchanged decisions survive new scene numbers while newly edited paragraphs stay pending',()=>{
  const a=['제목','','오래된 첫 문장','','오래된 두 번째 문장'],b=['제목','','수정한 첫 문장','','수정한 두 번째 문장'];
  const before=compareDocuments(doc(a),doc(b)),old=adopt(before);
  const after=compareDocuments(doc(a),doc(['새 장면','','제목','','수정한 첫 문장','','완전히 새로 쓴 두 번째 문장']));
  const kept=retainChoices(before,after,old);
  const retained=after.scenes.flatMap(s=>s.segments.filter(g=>kept[g.id]).map(g=>s.new.slice(...g.b).join('')));
  assert.deepEqual(retained,['수정한 첫 문장']);assert.deepEqual(selectedParagraphs(after,adopt(after)),['새 장면','','제목','','수정한 첫 문장','','완전히 새로 쓴 두 번째 문장']);
});
test('worker updates revised text, exports it, remerges it and retains original in both formats',async()=>{
  const worker=new Worker(new URL('./worker-adapter.js',import.meta.url));let id=0;
  const call=(type,payload)=>new Promise((resolve,reject)=>{const n=++id;worker.once('message',r=>r.error?reject(Error(r.error)):resolve(r.result));worker.postMessage({id:n,type,payload})});
  try{
    for(const format of ['hwp','hwpx']){
      const a=['제목','','원문 첫 문장','원문 둘째 문장'],b=['제목','','개고 첫 문장','개고 둘째 문장'];
      let model=await call('compare',{old:{name:'원문.'+format,buffer:writeDocument(a,format).buffer},new:{name:'개고.'+format,buffer:writeDocument(b,format).buffer}});
      const edited=['제목','','직접 쓴 첫 문장\n문단 안 줄바꿈','개고 둘째 문장','','새 장면 🙂'];
      const result=await call('edit',{fingerprint:model.fingerprint,choices:adopt(model),text:editorText(edited)});model=result.comparison;
      assert.equal(model.manuallyEdited,true);assert.deepEqual(selectedParagraphs(model,{}),a);assert.deepEqual(selectedParagraphs(model,adopt(model)),edited);
      let raw=await call('export-revised',{});assert.equal(raw.name,'개고_직접개고.'+format);assert.deepEqual(readDocument(raw.buffer,raw.name).paragraphs,edited);
      const merged=await call('export',{choices:adopt(model),format:'document',title:'합친 원고'});assert.deepEqual(readDocument(merged.buffer,'합친 원고.'+format).paragraphs,edited);
      await assert.rejects(call('edit',{fingerprint:model.fingerprint,choices:{},text:'x'.repeat(1000001)}),/100만/);
      raw=await call('export-revised',{});assert.deepEqual(readDocument(raw.buffer,raw.name).paragraphs,edited);
      await assert.rejects(call('edit',{fingerprint:'outdated',choices:{},text:'다른 글'}),/달라졌습니다/);
      const again=await call('edit',{fingerprint:model.fingerprint,choices:adopt(model),text:editorText([...edited,'두 번째 직접 수정'])});
      assert.equal(again.comparison.revised.name,'개고_직접개고.'+format);assert.deepEqual(selectedParagraphs(again.comparison,{}),a);
    }
  }finally{await worker.terminate()}
});
