import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {writeHwpx} from '../src/core/hwpx.js';
test('HWPX generated formatting IDs do not collide with template or snapToGrid attributes',()=>{
 const z=unzipSync(writeHwpx(['첫 문단','둘째 문단'],{formatting:[{paragraph:{firstLine:12},runs:[{text:'첫 문단',style:{bold:true}}]},{paragraph:{align:'center'},runs:[{text:'둘째 문단',style:{italic:true}}]}]}));
 const h=strFromU8(z['Contents/header.xml']),s=strFromU8(z['Contents/section0.xml']);
 for(const tag of ['paraPr','charPr']){const ids=[...h.matchAll(new RegExp('<hh:'+tag+'\\s+id="(\\d+)"','g'))].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length)}
 const refs=[...s.matchAll(/paraPrIDRef="(\d+)"/g)].map(m=>+m[1]);assert(refs.every(n=>n>=20));
 for(const id of refs){const style=h.match(new RegExp('<hh:paraPr id="'+id+'"[\\s\\S]*?</hh:paraPr>'))[0];assert(style.includes('<hh:heading type="NONE"'))}
});
