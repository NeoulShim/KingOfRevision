import {compareDocuments as compareV2} from './core/compare-v2.js';
import {compareDocuments as legacyCompare} from './core/compare-legacy.js';
import {normalizedFormats,editFormats,editFormat,selectedFormats,splitEditorFormat,withoutPageBreak} from './core/formatting.js';
import { readDocument, writeDocument, outputFormat, exportFormats } from './core/document.js';
import { compareDocuments, selectedParagraphs, validateChoices } from './core/compare.js';
import {editorParagraphs,retainChoices} from './core/editing.js';
let current=null,documents=null,tasks=Promise.resolve();
async function comparison(original,revised,algorithmVersion=3){
  for(const d of [original,revised])if(d.formatting)d.formatting=normalizedFormats(d.paragraphs,d.formatting);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(algorithmVersion>=2?[algorithmVersion===3?5:4,original.paragraphs,revised.paragraphs,original.formatting,revised.formatting]:original.formatting||revised.formatting?[3,original.paragraphs,revised.paragraphs,original.formatting,revised.formatting]:[2,original.paragraphs,revised.paragraphs])));
  const result=(algorithmVersion===1?legacyCompare:algorithmVersion===2?compareV2:compareDocuments)(original,revised);result.algorithmVersion=algorithmVersion;for(const scene of result.scenes){scene.oldFormatting=original.formatting?.slice(scene.oldStart,scene.oldStart+scene.old.length);scene.newFormatting=revised.formatting?.slice(scene.newStart,scene.newStart+scene.new.length);}result.outputFormat=outputFormat(original.format,revised.format);result.exportFormats=exportFormats(original.format,revised.format);result.fingerprint=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');return result;
}
self.onmessage=({data})=>{tasks=tasks.then(()=>handle(data))};
async function handle({id,type,payload}){
  try{
    if(type==='compare'){
      const original=readDocument(payload.old.buffer,payload.old.name),revised=readDocument(payload.new.buffer,payload.new.name);
      const result=await comparison(original,revised);documents={original,revised};current=result;self.postMessage({id,result});
    }else if(type==='snapshot'){
      if(!current)throw Error('저장할 비교가 없습니다.');
      self.postMessage({id,result:{fingerprint:current.fingerprint,algorithmVersion:current.algorithmVersion,documents,manuallyEdited:!!current.manuallyEdited}});
    }else if(type==='restore'){
      const snapshot=payload.snapshot;
      const validate=d=>{
        if(!d||!['hwp','hwpx','docx','txt'].includes(d.format)||typeof d.name!=='string'||!Array.isArray(d.paragraphs)||d.paragraphs.length>40000||d.paragraphs.some(p=>typeof p!=='string')||d.paragraphs.join('').length>1000000)throw Error('저장된 원고가 손상되었습니다. 파일을 다시 선택해 주세요.');
        return {name:d.name,format:d.format,paragraphs:d.paragraphs,characters:d.paragraphs.join('').length,warnings:Array.isArray(d.warnings)?d.warnings.filter(v=>typeof v==='string'):[],...(d.formatting?{formatting:normalizedFormats(d.paragraphs,d.formatting)}:{})};
      };
      const original=validate(snapshot?.documents?.original),revised=validate(snapshot?.documents?.revised),result=await comparison(original,revised,[2,3].includes(snapshot.algorithmVersion)?snapshot.algorithmVersion:1);
      if(result.fingerprint!==snapshot.fingerprint)throw Error('저장된 원고와 비교 기록이 맞지 않습니다.');
      result.manuallyEdited=snapshot.manuallyEdited===true;documents={original,revised};current=result;self.postMessage({id,result});
    }else if(type==='edit'||type==='edit-paragraph'){
      if(!current||payload.fingerprint!==current.fingerprint)throw Error('편집 중인 비교가 달라졌습니다. 다시 열어 주세요.');
      const choices=validateChoices(current,payload.choices);let paragraphs,formatting;
      if(type==='edit-paragraph'){
        const n=payload.index;if(!Number.isInteger(n)||n<0||n>=documents.revised.paragraphs.length)throw Error('편집할 문단을 찾지 못했습니다.');
        const inserted=editorParagraphs(payload.text),before=documents.revised.paragraphs[n];paragraphs=[...documents.revised.paragraphs];paragraphs.splice(n,1,...inserted);
        if(paragraphs.length>40000||paragraphs.join('\n').length>1000000)throw Error('본문은 100만 자, 4만 문단까지 편집할 수 있습니다.');
        formatting=normalizedFormats(documents.revised.paragraphs,documents.revised.formatting);if(payload.paragraphFormatting&&payload.paragraphFormatting.runs?.map(r=>r.text).join('')!==payload.text)throw Error('문단의 글과 서식이 맞지 않습니다. 다시 편집해 주세요.');
        formatting.splice(n,1,...(payload.paragraphFormatting?splitEditorFormat(payload.text,payload.paragraphFormatting):inserted.map((p,i)=>{const f=editFormat(before,p,documents.revised.formatting?.[n]);return i?withoutPageBreak(f):f})));
      }else {paragraphs=editorParagraphs(payload.text);const base=payload.mode==='merged'?selectedParagraphs(current,choices):documents.revised.paragraphs,formats=payload.mode==='merged'?selectedFormats(current,choices,documents):documents.revised.formatting;formatting=editFormats(base,paragraphs,formats);}

      const revised={...documents.revised,paragraphs,formatting,characters:paragraphs.join('').length,name:documents.revised.name.replace(/(?:_직접개고)?\.(hwpx?|docx|txt)$/i,'_직접개고.$1')};
      const result=await comparison(documents.original,revised);result.manuallyEdited=true;
      const retained=retainChoices(current,result,choices);documents={...documents,revised};current=result;
      self.postMessage({id,result:{comparison:result,choices:retained}});
    }else if(type==='export-revised'){
      if(!current)throw Error('먼저 두 원고를 비교해 주세요.');
      const {revised}=documents,bytes=writeDocument(revised.paragraphs,revised.format,{title:revised.name,formatting:revised.formatting});
      self.postMessage({id,result:{buffer:bytes.buffer,format:revised.format,name:revised.name}},[bytes.buffer]);
    }else if(type==='export'){
      if(!current)throw Error('먼저 두 원고를 비교해 주세요.');
      const choices=validateChoices(current,payload.choices),paragraphs=selectedParagraphs(current,choices);
      const format=['hwp','hwpx','docx','txt'].includes(payload.format)?payload.format:current.outputFormat;
      if(!current.exportFormats.includes(format))throw Error('DOCX 두 문서를 비교할 때는 DOCX 또는 TXT로 저장해 주세요.');
      const bytes=writeDocument(paragraphs,format,{title:payload.title,formatting:selectedFormats(current,choices,documents)});
      self.postMessage({id,result:{buffer:bytes.buffer,paragraphs:paragraphs.length,characters:paragraphs.join('\n').length}},[bytes.buffer]);
    }else throw Error('지원하지 않는 작업입니다.');
  }catch(error){self.postMessage({id,error:error.message||'원고를 처리하지 못했습니다.'})}
}
