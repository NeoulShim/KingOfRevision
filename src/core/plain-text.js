export function readTxt(input,name='원고.txt') {
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes.length>30*1024*1024)throw Error('파일 하나당 30 MB까지 읽을 수 있습니다.');
  let text,encoding='utf-8',warnings=[];
  if(bytes[0]===255&&bytes[1]===254)encoding='utf-16le';
  else if(bytes[0]===254&&bytes[1]===255)encoding='utf-16be';
  try{text=new TextDecoder(encoding,{fatal:true}).decode(bytes)}catch{
    if(encoding!=='utf-8'||(bytes[0]===239&&bytes[1]===187&&bytes[2]===191))throw Error('TXT 인코딩을 읽지 못했습니다. UTF-8로 저장한 파일을 선택해 주세요.');
    try{text=new TextDecoder('euc-kr',{fatal:true}).decode(bytes);warnings.push('TXT를 한국어 인코딩(CP949/EUC-KR)으로 읽었습니다. 글자가 다르면 UTF-8로 다시 저장해 주세요.')}catch{throw Error('TXT 인코딩을 읽지 못했습니다. UTF-8로 저장한 파일을 선택해 주세요.')}
  }
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))throw Error('일반 텍스트 파일이 아닙니다. TXT로 저장한 원고를 선택해 주세요.');
  text=text.replace(/\r\n?/g,'\n');
  const paragraphs=text.split('\n');
  if(text.length>1000000||paragraphs.length>40000)throw Error('본문은 100만 자, 4만 문단까지 비교할 수 있습니다.');
  return {name,format:'txt',paragraphs,characters:paragraphs.join('').length,warnings};
}
export function writeTxt(paragraphs){
  if(!Array.isArray(paragraphs)||paragraphs.some(p=>typeof p!=='string'))throw Error('저장할 문단 형식이 올바르지 않습니다.');
  if(paragraphs.length>40000||paragraphs.join('\n').length>1000000)throw Error('본문은 100만 자, 4만 문단까지 저장할 수 있습니다.');
  return new TextEncoder().encode('\ufeff'+paragraphs.map(p=>p.replace(/\r\n?|\n/g,'\r\n')).join('\r\n'));
}
