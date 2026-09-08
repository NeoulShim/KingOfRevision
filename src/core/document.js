import {readDocx,writeDocx} from './docx.js';
import {readTxt,writeTxt} from './plain-text.js';
import {readHwp,writeHwp} from './hwp.js';
import {readHwpx,writeHwpx} from './hwpx.js';
export function readDocument(bytes,name){
  if(/\.hwpx$/i.test(name))return {...readHwpx(bytes,name),format:'hwpx'};
  if(/\.hwp$/i.test(name))return readHwp(bytes,name);
  if(/\.docx$/i.test(name))return readDocx(bytes,name);
  if(/\.txt$/i.test(name))return readTxt(bytes,name);
  throw Error('HWP, HWPX, DOCX 또는 TXT 파일을 선택해 주세요.');
}
export function outputFormat(a,b){return a==='hwpx'||b==='hwpx'?'hwpx':a===b?a:(b==='txt'?a:b)}
export function writeDocument(paragraphs,format,options){
  if(format==='hwp')return writeHwp(paragraphs);
  if(format==='hwpx')return writeHwpx(paragraphs,options);
  if(format==='docx')return writeDocx(paragraphs,options);
  if(format==='txt')return writeTxt(paragraphs);
  throw Error('지원하지 않는 저장 형식입니다.');
}

export function exportFormats(a,b){return a==='docx'&&b==='docx'?['docx','txt']:['hwp','hwpx','docx','txt']}
