import {normalizeFormat,editFormat,styleRange} from './core/formatting.js';
import {reviewStore,formatBytes} from './core/review-store.js';
import {editorText} from './core/editing.js';
import {REVIEW_PREFIX,reviewRecord,savedReviews} from './core/saved-reviews.js';
import {paragraphPresentation} from './core/review.js';
import {choiceCounts,selectedParagraphs,validateChoices} from './core/compare.js';
const $=id=>document.getElementById(id),fmt=n=>n.toLocaleString('ko-KR');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let files={old:null,new:null},model=null,choices={},sceneIndex=0,full=false,font=17,query='',filter='all',expanded=new Set(),history=[],worker=null,requests=new Map(),serial=0,operation=0,toastTimer,activeChange=null,storageOK=true;
let historyRecords=[],historyJob=0,deleteTarget=null,bodySaved=new Set();
let editing=false,editDraftStart='',editMode='revised',editParagraphIndex=null,editDraftFormat=null,editFormatStart='',editFormatText='',editScroll=null;
let resumeTarget=null,currentExample=false;
let savedManuscript=null,returnHomeAfterExport=false,exporting=false;
function manuscriptSnapshot(){return model?JSON.stringify([model.fingerprint,Object.entries(choices).sort(([a],[b])=>a.localeCompare(b))]):null}
function needsManuscriptSave(){return !!model&&manuscriptSnapshot()!==savedManuscript}
function goHome(){saveChoices();model=null;returnHomeAfterExport=false;location.hash='use';showPage('use');window.scrollTo(0,0)}
function requestHome(){if(exporting)return;if(needsManuscriptSave()){if(!$('leave-dialog').open)$('leave-dialog').showModal()}else goHome()}
const allChanges=()=>model?model.scenes.flatMap((s,i)=>s.segments.filter(g=>g.type==='change').map(g=>({...g,scene:i}))):[];
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4500)}
function busy(on,message='원고를 읽고 있습니다…'){$('busy').classList.toggle('hidden',!on);$('busy-label').textContent=message}
function makeWorker(){if(worker)return;worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});worker.onmessage=({data})=>{const request=requests.get(data.id);if(!request)return;requests.delete(data.id);data.error?request.reject(Error(data.error)):request.resolve(data.result)};worker.onerror=e=>{for(const r of requests.values())r.reject(Error('문서 처리 중 오류가 발생했습니다. 파일을 다시 선택해 주세요.'));requests.clear();worker?.terminate();worker=null;e.preventDefault()}}
function callWorker(type,payload,transfer=[]){makeWorker();return new Promise((resolve,reject)=>{const id=++serial;requests.set(id,{resolve,reject});worker.postMessage({id,type,payload},transfer)})}
function cancel(){if(editing)return;if(exporting){operation++;exporting=false;busy(false);return}operation++;worker?.terminate();worker=null;for(const r of requests.values())r.reject(Error('작업을 취소했습니다.'));requests.clear();busy(false);model=null;showPage('use')}
function storageKey(){return REVIEW_PREFIX+model.fingerprint}
function currentReview(){return reviewRecord(model,{choices:{...choices},sceneIndex,full,font,example:currentExample})}
function saveChoices(){
  if(!model)return;const fp=model.fingerprint,state=currentReview();
  try{localStorage.setItem(REVIEW_PREFIX+fp,JSON.stringify(state));storageOK=true}catch{storageOK=false}
  const node=$('save-label');if(node)node.textContent='선택 저장 중…';
  reviewStore.putReview(fp,state).then(()=>{if(model?.fingerprint===fp&&node)node.textContent=bodySaved.has(fp)?'원고와 선택 저장됨':'선택 저장됨'}).catch(()=>{if(model?.fingerprint===fp&&node)node.textContent=storageOK?'선택만 저장됨 · 원고는 파일로 보관해 주세요':'저장 공간 부족 · 원고를 내려받아 주세요'});
}
async function persistCurrent(){
  if(!model)return;const fp=model.fingerprint,state=currentReview();
  try{const snapshot=await callWorker('snapshot',{});if(snapshot.fingerprint!==fp)return;await reviewStore.putSession(snapshot,state);bodySaved.add(fp);if(model?.fingerprint===fp)saveChoices()}
  catch{toast('브라우저에 원고를 보관하지 못했습니다. 저장 공간을 확인하고 원고 파일을 내려받아 주세요.')}
}

