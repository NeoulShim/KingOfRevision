import {readHwp,writeHwp} from './hwp.js';
import {readHwpx,writeHwpx} from './hwpx.js';
export function readDocument(bytes,name){
  if(/\.hwpx$/i.test(name))return {...readHwpx(bytes,name),format:'hwpx'};
  if(/\.hwp$/i.test(name))return readHwp(bytes,name);
  throw Error('HWP 또는 HWPX 파일을 선택해 주세요.');
}
export function outputFormat(a,b){return a==='hwp'&&b==='hwp'?'hwp':'hwpx'}
export function writeDocument(paragraphs,format,options){
  if(format==='hwp')return writeHwp(paragraphs);
  if(format==='hwpx')return writeHwpx(paragraphs,options);
  if(format==='txt')return new TextEncoder().encode(paragraphs.join('\n'));
  throw Error('지원하지 않는 저장 형식입니다.');
}
