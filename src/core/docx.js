import {unzipSync,zipSync,strToU8} from 'fflate';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
const parser=new XMLParser({preserveOrder:true,ignoreAttributes:false,removeNSPrefix:true,attributeNamePrefix:'',trimValues:false,parseTagValue:false,parseAttributeValue:false,ignoreDeclaration:true});
const key=n=>Object.keys(n).find(k=>k!==':@'&&k!=='#text');
function parse(bytes){
 const xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 if(/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw Error('DOCX 내부 XML이 손상되었거나 지원하지 않는 선언을 포함합니다.');
 let depth=0;for(const m of xml.replace(/<!--[\s\S]*?-->/g,'').matchAll(/<\/?[A-Za-z_][^>]*>/g)){if(m[0].startsWith('</'))depth--;else if(!m[0].endsWith('/>'))depth++;if(depth>180)throw Error('문서 구조가 너무 깊습니다.')}
 return parser.parse(xml);
}
function find(nodes,name,out=[]){for(const n of nodes){const k=key(n);if(k===name)out.push(n);if(k&&Array.isArray(n[k]))find(n[k],name,out)}return out}
export function readDocx(input,name='원고.docx'){
 const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
 if(bytes.length>30*1024*1024)throw Error('파일 하나당 30 MB까지 읽을 수 있습니다.');
 if(bytes[0]!==80||bytes[1]!==75)throw Error('DOCX 형식이 아닙니다. 암호를 해제하고 DOCX로 저장해 주세요.');
 let count=0,total=0,files;
 try{files=unzipSync(bytes,{filter:f=>{if(++count>4096||/(?:^|\/)\.\.(?:\/|$)|\\|^\//.test(f.name))throw Error('문서 내부 파일 구성이 올바르지 않습니다.');const wanted=f.name==='[Content_Types].xml'||f.name==='_rels/.rels'||f.name.endsWith('.xml');if(wanted){total+=f.originalSize;if(f.originalSize>12*1024*1024||total>36*1024*1024)throw Error('DOCX 본문 크기가 너무 큽니다.')}return wanted}})}catch(e){throw Error('DOCX를 읽지 못했습니다. '+e.message)}
 if(!files['_rels/.rels']||!files['[Content_Types].xml'])throw Error('올바른 DOCX 문서가 아닙니다.');
 const rel=find(parse(files['_rels/.rels']),'Relationship').find(n=>n[':@']?.Type?.endsWith('/officeDocument'))?.[':@'];
 let target=rel?.Target?.replace(/^\//,'').replace(/^\.\//,'');
 if(!target||rel.TargetMode==='External'||/(?:^|\/)\.\.(?:\/|$)|\\|:/.test(target)||!files[target])throw Error('DOCX 본문을 찾지 못했습니다.');
 const types=find(parse(files['[Content_Types].xml']),'Override');
 if(!types.some(n=>n[':@']?.PartName==='/'+target&&n[':@']?.ContentType==='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'))throw Error('일반 DOCX 문서만 지원합니다. DOCX로 다시 저장해 주세요.');
 const tree=parse(files[target]),body=find(tree,'body')[0]?.body;if(!body)throw Error('DOCX 본문이 없습니다.');
 if(['ins','del','moveFrom','moveTo','pPrChange','rPrChange','tblPrChange','trPrChange','tcPrChange','numberingChange','sectPrChange','cellIns','cellDel','cellMerge'].some(k=>find(body,k).length))throw Error('DOCX에 미확정 변경 내용 추적이 있습니다. 변경을 수락 또는 거절한 사본으로 비교해 주세요.');
 if(find(body,'altChunk').length)throw Error('외부 삽입 본문이 있는 DOCX입니다. Word에서 일반 본문으로 정리한 사본을 사용해 주세요.');
 const paragraphs=[];let chars=0;
 function push(text){chars+=text.length;if(chars>1000000||paragraphs.length>=40000)throw Error('본문은 100만 자, 4만 문단까지 비교할 수 있습니다.');paragraphs.push(text)}
 const skip=new Set(['pPr','rPr','drawing','pict','object','sectPr']);
 function text(nodes){let s='';for(const n of nodes){const k=key(n);if(skip.has(k))continue;if(k==='t')s+=n[k].map(v=>String(v['#text']??'')).join('');else if(k==='tab')s+='\t';else if(k==='br'||k==='cr')s+='\n';else if(k==='noBreakHyphen')s+='\u2011';else if(k==='softHyphen')s+='\u00ad';else if(k==='AlternateContent'){const choice=n[k].find(c=>key(c)==='Choice')||n[k].find(c=>key(c)==='Fallback');if(choice)s+=text(choice[key(choice)])}else if(k&&Array.isArray(n[k]))s+=text(n[k]);}return s}
 function walk(nodes){for(const n of nodes){const k=key(n);if(skip.has(k))continue;if(k==='p')push(text(n[k]));else if(k==='AlternateContent'){const choice=n[k].find(c=>key(c)==='Choice')||n[k].find(c=>key(c)==='Fallback');if(choice)walk(choice[key(choice)])}else if(k&&Array.isArray(n[k]))walk(n[k]);}}
 walk(body);
 const warnings=['DOCX는 본문과 표 안의 문단을 순서대로 읽습니다. 머리말·꼬리말·각주·미주·글상자·이미지·자동 목록 번호와 원본 서식은 포함하지 않습니다.'];
 return {name,format:'docx',paragraphs:paragraphs.length?paragraphs:[''],characters:chars,warnings};
}
const escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function writeDocx(paragraphs){
 if(!Array.isArray(paragraphs)||paragraphs.some(p=>typeof p!=='string'))throw Error('저장할 문단 형식이 올바르지 않습니다.');
 if(paragraphs.length>40000||paragraphs.join('\n').length>1000000)throw Error('본문은 100만 자, 4만 문단까지 저장할 수 있습니다.');
 if(paragraphs.some(p=>/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(p)))throw Error('DOCX로 저장할 수 없는 제어문자가 있습니다.');
 const content=(paragraphs.length?paragraphs:['']).map(p=>'<w:p><w:pPr><w:spacing w:after="0" w:line="320" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="맑은 고딕"/><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">'+escape(p).replace(/\t/g,'</w:t><w:tab/><w:t xml:space="preserve">').replace(/\r\n?|\n/g,'</w:t><w:br/><w:t xml:space="preserve">')+'</w:t></w:r></w:p>').join('');
 return zipSync({
 '[Content_Types].xml':strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
 '_rels/.rels':strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
 'word/document.xml':strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+content+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>')
 },{level:6});
}