function loadChoices(record=null){savedManuscript=null;returnHomeAfterExport=false;choices={};sceneIndex=Math.max(0,model.scenes.findIndex(s=>s.changes));full=false;font=17;try{const data=record||JSON.parse(localStorage.getItem(storageKey())||'null');if(data){choices=validateChoices(model,data.choices);sceneIndex=Number.isInteger(data.sceneIndex)?Math.max(0,Math.min(model.scenes.length-1,data.sceneIndex)):0;full=data.full===true;font=Number.isFinite(data.font)?Math.max(14,Math.min(24,data.font)):17;}}catch{choices={};sceneIndex=0}history=[];expanded.clear();activeChange=null}
function setFile(side,file){if(!file)return;if(!/\.(hwpx?|docx|txt)$/i.test(file.name)){toast('HWP, HWPX, DOCX 또는 TXT 파일을 선택해 주세요.');return}if(file.size>30*1024*1024){toast('파일 하나당 30 MB까지 읽을 수 있습니다.');return}files[side]=file;updateFiles()}
function updateFiles(){for(const side of ['old','new']){$(side+'-file-label').textContent=files[side]?files[side].name:side==='old'?'HWP · HWPX · DOCX · TXT 파일을 놓거나 눌러서 선택':'수정한 HWP · HWPX · DOCX · TXT 파일을 선택';$('pick-'+side).classList.toggle('ready',!!files[side]);}$('compare-btn').disabled=!(files.old&&files.new)}
function paintHistory(records){
  historyRecords=records;const list=$('saved-review-list');if(!list)return;
  list.innerHTML=records.length?records.map(r=>`<article class="saved-review"><div class="saved-review-info"><h3>${esc(r.originalName)}</h3><p>개고본 · ${esc(r.revisedName)}</p><div class="saved-review-meta"><span>${r.total===null?'선택 '+r.done+'개':'검토 '+r.done+' / '+r.total}</span><span>마지막 장면 ${r.sceneIndex+1}</span><span>${r.updatedAt?esc(new Date(r.updatedAt).toLocaleString('ko-KR',{dateStyle:'short',timeStyle:'short'})):'이전 버전에서 저장한 기록'}</span></div></div><div class="saved-review-actions"><button class="secondary" data-resume-review="${esc(r.fingerprint)}">이어서 비교 →</button><button class="text-btn" data-delete-review="${esc(r.fingerprint)}">기록 지우기</button></div></article>`).join(''):'<p class="saved-review-empty">아직 저장된 비교가 없습니다. 원고를 비교하면 이곳에 기록이 남습니다.</p>';
}
async function renderSavedReviews(){
  const job=++historyJob;let legacy=[];
  try{legacy=savedReviews(localStorage)}catch{}
  paintHistory(legacy);
  try{
    const rows=await reviewStore.list();if(job!==historyJob)return;
    const map=new Map(legacy.map(r=>[r.fingerprint,r]));
    for(const row of rows){const storage={length:1,key:()=>REVIEW_PREFIX+row.fingerprint,getItem:()=>JSON.stringify(row.review)};const r=savedReviews(storage)[0];if(r)map.set(r.fingerprint,r)}
    paintHistory([...map.values()].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)));
  }catch{if(!legacy.length)$('saved-review-list').innerHTML='<p class="saved-review-empty">원고 저장 공간을 열 수 없습니다. 브라우저의 사이트 저장 설정을 확인해 주세요.</p>'}
  updateStorageUsage();
}
async function updateStorageUsage(){
  const node=$('storage-usage');if(!node)return;
  try{const estimate=await navigator.storage.estimate();node.textContent=`이 사이트의 저장 공간 · 약 ${formatBytes(estimate.usage)} / ${formatBytes(estimate.quota)}`;}
  catch{node.textContent='저장 공간 한도는 브라우저가 관리합니다.'}
}
async function resumeReview(fingerprint){
  if(editing||exporting)return;const job=++operation;busy(true,'저장한 비교를 열고 있습니다…');
  try{
    let record=historyRecords.find(r=>r.fingerprint===fingerprint);if(!record)try{record=savedReviews(localStorage).find(r=>r.fingerprint===fingerprint)}catch{}
    let snapshot=null;try{snapshot=await reviewStore.getSession(fingerprint)}catch{}
    if(!snapshot&&worker){try{const live=await callWorker('snapshot',{});if(live.fingerprint===fingerprint)snapshot=live}catch{}}
    if(job!==operation)return;
    if(snapshot){
      const result=await callWorker('restore',{snapshot});if(job!==operation)return;
      model=result;currentExample=record?.example===true;bodySaved.add(fingerprint);clearResume();query='';filter='all';loadChoices(snapshot.review);renderWorkspace();location.hash='use';showPage('use');saveChoices();await persistCurrent();return;
    }
    if(!record){toast('비교 기록을 찾을 수 없습니다.');renderSavedReviews();return}
    if(record.example){busy(false);await demo(fingerprint);return}
    resumeTarget=fingerprint;files={old:null,new:null};updateFiles();
    $('resume-review').classList.remove('hidden');$('resume-review-label').textContent='이전 기록 복원: '+record.originalName+' / '+record.revisedName;
    $('home-status').textContent='이전 버전의 기록에는 본문이 없습니다. 원문과 개고본을 한 번만 다시 선택하면 다음부터 바로 이어집니다.';
    $('pick-old').focus();window.scrollTo({top:0,behavior:'smooth'});
  }catch(e){toast(e.message||'저장한 비교를 열 수 없습니다.')}
  finally{if(job===operation)busy(false)}
}
function requestDelete(fingerprint){deleteTarget=fingerprint;const record=historyRecords.find(r=>r.fingerprint===fingerprint);$('delete-review-name').textContent=record?.originalName||'선택한 비교';$('delete-review-error').textContent='';$('delete-review-dialog').showModal()}
async function deleteReview(){
  if(!deleteTarget)return;const fp=deleteTarget;$('confirm-delete-review').disabled=true;
  try{await reviewStore.remove(fp);localStorage.removeItem(REVIEW_PREFIX+fp);bodySaved.delete(fp);if(resumeTarget===fp)clearResume();$('delete-review-dialog').close();deleteTarget=null;await renderSavedReviews();toast('이 비교의 원고와 선택 기록을 지웠습니다.')}
  catch{$('delete-review-error').textContent='기록을 지우지 못했습니다. 브라우저 저장 설정을 확인해 주세요.'}
  finally{$('confirm-delete-review').disabled=false}
}

