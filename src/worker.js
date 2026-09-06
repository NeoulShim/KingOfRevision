import { readDocument, writeDocument, outputFormat } from './core/document.js';
import { compareDocuments, selectedParagraphs, validateChoices } from './core/compare.js';
let current=null;
self.onmessage=async({data})=>{
  const {id,type,payload}=data;
  try{
    if(type==='compare'){
      const original=readDocument(payload.old.buffer,payload.old.name),revised=readDocument(payload.new.buffer,payload.new.name);
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([2,original.paragraphs,revised.paragraphs])));
      current=compareDocuments(original,revised);current.outputFormat=outputFormat(original.format,revised.format);current.fingerprint=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
      self.postMessage({id,result:current});
    }else if(type==='export'){
      if(!current)throw Error('먼저 두 원고를 비교해 주세요.');
      const choices=validateChoices(current,payload.choices),paragraphs=selectedParagraphs(current,choices);
      const format=payload.format==='txt'?'txt':current.outputFormat;
      const bytes=writeDocument(paragraphs,format,{title:payload.title});
      self.postMessage({id,result:{buffer:bytes.buffer,paragraphs:paragraphs.length,characters:paragraphs.join('\n').length}},[bytes.buffer]);
    }else throw Error('지원하지 않는 작업입니다.');
  }catch(error){self.postMessage({id,error:error.message||'원고를 처리하지 못했습니다.'})}
};
