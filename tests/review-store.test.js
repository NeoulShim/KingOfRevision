import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {createReviewStore,formatBytes} from '../src/core/review-store.js';
const session=fp=>({fingerprint:fp,documents:{original:{paragraphs:['원문']},revised:{paragraphs:['개고']}},manuallyEdited:true});
test('IndexedDB commits manuscript and choices together, reopens and updates choices without losing text',async()=>{
  const factory=new IDBFactory(),store=createReviewStore(factory),review={choices:{a:'new'},sceneIndex:2};
  await store.putSession(session('one'),review);await store.close();const reopened=createReviewStore(factory);
  const saved=await reopened.getSession('one');assert.deepEqual(saved.documents,session('one').documents);assert.deepEqual(saved.review,review);
  await reopened.putReview('one',{choices:{a:'old'},sceneIndex:3});assert.equal((await reopened.getSession('one')).review.sceneIndex,3);
  const list=await reopened.list();assert.equal(list.length,1);assert(!JSON.stringify(list).includes('paragraphs'));await reopened.close();
});
test('deleting one saved comparison removes both body and choices and keeps other comparisons',async()=>{
  const store=createReviewStore(new IDBFactory());await store.putSession(session('one'),{choices:{}});await store.putSession(session('two'),{choices:{a:'new'}});
  await store.remove('one');assert.equal(await store.getSession('one'),null);assert.deepEqual((await store.list()).map(r=>r.fingerprint),['two']);assert(await store.getSession('two'));await store.close();
});
test('failed transaction leaves the previous manuscript and review intact',async()=>{
  const store=createReviewStore(new IDBFactory());await store.putSession(session('one'),{choices:{a:'old'}});
  await assert.rejects(store.putSession({...session('one'),documents:{original:{paragraphs:['다른 글']}}},{invalid:()=>{}}));
  const saved=await store.getSession('one');assert.deepEqual(saved.documents,session('one').documents);assert.deepEqual(saved.review,{choices:{a:'old'}});await store.close();
});
test('unavailable browser storage fails explicitly; byte formatting handles real quota values',async()=>{
  await assert.rejects(createReviewStore(null).list(),/허용하지/);assert.equal(formatBytes(1024),'1.0 KB');assert.equal(formatBytes(5*1048576),'5.0 MB');assert.equal(formatBytes(undefined),'확인 불가');
});