function clearResume(){resumeTarget=null;$('resume-review')?.classList.add('hidden');$('home-status').textContent='본문의 문장과 문단을 비교합니다.'}
async function compare(example=false){
  if(editing)return;
  if(!files.old||!files.new)return;
  const job=++operation,selected={...files};busy(true,'두 원고에서 달라진 부분을 찾고 있습니다…');
  try{
    const [a,b]=await Promise.all([selected.old.arrayBuffer(),selected.new.arrayBuffer()]);
    if(job!==operation)return;
    const result=await callWorker('compare',{old:{name:selected.old.name,buffer:a},new:{name:selected.new.name,buffer:b}},[a,b]);
    if(job!==operation)return;
    if(resumeTarget&&result.fingerprint!==resumeTarget){toast('선택한 파일은 이 비교 기록의 원고와 다릅니다. 원문과 개고본을 확인하거나 기록 선택을 해제해 주세요.');return}
    clearResume();currentExample=example;model=result;query='';filter='all';loadChoices();renderWorkspace();location.hash='use';showPage('use');saveChoices();await persistCurrent();
  }catch(e){if(job===operation){toast(e.message);$('home-status').textContent=e.message;model=null;showPage('use')}throw e}
  finally{if(job===operation)busy(false)}
}
async function demo(resumeFingerprint=null){
  if(editing)return;
  clearResume();resumeTarget=resumeFingerprint;
  const job=++operation;busy(true,'예제 원문과 개고안을 준비하고 있습니다…');
  try{
    const names=['한_쪽이_너무_유리한_게임_원문.hwpx','한_쪽이_너무_유리한_게임_개고안.hwpx'];
    const loaded=await Promise.all(names.map(async name=>{
      const response=await fetch(import.meta.env.BASE_URL+'examples/'+encodeURIComponent(name));
      if(!response.ok)throw Error('예제 파일을 받지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return new File([await response.arrayBuffer()],name,{type:'application/hwp+zip'});
    }));
    if(job!==operation)throw Error('작업을 취소했습니다.');
    files={old:loaded[0],new:loaded[1]};updateFiles();await compare(true);
  }catch(e){if(job===operation){busy(false);toast(e.message)}throw e}
}
function renderWorkspace(){
  const oldName=model.original.name,newName=model.revised.name;
  $('workspace').innerHTML=`<aside class="side" aria-label="장면 탐색"><div class="side-top"><button class="text-btn back-btn" data-home>← 다른 원고 비교</button><h2 class="side-title">원고의 변경 사항</h2><div class="doc-stat"><span>원문</span><strong>${fmt(model.original.characters)}자</strong></div><div class="doc-stat"><span>개고본</span><strong>${fmt(model.revised.characters)}자</strong></div><input class="search-input" id="search" type="search" placeholder="장면·본문 검색" aria-label="장면과 양쪽 본문 검색" value="${esc(query)}"></div><div class="side-filter"><select id="scene-filter" aria-label="장면 검토 상태"><option value="all">전체 장면</option><option value="pending">미검토 있음</option><option value="done">검토 완료</option></select><span id="scene-total"></span></div><nav id="scene-list" class="scene-list" aria-label="장면 목록"></nav><div class="side-progress"><div class="progress-text"><b>전체 검토</b><span id="progress-text"></span></div><div class="progress-track" role="progressbar" aria-label="검토 진행률" aria-valuemin="0" aria-valuemax="100"><div id="progress-fill" class="progress-fill"></div></div><div class="side-rule">장면 구분: <b>Enter 두 번</b><br>문단 사이의 빈 줄 하나를 기준으로 나눕니다.</div></div></aside><div class="main-panel"><div class="workspace-head"><div><h2 id="current-title"></h2><div class="sub" id="current-sub"></div></div><div class="head-actions"><button data-edit="revised">개고본 직접 편집</button><button data-edit="merged">합친 원고 편집</button>${model.manuallyEdited?'<button data-download-revised>개고본 저장 ↓</button>':''}<button class="text-btn backup-action" data-backup>선택 백업 ↓</button><button class="text-btn backup-action" data-restore>불러오기</button><button class="primary" data-export>${model.outputFormat.toUpperCase()} 저장 ↓</button></div></div><div class="toolbar"><div class="toolbar-left"><div class="segmented"><button data-view="changes">변경만</button><button data-view="full">전체 글</button></div><button data-font="-1" aria-label="글자 작게">A−</button><span id="font-output" class="font-output"></span><button data-font="1" aria-label="글자 크게">A+</button><button data-prev-scene aria-label="이전 장면" title="이전 장면">← 이전 장면</button><button data-next-scene aria-label="다음 장면" title="다음 장면">다음 장면 →</button></div><div class="toolbar-right"><span class="toolbar-label">이 장면 전체</span><button data-scene-choice="old">원문 유지</button><button data-scene-choice="new">개고 채택</button><button data-next-pending>다음 미검토 ↗</button></div></div><div class="columns"><div><strong><i class="color-key"></i>원문</strong><small title="${esc(oldName)}">${esc(oldName)}</small></div><div><strong><i class="color-key new"></i>개고본</strong><small title="${esc(newName)}">${esc(newName)}</small></div></div><div class="diff-pane" id="diff-pane" tabindex="0" aria-label="원문과 개고본 비교"></div><footer class="workspace-footer"><div><span id="save-label">선택 자동 저장됨</span><button class="text-btn" id="undo-btn" data-undo>되돌리기</button></div><div><span class="footer-hint">Alt + ↑ ↓ 수정 이동</span><span id="counts"></span></div></footer></div>`;
  document.documentElement.style.setProperty('--font-size',font+'px');$('font-output').textContent=font;$('scene-filter').value=filter;
  $('search').oninput=()=>{clearTimeout($('search').searchTimer);$('search').searchTimer=setTimeout(()=>{query=$('search').value.trim();renderSidebar();renderDiff(false)},150)};
  $('scene-filter').onchange=()=>{filter=$('scene-filter').value;renderSidebar()};
  renderSidebar();renderDiff();
}
function completed(scene){return scene.segments.filter(g=>g.type==='change'&&choices[g.id]).length}
function renderSidebar(){const nav=$('scene-list');if(!nav)return;const scroll=nav.scrollTop;let html='',count=0;
  model.scenes.forEach((scene,index)=>{const done=completed(scene);if(filter==='pending'&&done===scene.changes)return;if(filter==='done'&&done!==scene.changes)return;if(query&&!(scene.old.join('\n')+'\n'+scene.new.join('\n')).toLocaleLowerCase().includes(query.toLocaleLowerCase()))return;count++;const label=scene.oldIndex===null?'추가된 장면':scene.newIndex===null?'삭제된 장면':'변경 '+scene.changes+'곳';html+=`<button class="scene-link ${sceneIndex===index?'active':''}" data-scene="${index}" aria-current="${sceneIndex===index?'true':'false'}" title="${esc(scene.title)}"><span class="scene-num">${String(index+1).padStart(2,'0')}</span><span class="scene-link-text"><strong>${esc(scene.title||'빈 문서')}</strong><small>${label}</small></span><span class="badge ${done===scene.changes?'done':''}">${done===scene.changes?'✓':scene.changes-done}</span></button>`});nav.innerHTML=html||'<p class="empty-result">조건에 맞는 장면이 없습니다.</p>';nav.scrollTop=scroll;$('scene-total').textContent=count+'개';const c=choiceCounts(model,choices);$('progress-text').textContent=c.done+' / '+model.totalChanges;const percent=model.totalChanges?c.done/model.totalChanges*100:100;$('progress-fill').style.width=percent+'%';$('progress-fill').parentElement.setAttribute('aria-valuenow',Math.round(percent));$('counts').textContent='채택 '+c.rev+' · 유지 '+c.old+' · 미선택 '+c.pending;$('undo-btn').disabled=!history.length;}
function highlighted(text){if(!query)return esc(text);const lower=text.toLocaleLowerCase(),term=query.toLocaleLowerCase();let out='',pos=0,index;while((index=lower.indexOf(term,pos))>=0){out+=esc(text.slice(pos,index))+'<mark>'+esc(text.slice(index,index+query.length))+'</mark>';pos=index+query.length}return out+esc(text.slice(pos))}
function marked(text,parts){if(text==='')return '<span class="empty-para" aria-label="빈 문단, 장면 경계">↵ 빈 문단</span>';return parts?parts.map(([t,changed])=>changed?'<span class="inline-edit">'+highlighted(t)+'</span>':highlighted(t)).join(''):highlighted(text)}
function paragraphEdit(scene,n){return `<button class="paragraph-edit" data-edit-paragraph="${scene.newStart+n}" aria-label="개고본 ${scene.newStart+n+1}번째 문단 편집">문단 편집</button>`}
function paragraphCSS(scene,side,n){const p=scene[side+'Formatting']?.[n]?.paragraph||{};let css='';for(const [key,prop] of [['left','padding-left'],['right','padding-right'],['firstLine','text-indent']])if(Number.isFinite(p[key]))css+=prop+':'+Math.max(-100,Math.min(100,p[key]))+'pt;';if(['left','right','center','justify'].includes(p.align))css+='text-align:'+p.align+';';return css}
function formattedText(scene,side,n,parts){const text=scene[side][n],runs=scene[side+'Formatting']?.[n]?.runs;if(!runs?.length||!text)return marked(text,parts);const markedParts=parts||[[text,false]];let cursor=0,partIndex=0,partOffset=0;return runs.map(r=>{let remaining=r.text,html='';while(remaining){const part=markedParts[partIndex];if(!part){html+=highlighted(remaining);break}const count=Math.min(remaining.length,part[0].length-partOffset);if(!count){partIndex++;partOffset=0;continue}const t=remaining.slice(0,count);html+=part[1]?'<span class="inline-edit">'+highlighted(t)+'</span>':highlighted(t);remaining=remaining.slice(count);partOffset+=count;cursor+=count}const s=r.style||{},family=String(s.font||'').replace(/[^\p{L}\p{N} _-]/gu,'');const size=Number.isFinite(s.size)?Math.min(4,Math.max(.5,s.size/12.75)):1;return `<span style="font-weight:${s.bold?'700':'400'};font-style:${s.italic?'italic':'normal'};font-size:${size}em;${family?'font-family:'+esc(family)+',serif;':''}">${html}</span>`}).join('')}
function row(scene,a,b,marks=null){const equal=a!==null&&b!==null&&scene.old[a]===scene.new[b];const cell=(side,n,p)=>{if(n===null)return '<div class="cell blank" aria-label="대응 문단 없음"><span></span><p class="text"></p></div>';return `<div class="cell ${equal?'':side==='old'?'deleted':'added'}"><span class="line-no" aria-hidden="true">${n+1}</span><p class="text" style="${paragraphCSS(scene,side,n)}">${formattedText(scene,side,n,!equal&&!p?[[scene[side][n],true]]:p)}</p>${side==='new'&&equal?paragraphEdit(scene,n):''}</div>`};return `<div class="row ${equal?'equal-row':''}">${cell('old',a,marks?.[0])}${cell('new',b,marks?.[1])}</div>`}
function paragraphBody(scene,g){
  const state=paragraphPresentation(scene,g,choices[g.id]);
  if(!state.resolved)return g.rows.map(([a,b,m])=>row(scene,a,b,m)).join('');
  const note=state.text===null?(state.choice==='old'?'추가하지 않은 문단':'삭제를 채택한 문단'):null;
  const source=choices[g.id]==='new'?'new':'old',n=g[source==='new'?'b':'a'][0];
  const cell=()=>`<div class="cell resolved-cell"><span class="line-no" aria-hidden="true">✓</span><p class="text" style="${paragraphCSS(scene,source,n)}">${note?`<span class="resolved-empty">${note}</span>`:formattedText(scene,source,n,null)}</p></div>`;
  return `<div class="row resolved-row">${cell()}${cell()}</div>`;
}
function changeHeader(g){const v=choices[g.id];return `<div class="change-meta"><strong>문단 ${g.number}</strong><span class="change-type type-${g.description.kind}">${g.description.label}</span><span class="sentence-count">${g.description.before}문장 → ${g.description.after}문장</span>${g.description.structure?`<span class="structure-label">${g.description.structure}</span>`:''}<span class="choice-status ${v||''}">${v==='new'?'✓ 개고 채택됨':v==='old'?'✓ 원문 유지됨':'미선택'}</span></div><div class="choice-actions">${g.b[1]>g.b[0]?paragraphEdit(model.scenes[sceneIndex],g.b[0]):''}<button class="choice-btn ${v==='old'?'selected':''}" data-choice="${g.id}" data-value="old" aria-pressed="${v==='old'}">${v==='old'?'✓ ':''}원문 유지</button><button class="choice-btn ${v==='new'?'selected':''}" data-choice="${g.id}" data-value="new" aria-pressed="${v==='new'}">${v==='new'?'✓ ':''}개고 채택</button><button class="text-btn clear-btn" data-choice="${g.id}" data-value="clear" aria-label="문단 ${g.number} 선택 해제" ${v?'':'disabled'}>↺</button></div>`}
function context(scene,g,index){const n=g.a[1]-g.a[0],id=scene.id+'-e'+index,open=full||query||expanded.has(id)||n<=6;const render=(from,to)=>{let html='';for(let i=from;i<to;i++)html+=row(scene,g.a[0]+i,g.b[0]+i);return html};if(open)return (!full&&!query&&n>6?`<div class="context-gap"><button data-gap="${id}">같은 문단 접기 ↑</button></div>`:'')+render(0,n);return render(0,2)+`<div class="context-gap"><button data-gap="${id}">↕ 같은 문단 ${n-4}개 펼치기</button></div>`+render(n-2,n)}
function renderDiff(reset=true){if(!model)return;const scene=model.scenes[sceneIndex],pane=$('diff-pane'),oldScroll=pane.scrollTop;const oldNumber=scene.oldIndex===null?'없음':scene.oldIndex+1,newNumber=scene.newIndex===null?'없음':scene.newIndex+1;$('current-title').textContent='장면 '+(sceneIndex+1);$('current-sub').textContent=`원문 ${oldNumber} → 개고 ${newNumber} · 변경 ${scene.changes}곳 · 검토 ${completed(scene)}/${scene.changes}`;
  let html=(model.manuallyEdited?'<div class="warning-note">직접 편집한 개고본으로 비교 중입니다. 파일로도 보관하려면 위의 <b>개고본 저장</b>을 눌러 주세요. 선택 원고 저장에는 채택한 문단만 포함됩니다.</div>':'')+'<div class="review-note">바뀐 글자만 강조합니다. 서식만 다르면 ‘서식 변경’으로 표시합니다. 선택하면 양쪽 문단이 선택한 본문으로 바뀝니다. 미선택 문단은 원문으로 저장됩니다.</div>';const warnings=[...new Set([...model.original.warnings,...model.revised.warnings])];if(warnings.length)html+='<div class="warning-note">'+warnings.map(esc).join('<br>')+'</div>';
  if(!model.totalChanges)html+='<div class="empty-result"><h3>본문과 기본 서식이 같습니다.</h3><p>본문과 지원하는 기본 서식이 같습니다. 쪽 배치 등 지원하지 않는 서식은 비교하지 않습니다.</p></div>';
  scene.segments.forEach((g,i)=>{if(g.type==='equal')html+=`<section data-context="${scene.id}-e${i}">${context(scene,g,i)}</section>`;else html+=`<section class="change ${choices[g.id]?'resolved':''} ${activeChange===g.id?'focused':''}" id="${g.id}" data-hunk="${g.id}"><div class="change-head">${changeHeader(g)}</div>${paragraphBody(scene,g)}</section>`});
  html+=`<div class="end-scene"><span>장면 ${sceneIndex+1} / ${model.scenes.length}</span><div class="scene-navigation" role="group" aria-label="장면 이동"><button data-prev-scene>← 이전 장면</button><button data-next-scene>다음 장면 →</button></div>${sceneIndex===model.scenes.length-1?'<button class="primary" data-export>선택한 원고 '+model.outputFormat.toUpperCase()+' 저장 ↓</button>':''}</div>`;pane.innerHTML=html;pane.style.scrollBehavior='auto';pane.scrollTop=reset?0:oldScroll;pane.style.scrollBehavior='';document.querySelectorAll('[data-view]').forEach(b=>{const on=(b.dataset.view==='full')===full;b.classList.toggle('active',on);b.setAttribute('aria-pressed',on)});document.querySelectorAll('[data-prev-scene]').forEach(b=>b.disabled=sceneIndex===0);document.querySelectorAll('[data-next-scene]').forEach(b=>b.disabled=sceneIndex===model.scenes.length-1);
}
function navigate(index,id){if(!model||index<0||index>=model.scenes.length)return;sceneIndex=index;activeChange=id||null;renderSidebar();renderDiff();saveChoices();if(id)focusChange(id,false);else if(query){const mark=$('diff-pane').querySelector('mark');mark?.scrollIntoView({block:'center'})}document.querySelector('.scene-link.active')?.scrollIntoView({block:'nearest'})}
function focusChange(id,smooth=true){activeChange=id;document.querySelectorAll('.change').forEach(el=>el.classList.toggle('focused',el.id===id));const node=$(id),pane=$('diff-pane');if(node)pane.scrollTo({top:pane.scrollTop+node.getBoundingClientRect().top-pane.getBoundingClientRect().top,behavior:smooth?'smooth':'instant'})}
function visibleChange(){const pane=$('diff-pane');if(!pane)return null;const top=pane.getBoundingClientRect().top;return [...pane.querySelectorAll('.change')].find(el=>el.getBoundingClientRect().bottom>top+60)?.id||null}
function jump(direction,pending=false){if(!model)return;const all=allChanges();if(!all.length){toast('변경된 본문이 없습니다.');return}if(pending&&!choiceCounts(model,choices).pending){toast('모든 문단을 검토했습니다. 선택한 원고를 저장할 수 있습니다.');return}let start=all.findIndex(h=>h.id===visibleChange());if(start<0)start=all.findIndex(h=>h.scene>=sceneIndex)-1;for(let n=1;n<=all.length;n++){const next=all[(start+direction*n+all.length*2)%all.length];if(!pending||!choices[next.id]){if(next.scene!==sceneIndex)navigate(next.scene,next.id);else focusChange(next.id);return}}}
function applyChoices(items,message){if(!model)return;const next={...choices};const ids=new Set(allChanges().map(h=>h.id));for(const [id,value] of items){if(!ids.has(id)||!['old','new','clear'].includes(value))throw Error('올바르지 않은 수정 선택입니다.');if(value==='clear')delete next[id];else next[id]=value;}if(JSON.stringify(next)===JSON.stringify(choices))return;history.push({...choices});if(history.length>100)history.shift();choices=next;saveChoices();renderSidebar();const s=model.scenes[sceneIndex];$('current-sub').textContent=`원문 ${s.oldIndex===null?'없음':s.oldIndex+1} → 개고 ${s.newIndex===null?'없음':s.newIndex+1} · 변경 ${s.changes}곳 · 검토 ${completed(s)}/${s.changes}`;for(const g of s.segments)if(g.type==='change'&&$(g.id)){$(g.id).classList.toggle('resolved',!!choices[g.id]);$(g.id).innerHTML='<div class="change-head">'+changeHeader(g)+'</div>'+paragraphBody(s,g);}if(message)toast(message)}
function undo(){if(!history.length)return;choices=history.pop();saveChoices();renderSidebar();renderDiff(false);toast('직전 선택을 되돌렸습니다.')}
function download(name,buffer,type){const url=URL.createObjectURL(new Blob([buffer],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
function backup(){if(!model)return;const value={type:'king-of-revision',version:2,fingerprint:model.fingerprint,original:model.original.name,revised:model.revised.name,choices,savedAt:new Date().toISOString()};download('퇴고의제왕_선택백업.json',JSON.stringify(value,null,2),'application/json;charset=utf-8');toast('선택 백업을 내려받습니다.')}
async function restore(file){if(!model||!file)return;try{if(file.size>2*1024*1024)throw Error('선택 백업 파일은 2 MB까지 읽습니다.');const value=JSON.parse(await file.text());if(value.type!=='king-of-revision'||value.fingerprint!==model.fingerprint)throw Error('현재 두 원고에 해당하는 백업이 아닙니다.');const next=validateChoices(model,value.choices);history.push({...choices});choices=next;saveChoices();renderSidebar();renderDiff(false);toast('검토 선택을 불러왔습니다.')}catch(e){toast('불러오기 실패: '+(e instanceof SyntaxError?'JSON 백업 파일을 선택해 주세요.':e.message))}}
function syncDraftFormat(){const text=$('manuscript-editor').value;if(text!==editFormatText){editDraftFormat=editFormat(editFormatText,text,editDraftFormat);editFormatText=text}}
function renderFormatPreview(){if(editMode!=='paragraph')return;$('manuscript-editor').style.textIndent=Math.max(-100,Math.min(100,editDraftFormat.paragraph.firstLine||0))+'pt';const mock={new:[editFormatText.replace(/\u2028/g,'\n')],newFormatting:[{...editDraftFormat,runs:editDraftFormat.runs.map(r=>({...r,text:r.text.replace(/\u2028/g,'\n')}))}]};$('format-preview').innerHTML=`<p class="text" style="${paragraphCSS(mock,'new',0)}">${formattedText(mock,'new',0,null)}</p>`;for(const k of ['bold','italic'])document.querySelector(`[data-format-run="${k}"]`)?.setAttribute('aria-pressed',String(editDraftFormat.runs.every(r=>r.style[k])))}
function formatRun(key,value){if(editMode!=='paragraph'||editing)return;syncDraftFormat();const input=$('manuscript-editor'),start=input.selectionStart,end=input.selectionEnd;if(value===undefined){const current=styleRange(editFormatText,editDraftFormat,start,end,{}).runs;let offset=0;const selected=current.filter(r=>{const match=start===end||offset+r.text.length>start&&offset<end;offset+=r.text.length;return match});value=!selected.every(r=>r.style[key])}const style=key==='font'?{font:value,latinFont:value}:{[key]:value};editDraftFormat=styleRange(editFormatText,editDraftFormat,start,end,style);renderFormatPreview();}
document.addEventListener('input',e=>{if(editMode!=='paragraph'||editing)return;if(e.target.id==='manuscript-editor'){syncDraftFormat();renderFormatPreview()}else if(e.target.id==='format-size'){const n=Number(e.target.value);if(n>=1&&n<=400)formatRun('size',n)}else if(e.target.id==='format-indent'){const n=Number(e.target.value);if(Number.isFinite(n)&&Math.abs(n)<=2000){syncDraftFormat();editDraftFormat.paragraph.firstLine=n;renderFormatPreview()}}});
document.addEventListener('change',e=>{if(editMode!=='paragraph'||editing)return;if(e.target.id==='format-font'&&e.target.value)formatRun('font',e.target.value);if(e.target.id==='format-align'){syncDraftFormat();editDraftFormat.paragraph.align=e.target.value;renderFormatPreview()}});
function captureEditScroll(index){const pane=$('diff-pane'),anchor=Number.isInteger(index)?document.querySelector(`[data-edit-paragraph="${index}"]`):null;return {top:pane?.scrollTop||0,left:pane?.scrollLeft||0,sidebar:$('scene-list')?.scrollTop||0,offset:anchor&&pane?anchor.getBoundingClientRect().top-pane.getBoundingClientRect().top:null,index,windowX:window.scrollX||0,windowY:window.scrollY||0}}
function restoreEditScroll(position){if(!position)return;const pane=$('diff-pane');if(!pane)return;pane.style.scrollBehavior='auto';pane.scrollTop=position.top;pane.scrollLeft=position.left;const anchor=Number.isInteger(position.index)?document.querySelector(`[data-edit-paragraph="${position.index}"]`):null;if(anchor&&position.offset!==null)pane.scrollTop+=anchor.getBoundingClientRect().top-pane.getBoundingClientRect().top-position.offset;pane.style.scrollBehavior='';if($('scene-list'))$('scene-list').scrollTop=position.sidebar;window.scrollTo(position.windowX,position.windowY)}
function showEditor(mode,index=null){
  if(!model||editing)return;
  editScroll=captureEditScroll(mode==='paragraph'?index:null);
  $('manuscript-editor').style.textIndent='0pt';
  editMode=mode;editParagraphIndex=mode==='paragraph'?index:null;
  const all=model.scenes.flatMap(s=>s.new);if(mode==='paragraph'&&(!Number.isInteger(index)||index<0||index>=all.length))return;
  const paragraphs=mode==='paragraph'?[all[index]]:mode==='merged'?selectedParagraphs(model,choices):all;
  $('editor-title').textContent=mode==='paragraph'?'개고본 문단 편집':mode==='merged'?'합친 원고 편집':'개고본 직접 편집';
  $('editor-source').textContent=mode==='paragraph'?'개고본의 이 문단만 고칩니다. 적용하면 다시 비교하며, 새 수정은 확인한 뒤 채택할 수 있습니다.':mode==='merged'?'지금까지 선택한 내용을 합친 원고입니다. 미선택 문단은 원문으로 들어 있습니다.':'현재 개고본 전체입니다. 원문은 바뀌지 않습니다.';
  editDraftStart=editorText(paragraphs);$('manuscript-editor').value=editDraftStart;
  $('paragraph-formatting').classList.toggle('hidden',mode!=='paragraph');
  if(mode==='paragraph'){const scene=model.scenes.find(s=>s.newStart!==null&&index>=s.newStart&&index<s.newStart+s.new.length),source=scene?.newFormatting?.[index-scene.newStart];editDraftFormat=normalizeFormat(paragraphs[0],source);editDraftFormat.runs=editDraftFormat.runs.map(r=>({...r,text:r.text.replace(/\n/g,'\u2028')}));editFormatText=editDraftStart;editFormatStart=JSON.stringify(editDraftFormat);const style=editDraftFormat.runs[0]?.style||{};$('format-font').value=style.font||'';$('format-size').value=style.size||11;$('format-indent').value=editDraftFormat.paragraph.firstLine||0;$('format-align').value=editDraftFormat.paragraph.align||'left';renderFormatPreview();}
$('editor-error').textContent='';$('edit-dialog').showModal();
}
function closeEditor(){
  if(editing)return;
  if(($('manuscript-editor').value!==editDraftStart||(editMode==='paragraph'&&JSON.stringify(editDraftFormat)!==editFormatStart))&&!window.confirm('아직 적용하지 않은 글을 버리고 편집을 닫을까요?'))return;
  $('edit-dialog').close();
}
async function applyEditor(){
  if(!model||editing)return;
  const text=$('manuscript-editor').value;if(editMode==='paragraph')syncDraftFormat();if(text===editDraftStart&&(editMode!=='paragraph'||JSON.stringify(editDraftFormat)===editFormatStart)){$('edit-dialog').close();return}
  editing=true;$('apply-editor').disabled=true;$('editor-error').textContent='수정한 글로 다시 비교하고 있습니다…';
  try{
    const result=await callWorker(editMode==='paragraph'?'edit-paragraph':'edit',{fingerprint:model.fingerprint,text,choices:{...choices},mode:editMode,index:editParagraphIndex,paragraphFormatting:editMode==='paragraph'?editDraftFormat:undefined});
    saveChoices();const previousScene=sceneIndex;model=result.comparison;choices=result.choices;sceneIndex=Math.min(previousScene,model.scenes.length-1);history=[];expanded.clear();activeChange=null;savedManuscript=null;currentExample=false;returnHomeAfterExport=false;query='';if(editMode==='paragraph'){const target=model.scenes.findIndex(s=>s.newStart!==null&&editParagraphIndex>=s.newStart&&editParagraphIndex<s.newStart+s.new.length);if(target>=0)sceneIndex=target;}
    files.new=null;updateFiles();saveChoices();renderWorkspace();await persistCurrent();$('edit-dialog').close();restoreEditScroll(editScroll);const restoredModel=model,position=editScroll;if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>{if(model===restoredModel&&!$('edit-dialog').open)restoreEditScroll(position)});toast('개고본을 갱신했습니다. 새로 바뀐 문단을 확인해 주세요.');
  }catch(e){$('editor-error').textContent=e.message}
  finally{editing=false;$('apply-editor').disabled=false}
}
async function downloadRevised(){
  if(!model||editing||exporting)return;
  try{const result=await callWorker('export-revised',{});download(result.name,result.buffer,mimeType(result.format));toast('직접 편집한 개고본 전체를 내려받습니다.')}
  catch(e){toast(e.message)}
}
const mimeType=format=>({hwp:'application/x-hwp',hwpx:'application/hwp+zip',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',txt:'text/plain;charset=utf-8'}[format]);
function showExport(forHome=false){if(!model)return;returnHomeAfterExport=forHome;const c=choiceCounts(model,choices),paragraphs=selectedParagraphs(model,choices);const name=model.original.name.replace(/\.(hwpx?|docx|txt)$/i,'').replace(/_(초고|원문|원본)$/,'')+'_선택원고';$('export-dialog').innerHTML=`<div class="dialog-heading"><h2>선택한 원고 저장</h2><button class="icon-btn" data-close="export-dialog" aria-label="닫기">×</button></div><div class="dialog-body export-form"><div class="export-stats"><div class="export-stat"><strong>${c.old}</strong>원문 유지</div><div class="export-stat"><strong>${c.rev}</strong>개고 채택</div><div class="export-stat"><strong>${c.pending}</strong>미선택</div></div>${c.pending?`<div class="export-warning">미선택 ${c.pending}개 구간은 원문으로 저장됩니다.</div>`:''}<label for="export-name">파일 이름</label><input id="export-name" class="export-name" value="${esc(name)}" maxlength="120"><p><b>${fmt(paragraphs.join('\n').length)}자</b> · 공백·줄바꿈 포함</p><label for="export-format">저장 형식</label><select id="export-format">${(model.exportFormats||["hwp","hwpx","docx","txt"]).map(f=>`<option value="${f}" ${f===model.outputFormat?"selected":""}>${f.toUpperCase()}</option>`).join("")}</select><p class="muted">선택한 본문과 빈 문단을 저장합니다. DOCX·HWPX는 선택한 문단의 기본 글꼴·크기·굵게·기울임·들여쓰기·정렬을 저장합니다. HWP·TXT는 서식을 보존하지 않습니다. 쪽 배치·이미지·표 모양은 재현하지 않습니다. 미선택 문단은 원문 서식을 사용합니다. TXT는 UTF-8로 저장하며 문단 안 줄바꿈도 일반 줄바꿈이 됩니다.</p></div><div class="dialog-footer"><button data-save="txt">TXT 저장</button><button class="primary" data-save="document">선택한 형식으로 내려받기 ↓</button></div>`;$('export-dialog').showModal()}
async function exportFile(requested){
  if(!model||exporting)return;
  const job=++operation,exportModel=model,snapshot=manuscriptSnapshot(),exportChoices={...choices},leaveAfter=returnHomeAfterExport;
  const selected=requested==='document'?$('export-format')?.value:requested;
  const format=['hwp','hwpx','docx','txt'].includes(selected)?selected:model.outputFormat;
  if(model.exportFormats&&!model.exportFormats.includes(format)){toast('이 비교에서 지원하지 않는 저장 형식입니다.');return}
  const title=($('export-name')?.value||'선택한 원고').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/\.(hwpx?|docx|txt)$/i,'').trim()||'선택한 원고';
  exporting=true;busy(true,'선택한 문장으로 '+format.toUpperCase()+'를 만들고 있습니다…');
  try{
    const result=await callWorker('export',{choices:exportChoices,format,title});
    if(job!==operation||model!==exportModel)return;
    download(title+'.'+format,result.buffer,mimeType(format));
    savedManuscript=snapshot;returnHomeAfterExport=false;$('export-dialog').close();
    toast('선택한 원고를 내려받습니다.');
    if(leaveAfter){exporting=false;requestHome()}
  }catch(e){if(job===operation)toast(e.message)}
  finally{if(job===operation){exporting=false;busy(false)}}
}

function showPage(page){if(!model)renderSavedReviews();const guide=page.startsWith('guide'),patches=page==='patchnotes';$('patchnotes')?.classList.toggle('hidden',!patches);$('guide')?.classList.toggle('hidden',!guide);$('home').classList.toggle('hidden',guide||patches||!!model);$('workspace').classList.toggle('hidden',guide||patches||!model);document.querySelectorAll('[data-page]').forEach(el=>{const active=el.dataset.page===(guide?'guide':patches?'patchnotes':'use');el.classList.toggle('active',active);el.setAttribute('aria-current',active?'page':'false')});if(page==='guide'||patches)window.scrollTo(0,0);else if(guide)document.getElementById(page)?.scrollIntoView({block:'start'})}
for(const side of ['old','new']){$('pick-'+side).onclick=()=>$(side+'-input').click();$(side+'-input').onchange=e=>setFile(side,e.target.files[0]);const target=$('pick-'+side);target.addEventListener('dragover',e=>{e.preventDefault();target.classList.add('dragover')});target.addEventListener('dragleave',()=>target.classList.remove('dragover'));target.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();target.classList.remove('dragover');if(e.dataTransfer.files.length!==1){toast('한 칸에 원고 파일 하나씩 놓아 주세요.');return}setFile(side,e.dataTransfer.files[0])});}
document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('drop',e=>{e.preventDefault();toast('원문 또는 개고본 칸에 파일을 놓아 주세요.')});
$('swap-btn').onclick=()=>{files={old:files.new,new:files.old};updateFiles()};$('compare-btn').onclick=()=>compare().catch(()=>{});$('demo-btn').onclick=()=>demo().catch(()=>{});$('cancel-btn').onclick=cancel;$('review-input').onchange=e=>{restore(e.target.files[0]);e.target.value=''};
document.addEventListener('click',e=>{const b=e.target.closest('button,a');if(!b)return;
  if(b.hasAttribute('data-delete-review')){requestDelete(b.dataset.deleteReview);return}
  if(b.hasAttribute('data-confirm-delete-review')){deleteReview();return}
  if(b.hasAttribute('data-format-run')){formatRun(b.dataset.formatRun);return}
  if(b.hasAttribute('data-edit-paragraph')){showEditor('paragraph',Number(b.dataset.editParagraph));return}
  if(b.hasAttribute('data-edit')){showEditor(b.dataset.edit);return}
  if(b.hasAttribute('data-apply-editor')){applyEditor();return}
  if(b.hasAttribute('data-close-editor')){closeEditor();return}
  if(b.hasAttribute('data-download-revised')){downloadRevised();return}
  if(b.hasAttribute('data-resume-review')){resumeReview(b.dataset.resumeReview);return}
  if(b.hasAttribute('data-clear-resume')){clearResume();return}
  if(b.hasAttribute('data-home')){e.preventDefault();requestHome();return}
  if(b.hasAttribute('data-leave-without-save')){$('leave-dialog').close();goHome();return}
  if(b.hasAttribute('data-save-before-home')){$('leave-dialog').close();showExport(true);return}
  if(b.hasAttribute('data-page')){e.preventDefault();location.hash=b.dataset.page;showPage(b.dataset.page)}
  if(b.hasAttribute('data-close')){if(b.dataset.close==='export-dialog'){returnHomeAfterExport=false;if(exporting)cancel()}$(b.dataset.close).close();return}
  if(b.hasAttribute('data-demo'))demo().catch(()=>{});
  if(!model)return;
  if(b.hasAttribute('data-scene'))navigate(Number(b.dataset.scene));
  if(b.hasAttribute('data-prev-scene'))navigate(sceneIndex-1);if(b.hasAttribute('data-next-scene'))navigate(sceneIndex+1);
  if(b.hasAttribute('data-next-pending'))jump(1,true);
  if(b.hasAttribute('data-choice')){activeChange=b.dataset.choice;const id=b.dataset.choice,value=b.dataset.value;applyChoices([[id,value]]);document.querySelector(`[data-choice="${id}"][data-value="${value}"]`)?.focus({preventScroll:true})}
  if(b.hasAttribute('data-scene-choice'))applyChoices(model.scenes[sceneIndex].segments.filter(g=>g.type==='change').map(g=>[g.id,b.dataset.sceneChoice]),'이 장면의 수정을 모두 '+(b.dataset.sceneChoice==='new'?'개고 채택':'원문 유지')+'으로 선택했습니다.');
  if(b.hasAttribute('data-view')){const anchor=visibleChange();full=b.dataset.view==='full';renderDiff(false);if(anchor)focusChange(anchor,false);saveChoices()}
  if(b.hasAttribute('data-gap')){const id=b.dataset.gap,section=b.closest('[data-context]'),offset=section.getBoundingClientRect().top;expanded.has(id)?expanded.delete(id):expanded.add(id);renderDiff(false);const fresh=document.querySelector(`[data-context="${id}"]`);if(fresh){const pane=$('diff-pane');pane.style.scrollBehavior='auto';pane.scrollTop+=fresh.getBoundingClientRect().top-offset;pane.style.scrollBehavior=''}}
  if(b.hasAttribute('data-font')){font=Math.max(14,Math.min(24,font+Number(b.dataset.font)));document.documentElement.style.setProperty('--font-size',font+'px');$('font-output').textContent=font;saveChoices()}
  if(b.hasAttribute('data-backup'))backup();if(b.hasAttribute('data-restore'))$('review-input').click();if(b.hasAttribute('data-undo'))undo();if(b.hasAttribute('data-export'))showExport();if(b.hasAttribute('data-save'))exportFile(b.dataset.save);
});
document.addEventListener('keydown',e=>{if(!model||document.querySelector('dialog[open]')||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||!e.altKey||e.ctrlKey||e.metaKey)return;if(e.key==='ArrowLeft'){e.preventDefault();navigate(sceneIndex-1)}if(e.key==='ArrowRight'){e.preventDefault();navigate(sceneIndex+1)}if(e.key==='ArrowUp'){e.preventDefault();jump(-1)}if(e.key==='ArrowDown'){e.preventDefault();jump(1)}});
$('edit-dialog').addEventListener('cancel',e=>{e.preventDefault();closeEditor()});
$('manuscript-editor').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.shiftKey){e.preventDefault();e.target.setRangeText('\u2028',e.target.selectionStart,e.target.selectionEnd,'end')}});
$('export-dialog').addEventListener('cancel',()=>{returnHomeAfterExport=false;if(exporting)cancel()});
window.addEventListener('storage',e=>{if(e.key===null||e.key?.startsWith(REVIEW_PREFIX))renderSavedReviews()});
window.addEventListener('hashchange',()=>showPage(location.hash.slice(1)));window.addEventListener('beforeunload',saveChoices);
export const application={demo,showPage:page=>{location.hash=page;showPage(page)},getSummary:()=>model?{fingerprint:model.fingerprint,scenes:model.scenes.length,changes:model.totalChanges,...choiceCounts(model,choices)}:{loaded:false},choose:items=>applyChoices(items),openExport:showExport};
export function initialize(){showPage(location.hash.slice(1)||'use');updateFiles()}
