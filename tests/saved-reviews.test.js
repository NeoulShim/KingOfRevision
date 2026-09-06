import test from 'node:test';
import assert from 'node:assert/strict';
import {REVIEW_PREFIX,reviewRecord,savedReviews} from '../src/core/saved-reviews.js';
function storage(entries){const map=new Map(Object.entries(entries));return {get length(){return map.size},key:i=>[...map.keys()][i],getItem:key=>map.get(key)}}
const model={fingerprint:'a',original:{name:'원문.hwpx',paragraphs:['저장하지 않을 본문']},revised:{name:'개고.hwpx',paragraphs:['다른 본문']},scenes:[{}],totalChanges:4};
test('history metadata contains file names and progress but no manuscript text',()=>{
  const record=reviewRecord(model,{choices:{one:'new'},sceneIndex:0,full:false,font:17},null,100);
  assert.equal(record.metadata.originalName,'원문.hwpx');assert.equal(record.metadata.updatedAt,100);
  assert(!JSON.stringify(record).includes('본문'));assert.equal(record.metadata.totalChanges,4);
  assert.equal(reviewRecord(model,{choices:{}},record,200).metadata.createdAt,100);
});
test('saved comparisons include legacy records and are sorted by latest save',()=>{
  const entries=storage({[REVIEW_PREFIX+'old']:JSON.stringify({choices:{a:'old'},sceneIndex:2}),[REVIEW_PREFIX+'a']:JSON.stringify(reviewRecord(model,{choices:{a:'new'}},null,100)),[REVIEW_PREFIX+'b']:JSON.stringify(reviewRecord(model,{choices:{a:'new',b:'old'},sceneIndex:1},null,200))});
  const rows=savedReviews(entries);assert.deepEqual(rows.map(r=>r.fingerprint),['b','a','old']);assert.equal(rows[0].done,2);assert.equal(rows[2].total,null);assert.equal(rows[2].sceneIndex,2);assert.equal(rows[2].originalName,'이름 정보가 없는 이전 원문');
});
test('malformed or unrelated storage entries do not hide valid comparisons',()=>{
  const rows=savedReviews(storage({unrelated:'private',[REVIEW_PREFIX+'broken']:'{',[REVIEW_PREFIX+'bad']:'{"choices":[]}',[REVIEW_PREFIX+'valid']:JSON.stringify({choices:{a:'new',b:'invalid'},metadata:{updatedAt:1e99,totalChanges:-2,originalName:42}})}));
  assert.equal(rows.length,1);assert.equal(rows[0].done,1);assert.equal(rows[0].updatedAt,null);assert.equal(rows[0].total,null);
});
test('example markers survive listing while ordinary comparisons require original files',()=>{
  const rows=savedReviews(storage({[REVIEW_PREFIX+'example']:JSON.stringify(reviewRecord(model,{choices:{},example:true},null,100)),[REVIEW_PREFIX+'ordinary']:JSON.stringify(reviewRecord(model,{choices:{}},null,50))}));
  assert.equal(rows[0].example,true);assert.equal(rows[1].example,false);
});
test('inaccessible browser storage reports failure instead of pretending records are empty',()=>{
  assert.throws(()=>savedReviews({get length(){throw Error('Storage blocked')}}),/Storage blocked/);
});
