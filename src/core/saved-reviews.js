export const REVIEW_PREFIX='king-of-revision:2:';
export function reviewRecord(model,state,previous=null,now=Date.now()){
  return {...state,metadata:{originalName:model.original.name,revisedName:model.revised.name,totalChanges:model.totalChanges,sceneCount:model.scenes.length,updatedAt:now,createdAt:Number.isFinite(previous?.metadata?.createdAt)?previous.metadata.createdAt:now,example:state.example===true}};
}
export function savedReviews(storage){
  const records=[];
  for(let i=0;i<storage.length;i++){
    const key=storage.key(i);if(!key?.startsWith(REVIEW_PREFIX)||key.length===REVIEW_PREFIX.length)continue;
    try{
      const data=JSON.parse(storage.getItem(key));
      if(!data||typeof data!=='object'||!data.choices||typeof data.choices!=='object'||Array.isArray(data.choices))continue;
      const meta=data.metadata||{},done=Object.values(data.choices).filter(v=>v==='old'||v==='new').length;
      records.push({fingerprint:key.slice(REVIEW_PREFIX.length),originalName:typeof meta.originalName==='string'?meta.originalName:'이름 정보가 없는 이전 원문',revisedName:typeof meta.revisedName==='string'?meta.revisedName:'이름 정보가 없는 이전 개고본',done,total:Number.isInteger(meta.totalChanges)&&meta.totalChanges>=done?meta.totalChanges:null,sceneIndex:Number.isInteger(data.sceneIndex)&&data.sceneIndex>=0?data.sceneIndex:0,updatedAt:Number.isFinite(meta.updatedAt)&&meta.updatedAt>0&&meta.updatedAt<=8640000000000000?meta.updatedAt:null,example:meta.example===true});
    }catch{/* One damaged record must not hide other saved comparisons. */}
  }
  return records.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)||a.fingerprint.localeCompare(b.fingerprint));
}
