const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('ko',{granularity:'sentence'}):null;
export function sentenceCount(text){
  if(!text?.trim())return 0;
  return segmenter?[...segmenter.segment(text)].filter(x=>x.segment.trim()).length:(text.match(/[^.!?。！？]+(?:[.!?。！？]+|$)/g)||[]).length;
}
export function describeChange(oldText,newText,marks,group=null){
  const before=sentenceCount(oldText),after=sentenceCount(newText);
  let label='문구 수정',kind='edit';
  if(oldText===null){label='문단 추가';kind='add'}
  else if(newText===null){label='문단 삭제';kind='delete'}
  else {
    const total=Math.max(oldText.replace(/\s/g,'').length,newText.replace(/\s/g,'').length,1);
    const shared=marks?marks[0].filter(p=>!p[1]).reduce((n,p)=>n+p[0].replace(/\s/g,'').length,0):0;
    const ratio=shared/total;
    if(before===1&&after>1&&ratio>=.4){label='문장 나눔';kind='split'}
    else if(before>1&&after===1&&ratio>=.4){label='문장 합침';kind='merge'}
    else if(ratio<.24&&total>=10){label='문장 교체';kind='rewrite'}
    else if(after>before){label='문장 수 증가';kind='expand'}
    else if(after<before){label='문장 수 감소';kind='reduce'}
  }
  let structure=null;
  if(group&&group.oldParagraphs===1&&group.newParagraphs>1)structure=`문단 나눔 1 → ${group.newParagraphs}`;
  else if(group&&group.oldParagraphs>1&&group.newParagraphs===1)structure=`문단 합침 ${group.oldParagraphs} → 1`;
  else if(group&&group.oldParagraphs&&group.newParagraphs&&group.oldParagraphs!==group.newParagraphs)structure=`문단 구성 ${group.oldParagraphs} → ${group.newParagraphs}`;
  return {label,kind,before,after,structure};
}
