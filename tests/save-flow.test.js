import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const controller=(await readFile(new URL('../src/controller.js',import.meta.url),'utf8'))
  .replace(/^import .*;\r?$/gm,'').replace(/\bexport /g,'').replaceAll('import.meta','({url:"file:///controller.js",env:{BASE_URL:"/"}})');
function harness(){
  const nodes=new Map(),listeners=new Map(),downloads=[],storage=new Map();
  function node(id){if(!nodes.has(id))nodes.set(id,{id,open:false,value:id==='export-name'?'테스트 원고':'',textContent:'',innerHTML:'',classList:{toggle(){},add(){},remove(){}},events:{},addEventListener(type,fn){this.events[type]=fn},showModal(){this.open=true},close(){this.open=false},click(){},setAttribute(){}});return nodes.get(id)}
  const context=vm.createContext({
    document:{getElementById:node,querySelectorAll:()=>[],querySelector:()=>null,addEventListener:(type,fn)=>listeners.set(type,fn)},
    window:{addEventListener(){},scrollTo(){}},location:{hash:'use'},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    setTimeout:()=>1,clearTimeout(){},URL,Blob,console,
    choiceCounts:()=>({old:0,rev:1,pending:0}),selectedParagraphs:()=>['선택한 문장'],validateChoices:(_m,c)=>({...c}),
    workerCall:async()=>({buffer:new Uint8Array([1,2])}),recordDownload:(...args)=>downloads.push(args)
  });
  vm.runInContext(controller+`\ncallWorker=(...args)=>workerCall(...args);download=(...args)=>recordDownload(...args);
    globalThis.api={requestHome,showExport,exportFile,cancel,backup,loadChoices,
      setModel(value){model=value},setChoices(value){choices=value},
      state(){return {model,choices,savedManuscript,exporting,returnHomeAfterExport}},
      changed(){return needsManuscriptSave()}};`,context);
  const model={fingerprint:'same-documents',original:{name:'원문.hwpx'},revised:{name:'개고.hwpx'},outputFormat:'hwpx',scenes:[{changes:1}]};
  context.api.setModel(model);context.api.setChoices({p:'new'});
  const click=attrs=>{const dataset=Object.fromEntries(Object.entries(attrs).map(([k,v])=>[k.replace(/^data-/,'').replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v]));const b={dataset,hasAttribute:name=>name in attrs};listeners.get('click')({target:{closest:()=>b},preventDefault(){}})};
  return {api:context.api,context,node,downloads,model,click};
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
