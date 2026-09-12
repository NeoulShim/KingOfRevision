import CFB from 'cfb';
import {Inflate,deflateSync} from 'fflate';
import template from './hwp-template.json' with {type:'json'};

const MAX_FILE=30*1024*1024,MAX_STREAM=36*1024*1024,MAX_TEXT=1000000,MAX_PARAS=40000;
const utf16=new TextDecoder('utf-16le',{fatal:true});
const binary=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
const signature=[208,207,17,224,161,177,26,225];
function concat(arr){const out=new Uint8Array(arr.reduce((n,b)=>n+b.length,0));let p=0;for(const b of arr){out.set(b,p);p+=b.length}return out}
function inflateBounded(input){
  const chunks=[];let size=0;const inflator=new Inflate(chunk=>{size+=chunk.length;if(size>MAX_STREAM)throw Error('압축을 푼 HWP 본문이 너무 큽니다.');chunks.push(chunk)});
  for(let i=0;i<input.length;i+=1024)inflator.push(input.subarray(i,i+1024),i+1024>=input.length);
  return concat(chunks);
}
export function* hwpRecords(bytes){
  let pos=0,count=0;
  while(pos<bytes.length){
    if(bytes.length-pos<4||++count>500000)throw Error('HWP 레코드 구조가 손상되었습니다.');
    const h=view(bytes).getUint32(pos,true);pos+=4;const tag=h&1023,level=(h>>>10)&1023;let size=h>>>20;
    if(size===4095){if(pos+4>bytes.length)throw Error('HWP 레코드 길이가 잘못되었습니다.');size=view(bytes).getUint32(pos,true);pos+=4}
    if(size>MAX_STREAM||pos+size>bytes.length||level>180)throw Error('HWP 레코드 범위가 올바르지 않습니다.');
    yield {tag,level,data:bytes.subarray(pos,pos+size)};pos+=size;
  }
}
function textFromRecord(bytes){
  if(bytes.length%2)throw Error('HWP 본문의 문자 데이터가 손상되었습니다.');
  const v=view(bytes),parts=[];let from=0,pos=0;
  while(pos<bytes.length){const c=v.getUint16(pos,true);if(c>=32){pos+=2;continue}
    if(pos>from)parts.push(utf16.decode(bytes.subarray(from,pos)));
    if(c===9)parts.push('\t');else if(c===10)parts.push('\n');else if(c===24)parts.push('-');else if(c===30)parts.push('\u00a0');else if(c===31)parts.push('\u3000');
    const wide=(c>=1&&c<=9)||(c>=11&&c<=12)||(c>=14&&c<=23);pos+=wide?16:2;
    if(pos>bytes.length)throw Error('HWP 제어문자 데이터가 손상되었습니다.');from=pos;
  }
  if(pos>from)parts.push(utf16.decode(bytes.subarray(from,pos)));return parts.join('');
}
export function readHwp(input,filename='원고.hwp'){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(!/\.hwp$/i.test(filename))throw Error('HWP 파일을 선택해 주세요.');
  if(bytes.length>MAX_FILE)throw Error('파일 하나당 30 MB까지 읽을 수 있습니다.');
  if(!signature.every((v,i)=>bytes[i]===v))throw Error('HWP 5 형식이 아닙니다. 오래된 HWP 3 문서는 한글에서 다시 저장해 주세요.');
  let container;try{container=CFB.read(bytes,{type:'array'})}catch{throw Error('HWP 문서 구조를 읽지 못했습니다. 손상된 파일인지 확인해 주세요.')}
  if(container.FileIndex.length>4096)throw Error('문서 안의 항목이 너무 많습니다.');
  const get=name=>{const entry=CFB.find(container,name);if(!entry||entry.type!==2)throw Error('HWP의 '+name+' 정보가 없습니다.');return Uint8Array.from(entry.content)};
  const header=get('FileHeader');
  if(header.length<40||new TextDecoder().decode(header.subarray(0,17))!=='HWP Document File'||header[35]!==5)throw Error('HWP 5 문서만 지원합니다. 한글에서 다시 저장해 주세요.');
  const flags=view(header).getUint32(36,true);
  if(flags&2)throw Error('암호가 걸린 HWP는 지원하지 않습니다. 암호 없이 저장한 사본을 선택해 주세요.');
  if(flags&(4|16|256))throw Error('배포용·DRM 보호 HWP는 지원하지 않습니다. 편집 가능한 사본을 선택해 주세요.');
  const sections=container.FullPaths.filter(p=>/\/BodyText\/Section\d+$/.test(p)).sort((a,b)=>Number(a.match(/Section(\d+)$/)[1])-Number(b.match(/Section(\d+)$/)[1]));
  if(!sections.length)throw Error('HWP 본문 구역을 찾지 못했습니다.');
  const blocks=[],warnings=[];let characters=0,total=0,nested=false,objects=false;
  for(let section=0;section<sections.length;section++){
    const raw=get(sections[section]),body=flags&1?inflateBounded(raw):raw;total+=body.length;if(total>MAX_STREAM)throw Error('HWP 본문의 전체 크기가 너무 큽니다.');
    const stack=new Map();
    for(const {tag,level,data} of hwpRecords(body)){
      if(tag===66){
        if(data.length<12)throw Error('HWP 문단 헤더가 손상되었습니다.');
        if(blocks.length>=MAX_PARAS)throw Error('본문은 4만 문단까지 비교할 수 있습니다.');
        const block={text:'',kind:level?'nested':'body',section};
        // HWP 5, tables 58–59: byte 11, 0x04 is an explicit page break.
        // PARA_LINE_SEG page-start flags are automatic layout, not part boundaries.
        if(level===0&&(data[11]&0x04))block.pageBreakBefore=true;
        blocks.push(block);stack.set(level,block);for(const l of stack.keys())if(l>level)stack.delete(l);if(level)nested=true;
      }
      else if(tag===67){const block=stack.get(level-1);if(!block)throw Error('HWP 문단 연결이 올바르지 않습니다.');const text=textFromRecord(data);characters+=text.length;if(characters>MAX_TEXT)throw Error('본문은 100만 자까지 비교할 수 있습니다.');block.text+=text;}
      else if(tag===71&&data.length>=4){const id=new TextDecoder().decode(data.subarray(0,4));if(!['dces','dloc','onta','onwn','dhgp','tcgp','pngp'].includes(id))objects=true;}
    }
  }
  if(nested||objects)warnings.push('표·글상자·주석은 문서에 기록된 순서로 글자만 펼쳐 읽습니다. 이미지와 원본 배치는 저장본에 유지되지 않습니다.');
  const formatting=blocks.some(b=>b.pageBreakBefore)?blocks.map(b=>({paragraph:b.pageBreakBefore?{pageBreakBefore:true}:{},runs:[{text:b.text,style:{}}]})):undefined;
  return {name:filename,format:'hwp',paragraphs:blocks.map(p=>p.text),blocks,characters,sections:sections.length,warnings,...(formatting?{formatting}:{})};
}
function record(tag,level,data){const ext=data.length>=4095,head=new Uint8Array(ext?8:4);view(head).setUint32(0,(tag|(level<<10)|(Math.min(data.length,4095)<<20))>>>0,true);if(ext)view(head).setUint32(4,data.length,true);return concat([head,data])}
function encodeText(text){
  const codes=[];
  for(let i=0;i<text.length;i++){
    const c=text.charCodeAt(i);
    if(c===9){codes.push(9,4000,0,0,0,0,0,9)}
    else if(c===13){if(text.charCodeAt(i+1)===10)i++;codes.push(10)}
    else if(c===10||c>=32)codes.push(c);
  }
  const out=new Uint8Array(codes.length*2),v=view(out);codes.forEach((c,i)=>v.setUint16(i*2,c,true));return out;
}
export function writeHwp(paragraphs,{formatting=[]}={}){
  if(!Array.isArray(paragraphs)||paragraphs.some(p=>typeof p!=='string'))throw Error('저장할 문단 형식이 올바르지 않습니다.');
  if(paragraphs.join('\n').length>MAX_TEXT||paragraphs.length>MAX_PARAS)throw Error('저장할 원고의 크기가 제한을 넘습니다.');
  const source=paragraphs.length?paragraphs:[''],records=[],prefix=binary(template.prefix);
  source.forEach((text,index)=>{
    const value=concat([index===0?prefix:new Uint8Array(),encodeText(text),new Uint8Array([13,0])]);
    const head=new Uint8Array(24),h=view(head);h.setUint32(0,(value.length/2|(index===source.length-1?0x80000000:0))>>>0,true);h.setUint32(4,index===0?4:0,true);h.setUint16(8,19,true);head[10]=0;head[11]=(index===0?3:0)|(formatting[index]?.paragraph?.pageBreakBefore===true?4:0);h.setUint16(12,1,true);h.setUint16(16,0,true);h.setUint32(18,index+1,true);
    const charShape=new Uint8Array(8);view(charShape).setUint32(4,6,true);
    // Omit layout caches so the editor computes line wrapping and page positions.
    records.push(record(66,0,head),record(67,1,value),record(68,1,charShape));
    if(index===0)for(const c of template.controls)records.push(record(c.tag,c.level,binary(c.data)));
  });
  const container=CFB.utils.cfb_new();
  CFB.utils.cfb_add(container,'FileHeader',binary(template.header));
  CFB.utils.cfb_add(container,'DocInfo',deflateSync(binary(template.docInfo)));
  CFB.utils.cfb_add(container,'BodyText/Section0',deflateSync(concat(records)));
  const preview=source.join('\r\n').slice(0,1024),previewBytes=new Uint8Array(preview.length*2);
  for(let i=0;i<preview.length;i++)view(previewBytes).setUint16(i*2,preview.charCodeAt(i),true);
  CFB.utils.cfb_add(container,'PrvText',previewBytes);
  return Uint8Array.from(CFB.write(container,{type:'array',fileType:'cfb'}));
}
