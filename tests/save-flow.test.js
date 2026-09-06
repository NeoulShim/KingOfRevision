import {editorText} from '../src/core/editing.js';
import {REVIEW_PREFIX,reviewRecord,savedReviews} from '../src/core/saved-reviews.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const controller=(await readFile(new URL('../src/controller.js',import.meta.url),'utf8'))
  .replace(/^import .*;\r?$/gm,'').replace(/\bexport /g,'').replaceAll('import.meta','({url:"file:///controller.js",env:{BASE_URL:"/"}})');
function harness(){
  const nodes=new Map(),listeners=new Map(),downloads=[],storage=new Map();
  function node(id){if(!nodes.has(id))nodes.set(id,{id,open:false,value:id==='export-name'?'테스트 원고':'',textContent:'',innerHTML:'',classList:{toggle(){},add(){},remove(){}},events:{},addEventListener(type,fn){this.events[type]=fn},showModal(){this.open=true},close(){this.open=false},focus(){},click(){},setAttribute(){}});return nodes.get(id)}
  const context=vm.createContext({
    document:{getElementById:node,querySelectorAll:()=>[],querySelector:()=>null,addEventListener:(type,fn)=>listeners.set(type,fn)},
    window:{addEventListener(){},scrollTo(){},confirm:()=>false},location:{hash:'use'},localStorage:{get length(){return storage.size},key:i=>[...storage.keys()][i]??null,getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    setTimeout:()=>1,clearTimeout(){},URL,Blob,console,editorText,REVIEW_PREFIX,reviewRecord,savedReviews,
    choiceCounts:()=>({old:0,rev:1,pending:0}),selectedParagraphs:()=>['선택한 문장'],validateChoices:(_m,c)=>({...c}),
    workerCall:async()=>({buffer:new Uint8Array([1,2])}),recordDownload:(...args)=>downloads.push(args)
  });
  vm.runInContext(controller+`\ncallWorker=(...args)=>workerCall(...args);download=(...args)=>recordDownload(...args);
    globalThis.api={requestHome,showExport,exportFile,cancel,backup,loadChoices,saveChoices,resumeReview,compare,showEditor,applyEditor,closeEditor,
      setFiles(value){files=value},
      setModel(value){model=value},setChoices(value){choices=value},
      state(){return {model,choices,savedManuscript,exporting,returnHomeAfterExport,resumeTarget,sceneIndex}},
      changed(){return needsManuscriptSave()}};`,context);
  const model={fingerprint:'same-documents',original:{name:'원문.hwpx'},revised:{name:'개고.hwpx'},outputFormat:'hwpx',scenes:[{changes:1}]};
  context.api.setModel(model);context.api.setChoices({p:'new'});
  const click=attrs=>{const dataset=Object.fromEntries(Object.entries(attrs).map(([k,v])=>[k.replace(/^data-/,'').replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v]));const b={dataset,hasAttribute:name=>name in attrs};listeners.get('click')({target:{closest:()=>b},preventDefault(){}})};
  return {api:context.api,context,node,downloads,model,click,storage};
}
test('logo prompts before leaving an unsaved manuscript; continue keeps the comparison',()=>{
  const h=harness();h.click({'data-home':''});assert.equal(h.node('leave-dialog').open,true);assert.equal(h.api.state().model,h.model);
  h.click({'data-close':'leave-dialog'});assert.equal(h.node('leave-dialog').open,false);assert.equal(h.api.state().model,h.model);
});
test('leaving without saving returns home without downloading',()=>{
  const h=harness();h.api.requestHome();h.click({'data-leave-without-save':''});assert.equal(h.api.state().model,null);assert.equal(h.downloads.length,0);
});
test('save before returning home waits for a successful manuscript download',async()=>{
  const h=harness();h.api.requestHome();h.click({'data-save-before-home':''});assert.equal(h.node('export-dialog').open,true);assert.equal(h.api.state().model,h.model);
  await h.api.exportFile('document');assert.equal(h.downloads[0][0],'테스트 원고.hwpx');assert.equal(h.api.state().model,null);
});
test('failed export keeps the manuscript and permits retrying before leaving',async()=>{
  const h=harness();h.api.showExport(true);h.context.workerCall=async()=>{throw Error('저장 실패')};await h.api.exportFile('document');
  assert.equal(h.api.state().model,h.model);assert.equal(h.api.changed(),true);assert.equal(h.node('export-dialog').open,true);assert.equal(h.downloads.length,0);
  h.context.workerCall=async()=>({buffer:new Uint8Array([1])});await h.api.exportFile('document');assert.equal(h.api.state().model,null);
});
test('closing or escaping the export dialog cancels the pending return home',async()=>{
  for(const escape of [false,true]){const h=harness();h.api.showExport(true);
    if(escape){h.node('export-dialog').events.cancel();h.node('export-dialog').close()}else h.click({'data-close':'export-dialog'});
    assert.equal(h.api.state().model,h.model);assert.equal(h.api.state().returnHomeAfterExport,false);
    h.api.showExport();await h.api.exportFile('document');assert.equal(h.api.state().model,h.model);
  }
});
test('unchanged saved choices skip the prompt; later edits require another save',async()=>{
  const h=harness();h.api.setChoices({b:'old',a:'new'});h.api.showExport();await h.api.exportFile('document');
  h.api.setChoices({a:'new',b:'old'});assert.equal(h.api.changed(),false);
  h.api.setChoices({a:'old',b:'old'});h.api.requestHome();assert.equal(h.node('leave-dialog').open,true);
  h.node('leave-dialog').close();h.api.setChoices({a:'new',b:'old'});h.api.requestHome();assert.equal(h.api.state().model,null);
});
test('selection backup is not a manuscript save, and a reopened comparison starts unsaved',async()=>{
  const h=harness();h.api.backup();assert.equal(h.api.changed(),true);
  h.api.showExport();await h.api.exportFile('txt');assert.equal(h.api.changed(),false);
  h.api.loadChoices();assert.equal(h.api.changed(),true);
});
test('cancelling file generation keeps the review and ignores its late result',async()=>{
  const h=harness();let finish;h.context.workerCall=()=>new Promise(resolve=>{finish=resolve});h.api.showExport(true);
  const task=h.api.exportFile('document');h.api.cancel();finish({buffer:new Uint8Array([1])});await task;
  assert.equal(h.api.state().model,h.model);assert.equal(h.api.changed(),true);assert.equal(h.downloads.length,0);assert.equal(h.api.state().exporting,false);
});
test('changes made during export remain unsaved instead of being discarded on return home',async()=>{
  const h=harness();let finish;h.context.workerCall=()=>new Promise(resolve=>{finish=resolve});h.api.showExport(true);
  const task=h.api.exportFile('document');h.api.setChoices({p:'old'});finish({buffer:new Uint8Array([1])});await task;
  assert.equal(h.api.changed(),true);assert.equal(h.api.state().model,h.model);assert.equal(h.node('leave-dialog').open,true);assert.equal(h.downloads.length,1);
});

test('escaping while generating a file prevents a late download or automatic exit',async()=>{
  const h=harness();let finish;h.context.workerCall=()=>new Promise(resolve=>{finish=resolve});h.api.showExport(true);
  const task=h.api.exportFile('document');h.node('export-dialog').events.cancel();h.node('export-dialog').close();finish({buffer:new Uint8Array([1])});await task;
  assert.equal(h.api.state().model,h.model);assert.equal(h.api.changed(),true);assert.equal(h.downloads.length,0);assert.equal(h.api.state().returnHomeAfterExport,false);
});

test('home lists saved comparisons with escaped filenames and their progress',()=>{
  const h=harness();h.model.totalChanges=3;h.model.original.name='<img src=x onerror=bad>.hwpx';h.api.saveChoices();h.click({'data-leave-without-save':''});
  const html=h.node('saved-review-list').innerHTML;assert(html.includes('&lt;img'));assert(!html.includes('<img'));assert(html.includes('검토 1 / 3'));
});
test('resuming a history entry rejects different documents without modifying its saved choices',async()=>{
  const h=harness();h.model.totalChanges=1;h.api.saveChoices();h.click({'data-leave-without-save':''});const before=h.storage.get(REVIEW_PREFIX+h.model.fingerprint);
  h.api.resumeReview(h.model.fingerprint);h.api.setFiles({old:{name:'다른 원문.hwpx',arrayBuffer:async()=>new ArrayBuffer(0)},new:{name:'다른 개고.hwpx',arrayBuffer:async()=>new ArrayBuffer(0)}});
  h.context.workerCall=async()=>({fingerprint:'different'});await h.api.compare();
  assert.equal(h.api.state().model,null);assert.equal(h.api.state().resumeTarget,h.model.fingerprint);assert.equal(h.storage.get(REVIEW_PREFIX+h.model.fingerprint),before);assert(h.node('toast').textContent.includes('다릅니다'));
});

test('matching files restore the selected history record and last scene',async()=>{
  const h=harness(),key=REVIEW_PREFIX+h.model.fingerprint;
  h.storage.set(key,JSON.stringify({choices:{p:'old'},sceneIndex:1,full:true,font:19}));h.api.setModel(null);h.api.resumeReview(h.model.fingerprint);
  h.api.setFiles({old:{name:'원문.hwpx',arrayBuffer:async()=>new ArrayBuffer(0)},new:{name:'개고.hwpx',arrayBuffer:async()=>new ArrayBuffer(0)}});
  const result={...h.model,totalChanges:1,scenes:[{changes:1},{changes:0}]};h.context.workerCall=async()=>result;
  vm.runInContext('renderWorkspace=()=>{}',h.context);await h.api.compare();
  assert.equal(h.api.state().choices.p,'old');assert.equal(h.api.state().sceneIndex,1);assert.equal(h.api.state().resumeTarget,null);assert.equal(h.api.state().model,result);
});

test('editor keeps an unapplied draft when closing is declined',()=>{
  const h=harness();h.model.scenes=[{new:['개고 첫 문장',''],changes:1}];h.api.showEditor('revised');
  assert.equal(h.node('manuscript-editor').value,'개고 첫 문장\n');h.node('manuscript-editor').value+='직접 쓴 글';h.api.closeEditor();assert.equal(h.node('edit-dialog').open,true);
  h.context.window.confirm=()=>true;h.api.closeEditor();assert.equal(h.node('edit-dialog').open,false);
});
test('failed editing retains the draft; applying updates the comparison and unsaved state',async()=>{
  const h=harness();h.model.totalChanges=1;h.model.scenes=[{new:['개고 첫 문장'],changes:1}];h.api.showEditor('revised');h.node('manuscript-editor').value='직접 쓴 문장';
  h.context.workerCall=async()=>{throw Error('편집 실패')};await h.api.applyEditor();assert.equal(h.api.state().model,h.model);assert.equal(h.node('edit-dialog').open,true);assert.equal(h.node('manuscript-editor').value,'직접 쓴 문장');assert.equal(h.node('apply-editor').disabled,false);
  const next={...h.model,fingerprint:'edited',manuallyEdited:true,revised:{name:'개고_직접개고.hwpx'},scenes:[{new:['직접 쓴 문장'],changes:1}]};h.context.workerCall=async()=>({comparison:next,choices:{}});vm.runInContext('renderWorkspace=()=>{}',h.context);
  await h.api.applyEditor();assert.equal(h.api.state().model,next);assert.equal(h.api.changed(),true);assert.equal(h.node('edit-dialog').open,false);assert(h.storage.has(REVIEW_PREFIX+'edited'));
});
