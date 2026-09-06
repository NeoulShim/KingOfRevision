import { readDocument, writeDocument, outputFormat } from './core/document.js';
import { compareDocuments, selectedParagraphs, validateChoices } from './core/compare.js';
import {editorParagraphs,retainChoices} from './core/editing.js';
let current=null,documents=null,tasks=Promise.resolve();
async function comparison(original,revised){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([2,original.paragraphs,revised.paragraphs])));
  const result=compareDocuments(original,revised);result.outputFormat=outputFormat(original.format,revised.format);result.fingerprint=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');return result;
}
self.onmessage=({data})=>{tasks=tasks.then(()=>handle(data))};
async function handle({id,type,payload}){
  try{
    if(type==='compare'){
      const original=readDocument(payload.old.buffer,payload.old.name),revised=readDocument(payload.new.buffer,payload.new.name);
      const result=await comparison(original,revised);documents={original,revised};current=result;self.postMessage({id,result});
    }else if(type==='snapshot'){
      if(!current)throw Error('저장할 비교가 없습니다.');
      self.postMessage({id,result:{fingerprint:current.fingerprint,documents,manuallyEdited:!!current.manuallyEdited}});
    }else if(type==='restore'){
      const snapshot=payload.snapshot;
      const validate=d=>{
        if(!d||!['hwp','hwpx'].includes(d.format)||typeof d.name!=='string'||!Array.isArray(d.paragraphs)||d.paragraphs.length>40000||d.paragraphs.some(p=>typeof p!=='string')||d.paragraphs.join('').length>1000000)throw Error('저장된 원고가 손상되었습니다. 파일을 다시 선택해 주세요.');
        return {name:d.name,format:d.format,paragraphs:d.paragraphs,characters:d.paragraphs.join('').length,warnings:Array.isArray(d.warnings)?d.warnings.filter(v=>typeof v==='string'):[]};
      };
      const original=validate(snapshot?.documents?.original),revised=validate(snapshot?.documents?.revised),result=await comparison(original,revised);
      if(result.fingerprint!==snapshot.fingerprint)throw Error('저장된 원고와 비교 기록이 맞지 않습니다.');
      result.manuallyEdited=snapshot.manuallyEdited===true;documents={original,revised};current=result;self.postMessage({id,result});
    }else if(type==='edit'){
      if(!current||payload.fingerprint!==current.fingerprint)throw Error('편집 중인 비교가 달라졌습니다. 다시 열어 주세요.');
      const choices=validateChoices(current,payload.choices),paragraphs=editorParagraphs(payload.text);
      const revised={...documents.revised,paragraphs,characters:paragraphs.join('').length,name:documents.revised.name.replace(/(?:_직접개고)?\.(hwpx?)$/i,'_직접개고.$1')};
      const result=await comparison(documents.original,revised);result.manuallyEdited=true;
      const retained=retainChoices(current,result,choices);documents={...documents,revised};current=result;
      self.postMessage({id,result:{comparison:result,choices:retained}});
    }else if(type==='export-revised'){
      if(!current)throw Error('먼저 두 원고를 비교해 주세요.');
      const {revised}=documents,bytes=writeDocument(revised.paragraphs,revised.format,{title:revised.name});
      self.postMessage({id,result:{buffer:bytes.buffer,format:revised.format,name:revised.name}},[bytes.buffer]);
    }else if(type==='export'){
      if(!current)throw Error('먼저 두 원고를 비교해 주세요.');
      const choices=validateChoices(current,payload.choices),paragraphs=selectedParagraphs(current,choices);
      const format=payload.format==='txt'?'txt':current.outputFormat;
      const bytes=writeDocument(paragraphs,format,{title:payload.title});
      self.postMessage({id,result:{buffer:bytes.buffer,paragraphs:paragraphs.length,characters:paragraphs.join('\n').length}},[bytes.buffer]);
    }else throw Error('지원하지 않는 작업입니다.');
  }catch(error){self.postMessage({id,error:error.message||'원고를 처리하지 못했습니다.'})}
}
