const DATABASE='king-of-revision',VERSION=1;
export function createReviewStore(factory=globalThis.indexedDB){
  let opening=null;
  function open(){
    if(!factory)return Promise.reject(Error('브라우저가 원고 저장을 허용하지 않습니다.'));
    if(!opening)opening=new Promise((resolve,reject)=>{
      const req=factory.open(DATABASE,VERSION);
      req.onupgradeneeded=()=>{for(const name of ['documents','reviews'])if(!req.result.objectStoreNames.contains(name))req.result.createObjectStore(name,{keyPath:'fingerprint'})};
      req.onerror=()=>{opening=null;reject(req.error)};
      req.onblocked=()=>{opening=null;reject(Error('다른 탭에서 열려 있는 퇴고의 제왕을 닫고 다시 시도해 주세요.'))};
      req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>{db.close();opening=null};resolve(db)};
    });
    return opening;
  }
  async function transaction(names,mode,action){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(names,mode);let result;
      tx.oncomplete=()=>resolve(typeof result==='function'?result():result);
      tx.onabort=()=>reject(tx.error||Error('브라우저 저장을 완료하지 못했습니다.'));
      tx.onerror=()=>{};
      try{result=action(tx)}catch(e){tx.abort();reject(e)}
    });
  }
  return {
    putSession:async(snapshot,review)=>{
      if(!snapshot?.fingerprint||!snapshot.documents)throw Error('저장할 원고가 없습니다.');
      const byteLength=new Blob([JSON.stringify(snapshot)]).size;
      return transaction(['documents','reviews'],'readwrite',tx=>{tx.objectStore('documents').put({...snapshot,byteLength});tx.objectStore('reviews').put({fingerprint:snapshot.fingerprint,review});return byteLength});
    },
    putReview:(fingerprint,review)=>transaction(['reviews'],'readwrite',tx=>{tx.objectStore('reviews').put({fingerprint,review})}),
    getSession:fingerprint=>transaction(['documents','reviews'],'readonly',tx=>{const doc=tx.objectStore('documents').get(fingerprint),state=tx.objectStore('reviews').get(fingerprint);return ()=>doc.result?{...doc.result,review:state.result?.review}:null}),
    list:()=>transaction(['reviews'],'readonly',tx=>{const req=tx.objectStore('reviews').getAll();return ()=>req.result}),
    remove:fingerprint=>transaction(['documents','reviews'],'readwrite',tx=>{tx.objectStore('documents').delete(fingerprint);tx.objectStore('reviews').delete(fingerprint)}),
    close:async()=>{if(opening){const db=await opening;db.close();opening=null}}
  };
}
export const reviewStore=createReviewStore();
export function formatBytes(bytes){if(!Number.isFinite(bytes)||bytes<0)return '확인 불가';if(bytes<1024)return Math.ceil(bytes)+' B';if(bytes<1048576)return (bytes/1024).toFixed(1)+' KB';if(bytes<1073741824)return (bytes/1048576).toFixed(1)+' MB';return (bytes/1073741824).toFixed(1)+' GB'}
