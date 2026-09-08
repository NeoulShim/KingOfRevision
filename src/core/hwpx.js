import {hwpxStyles,hwpxWriter} from './hwpx-formatting.js';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import template from './template.json' with { type: 'json' };

export const LIMITS = Object.freeze({ file: 30*1024*1024, xml: 12*1024*1024, totalXml: 36*1024*1024, entries: 4096, paragraphs: 40000, text: 1000000, depth: 180 });
const parser = new XMLParser({preserveOrder:true,ignoreAttributes:false,removeNSPrefix:true,attributeNamePrefix:'',trimValues:false,parseTagValue:false,parseAttributeValue:false,processEntities:true,ignoreDeclaration:true});
const nameOf = node => Object.keys(node).find(k=>k!==':@'&&k!=='#text');
function parseXML(xml, label){
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error(label+': 외부 개체를 포함한 XML은 지원하지 않습니다.');
  if(XMLValidator.validate(xml)!==true)throw Error(label+': 문서 내부 XML이 손상되어 있습니다.');
  return parser.parse(xml);
}
function findNodes(nodes,wanted,result=[],depth=0){
  if(depth>LIMITS.depth)throw Error('문서 구조가 너무 깊어 처리할 수 없습니다.');
  for(const node of nodes){const name=nameOf(node);if(name===wanted)result.push(node);if(name&&Array.isArray(node[name]))findNodes(node[name],wanted,result,depth+1)}return result;
}
function resolveSection(href, entries){
  if(typeof href!=='string'||/^[a-z]+:|^\/|\\|(?:^|\/)\.\.(?:\/|$)/i.test(href))return null;
  let decoded;try{decoded=decodeURIComponent(href)}catch{return null}
  if(/(?:^|\/)\.\.(?:\/|$)/.test(decoded))return null;
  const clean=decoded.replace(/^\.\//,'');return entries[clean]?clean:entries['Contents/'+clean]?'Contents/'+clean:null;
}
export function readHwpx(input, filename='원고.hwpx'){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(!/\.hwpx$/i.test(filename))throw Error('HWPX 파일을 선택해 주세요. .hwp 파일은 한글에서 HWPX로 저장한 뒤 사용할 수 있습니다.');
  if(bytes.length>LIMITS.file)throw Error('파일 하나당 30 MB까지 읽을 수 있습니다.');
  if(bytes[0]!==0x50||bytes[1]!==0x4b)throw Error('HWPX 형식이 아닙니다. 확장자만 바꾼 HWP 파일은 읽을 수 없습니다.');
  let count=0,total=0,files;
  try{files=unzipSync(bytes,{filter:f=>{
    if(++count>LIMITS.entries)throw Error('문서 안의 파일 수가 너무 많습니다.');
    if(/(?:^|\/)\.\.(?:\/|$)|\\|^\//.test(f.name))throw Error('문서 안의 경로가 올바르지 않습니다.');
    const wanted=f.name==='mimetype'||/^Contents\/(?:content\.hpf|header\.xml|section\d+\.xml)$/.test(f.name)||/^META-INF\/.*\.xml$/.test(f.name);
    if(wanted){if(f.originalSize>LIMITS.xml)throw Error('본문 XML 하나의 크기가 12 MB를 넘습니다.');total+=f.originalSize;if(total>LIMITS.totalXml)throw Error('본문 XML의 전체 크기가 너무 큽니다.')}return wanted;
  }})}catch(e){throw Error('파일을 읽지 못했습니다. '+(e.message||'손상되었거나 암호화된 HWPX인지 확인해 주세요.'))}
  if(!files.mimetype||strFromU8(files.mimetype).trim()!=='application/hwp+zip')throw Error('올바른 HWPX 문서가 아닙니다.');
  for(const [name,content] of Object.entries(files))if(name.startsWith('META-INF/')&&/EncryptionData|encrypted-key|algorithm-name|CipherData/i.test(strFromU8(content)))throw Error('암호화된 HWPX는 읽을 수 없습니다. 한글에서 암호 없이 저장한 파일을 선택해 주세요.');
  const names=Object.keys(files).filter(n=>/^Contents\/section\d+\.xml$/.test(n)).sort((a,b)=>Number(a.match(/section(\d+)/)[1])-Number(b.match(/section(\d+)/)[1]));
  if(!names.length)throw Error('HWPX의 본문 구역을 찾지 못했습니다.');
  let ordered=names;const warnings=[];
  if(files['Contents/content.hpf']){
    const manifest=parseXML(strFromU8(files['Contents/content.hpf']),'문서 목록');
    const items=new Map(findNodes(manifest,'item').map(n=>[n[':@']?.id,n[':@']?.href]));
    const declared=findNodes(manifest,'itemref').map(n=>items.get(n[':@']?.idref)).filter(h=>typeof h==='string'&&/section\d+\.xml$/.test(h));
    if(declared.length){ordered=declared.map(h=>resolveSection(h,files));if(ordered.some(n=>!n))throw Error('문서 목록에 기록된 본문 구역이 누락되었습니다.');if(new Set(ordered).size!==ordered.length)throw Error('문서 구역 목록이 중복되어 있습니다.');const extras=names.filter(n=>!ordered.includes(n));if(extras.length)warnings.push('문서 목록에서 참조하지 않는 구역 파일은 제외했습니다.');}
  }else warnings.push('문서 목록이 없어 구역 번호 순서로 읽었습니다.');
  const blocks=[],features=new Set();let chars=0;
  const styles=hwpxStyles(files['Contents/header.xml']?parseXML(strFromU8(files['Contents/header.xml']),'서식'):[]);
  function push(text,kind,section,formatting){chars+=text.length;if(chars>LIMITS.text||blocks.length>=LIMITS.paragraphs)throw Error('본문은 100만 자, 4만 문단까지 비교할 수 있습니다.');blocks.push({text,kind,section,formatting})}
  function visit(nodes,context,depth=0){
    if(depth>LIMITS.depth)throw Error('문서 구조가 너무 깊어 처리할 수 없습니다.');
    for(const node of nodes){const name=nameOf(node);if(!name)continue;const children=Array.isArray(node[name])?node[name]:[];
      if(name==='p'){readParagraph(children,context,depth+1,node[':@']);continue}
      if(name==='pic'||name==='ole'||name==='equation'){features.add('image');continue}
      if(['linesegarray','secPr','trackChange','trackChangeBegin','trackChangeEnd','shapeComment'].includes(name))continue;
      const kind=name==='tbl'?'table':['footNote','endNote'].includes(name)?'note':['header','footer'].includes(name)?'header':context.kind;
      if(kind!=='body')features.add(kind);visit(children,{...context,kind},depth+1);
    }
  }
  function textContent(nodes){let value='';for(const node of nodes){if('#text' in node){value+=String(node['#text']);continue}const name=nameOf(node);if(name==='tab')value+='\t';else if(name==='lineBreak')value+='\n';else if(['nbSpace','fwSpace'].includes(name))value+=name==='nbSpace'?'\u00a0':'\u3000';else if(name&&Array.isArray(node[name]))value+=textContent(node[name]);}return value}
  function readParagraph(nodes,context,depth,attributes={}){let text='',nested=false,runs=[];const paragraph=styles.paragraph(attributes.paraPrIDRef);
    const append=(value,style)=>{text+=value;runs.push({text:value,style})};
    const flush=()=>{if(text!==''){push(text,context.kind,context.section,{paragraph,runs});text='';runs=[]}};
    function walk(list,d,style={}){if(d>LIMITS.depth)throw Error('문서 구조가 너무 깊어 처리할 수 없습니다.');for(const n of list){const name=nameOf(n);if(!name)continue;const children=Array.isArray(n[name])?n[name]:[];
      if(name==='run'){walk(children,d+1,styles.char(n[':@']?.charPrIDRef));continue}
      if(name==='t')append(textContent(children),style);
      else if(name==='lineBreak')append('\n',style);else if(name==='tab')append('\t',style);
      else if(['secPr','linesegarray','shapeComment','trackChange','trackChangeBegin','trackChangeEnd'].includes(name))continue;
      else if(['pic','ole','equation'].includes(name)){features.add('image');}
      else if(name==='p'||['tbl','drawText','footNote','endNote','header','footer'].includes(name)){flush();nested=true;const kind=name==='tbl'?'table':['footNote','endNote'].includes(name)?'note':['header','footer'].includes(name)?'header':name==='drawText'?'textbox':context.kind;if(kind!=='body')features.add(kind);visit([n],{...context,kind},d+1);}
      else walk(children,d+1,style);
    }}walk(nodes,depth);if(text!==''||!nested)push(text,context.kind,context.section,{paragraph,runs});
  }
  ordered.forEach((file,section)=>{const xml=parseXML(strFromU8(files[file]),'구역 '+(section+1));if(!findNodes(xml,'sec').length)throw Error('HWPX 구역 형식이 올바르지 않습니다.');visit(xml,{kind:'body',section})});
  if(features.has('image'))warnings.push('이미지·OLE·수식의 모양은 비교·저장하지 않습니다.');
  if([...features].some(f=>f!=='image'))warnings.push('표·글상자·주석의 글자는 읽는 순서대로 펼쳤습니다. 원본 배치는 저장본에 유지되지 않습니다.');
  return {name:filename,paragraphs:blocks.map(b=>b.text),blocks,formatting:blocks.map(b=>b.formatting),characters:chars,sections:ordered.length,warnings};
}

const xmlEscape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
function runText(text){return xmlEscape(text).replace(/\t/g,'<hp:tab width="4000" leader="0" type="1"/>').replace(/\r\n|\r|\n/g,'<hp:lineBreak/>')}
export function writeHwpx(paragraphs,{title='선택한 원고',formatting=[]}={}){
  if(!Array.isArray(paragraphs)||paragraphs.some(p=>typeof p!=='string'))throw Error('저장할 문단 형식이 올바르지 않습니다.');
  if(paragraphs.join('\n').length>LIMITS.text||paragraphs.length>LIMITS.paragraphs)throw Error('저장할 원고의 크기가 제한을 넘습니다.');
  const files={};for(const [name,content] of Object.entries(template))files[name]=strToU8(content);
  const section=template['Contents/section0.xml'];
  const head=section.slice(0,section.indexOf('<hp:p '));
  const secPr=section.match(/<hp:secPr\b[\s\S]*?<\/hp:secPr>/)?.[0];
  const colPr=section.match(/<hp:ctrl><hp:colPr\b[\s\S]*?<\/hp:ctrl>/)?.[0]||'';
  if(!secPr)throw Error('HWPX 저장 서식이 손상되었습니다.');
  const rich=hwpxWriter(template['Contents/header.xml']);
  const paragraphsXML=(paragraphs.length?paragraphs:['']).map((p,i)=>{const f=rich.paragraph(p,formatting[i]);return `<hp:p id="${i}" paraPrIDRef="${f.id}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${i===0?`<hp:run charPrIDRef="0">${secPr}${colPr}</hp:run>`:''}${f.runs.map(r=>`<hp:run charPrIDRef="${r.id}"><hp:t>${runText(r.text)}</hp:t></hp:run>`).join('')}</hp:p>`}).join('');
  files['Contents/header.xml']=strToU8(rich.header());
  files['Contents/section0.xml']=strToU8(head+paragraphsXML+'</hs:sec>');
  const date=new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
  let manifest=template['Contents/content.hpf'].replace(/<opf:metadata>[\s\S]*?<\/opf:metadata>/,`<opf:metadata><opf:title>${xmlEscape(title)}</opf:title><opf:language>ko</opf:language><opf:meta name="creator" content="text"></opf:meta><opf:meta name="lastsaveby" content="text">퇴고의 제왕</opf:meta><opf:meta name="CreatedDate" content="text">${date}</opf:meta><opf:meta name="ModifiedDate" content="text">${date}</opf:meta></opf:metadata>`);
  files['Contents/content.hpf']=strToU8(manifest);
  files['Preview/PrvText.txt']=strToU8(paragraphs.join('\r\n'));
  const ordered={'mimetype':[strToU8('application/hwp+zip'),{level:0}]};for(const [n,b] of Object.entries(files))if(n!=='mimetype')ordered[n]=[b,{level:6}];
  return zipSync(ordered);
}
