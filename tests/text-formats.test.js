import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {readDocument,writeDocument,outputFormat,exportFormats} from '../src/core/document.js';
import {readDocx,writeDocx} from '../src/core/docx.js';
import {readTxt} from '../src/core/plain-text.js';
import {readFileSync} from 'node:fs';
function fixture(body){const files=unzipSync(writeDocx(['']));files['word/document.xml']=strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'</w:body></w:document>');return zipSync(files)}
test('DOCX round trip preserves exact paragraphs, blank scenes, Korean, emoji, tabs and soft breaks',()=>{
 const p=['  한글 <태그> & "인용" 🙂  ','문단 안\n줄바꿈\t탭','','다음 장면','',''];
 assert.deepEqual(readDocx(writeDocx(p)).paragraphs,p);
 const files=unzipSync(writeDocx(p));assert.ok(files['[Content_Types].xml']);assert.match(strFromU8(files['word/document.xml']),/w:after="0"/);
});
test('DOCX reads split runs, hyperlinks and table paragraphs in order, without duplicating drawing text',()=>{
 const file=fixture('<w:p><w:r><w:t>첫 </w:t></w:r><w:hyperlink><w:r><w:t>문단</w:t><w:tab/><w:br/><w:t>끝</w:t><w:instrText>FIELD</w:instrText></w:r></w:hyperlink><w:r><w:drawing><w:p><w:r><w:t>이미지 속</w:t></w:r></w:p></w:drawing></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>표 1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>표 2</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/>');
 assert.deepEqual(readDocx(file).paragraphs,['첫 문단\t\n끝','표 1','표 2','']);
});
test('DOCX rejects counterfeit containers, unsafe XML, tracked revisions and unsupported inserted content',()=>{
 assert.throws(()=>readDocx(strToU8('문서')),/DOCX/);
 assert.throws(()=>readDocx(zipSync({'word/document.xml':strToU8('<bad/>')})),/DOCX/);
 for(const part of ['<w:del><w:r><w:delText>삭제</w:delText></w:r></w:del>','<w:ins><w:r><w:t>추가</w:t></w:r></w:ins>','<w:altChunk/>'])assert.throws(()=>readDocx(fixture(part)),/사본/);
 assert.throws(()=>readDocx(fixture('<!DOCTYPE foo><w:p/>')),/XML/);
 assert.throws(()=>readDocx(fixture('<w:p>'.repeat(182)+'</w:p>'.repeat(182))),/깊/);
 assert.throws(()=>readDocx(fixture('<w:p><w:r><w:t>'+'가'.repeat(1000001)+'</w:t></w:r></w:p>')),/100만/);
});
test('TXT normalizes CRLF and CR without inserting paragraph gaps and preserves trailing empty paragraphs',()=>{
 assert.deepEqual(readTxt(strToU8('\ufeff첫 문단\r\n둘째\r\n\r\n새 장면\r끝\r\n')).paragraphs,['첫 문단','둘째','','새 장면','끝','']);
 const p=['첫 문단','둘째','','새 장면',''];assert.deepEqual(readDocument(writeDocument(p,'txt'),'원고.txt').paragraphs,p);
 assert.deepEqual([...writeDocument(p,'txt').slice(0,3)],[239,187,191]);
 assert.throws(()=>readTxt(new Uint8Array([0,1,2])),/텍스트/);
 assert.throws(()=>readTxt(strToU8('가'.repeat(1000001))),/100만/);
 assert.throws(()=>readTxt(strToU8('\n'.repeat(40000))),/4만/);
});
test('TXT handles BOM UTF-16LE/BE and Korean CP949 with an explicit decoding notice',()=>{
 const le=Buffer.concat([Buffer.from([255,254]),Buffer.from('한글\n다음','utf16le')]);assert.deepEqual(readTxt(le).paragraphs,['한글','다음']);
 const be=Buffer.from(le);for(let i=0;i<be.length;i+=2){const a=be[i];be[i]=be[i+1];be[i+1]=a;}assert.deepEqual(readTxt(be).paragraphs,['한글','다음']);
 const korean=readTxt(new Uint8Array([0xc7,0xd1,0xb1,0xdb]));assert.deepEqual(korean.paragraphs,['한글']);assert.ok(korean.warnings.length);
});
test('all sixteen input format pairs can compare, restore and export every format',async()=>{
 const worker=new Worker(new URL('./worker-adapter.js',import.meta.url));let id=0;
 const call=(type,payload)=>new Promise((resolve,reject)=>{worker.once('message',r=>r.error?reject(Error(r.error)):resolve(r.result));worker.postMessage({id:++id,type,payload})});
 const formats=['hwp','hwpx','docx','txt'],a=['제목','','원문 문단','둘째 문단'],b=['제목','','개고 문단','둘째 문단'];
 try{for(const old of formats)for(const revised of formats){
   let model=await call('compare',{old:{name:'원문.'+old,buffer:writeDocument(a,old).buffer},new:{name:'개고.'+revised,buffer:writeDocument(b,revised).buffer}});
   assert.equal(model.outputFormat,outputFormat(old,revised));
   const snapshot=await call('snapshot',{});const restored=await call('restore',{snapshot});assert.equal(restored.fingerprint,model.fingerprint);
   const choices=Object.fromEntries(model.scenes.flatMap(s=>s.segments.filter(g=>g.type==='change').map(g=>[g.id,'new'])));
   for(const format of exportFormats(old,revised)){const result=await call('export',{format,choices,title:'원고'});assert.deepEqual(readDocument(result.buffer,'결과.'+format).paragraphs,b)}
   if(old==='docx'&&revised==='docx')for(const format of ['hwp','hwpx'])await assert.rejects(call('export',{format,choices,title:'금지'}),/DOCX 또는 TXT/);
   const updated=await call('edit',{fingerprint:model.fingerprint,choices,text:'직접 편집\n\n새 장면'});
   const raw=await call('export-revised',{});assert.equal(raw.name,'개고_직접개고.'+revised);assert.deepEqual(readDocument(raw.buffer,raw.name).paragraphs,['직접 편집','','새 장면']);
   assert.ok(updated.comparison.manuallyEdited);
 }}finally{await worker.terminate()}
});
test('release notes have real timestamps, newest first, and match the displayed version',()=>{
 const notes=JSON.parse(readFileSync(new URL('../src/patchnotes.json',import.meta.url),'utf8'));let previous=Infinity;
 for(const n of notes){const time=Date.parse(n.time);assert.ok(Number.isFinite(time)&&time<=previous);assert.ok(n.items.length>0);previous=time;}
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));assert.ok(pkg.version.startsWith(notes[0].version+'.'));
});
