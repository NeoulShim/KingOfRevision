import test from 'node:test';
import assert from 'node:assert/strict';
import {installAnalytics} from '../src/analytics.js';
const token='1234567890abcdef1234567890abcdef';
function environment(hostname='neoulshim.github.io',pathname='/KingOfRevision/') {
 const scripts=[];
 return {scripts,win:{location:{hostname,pathname}},doc:{getElementById:id=>scripts.find(s=>s.id===id),createElement:tag=>({tag,setAttribute(k,v){this[k]=v}}),head:{appendChild(s){scripts.push(s)}}}};
}
test('analytics loads once only on the public app and sends only the site token/config',()=>{
 const e=environment();assert.equal(installAnalytics(token,e.win,e.doc),true);
 assert.equal(installAnalytics(token,e.win,e.doc),false);assert.equal(e.scripts.length,1);
 assert.equal(e.scripts[0].src,'https://static.cloudflareinsights.com/beacon.min.js');
 assert.deepEqual(JSON.parse(e.scripts[0]['data-cf-beacon']),{token,spa:false});
});
test('analytics never loads on local/private previews, other projects, or without a valid token',()=>{
 for(const [host,path] of [['127.0.0.1','/KingOfRevision/'],['revision-king.softlungsgame.chatgpt.site','/'],['neoulshim.github.io','/NeoulCrawl/']]){const e=environment(host,path);assert.equal(installAnalytics(token,e.win,e.doc),false);assert.equal(e.scripts.length,0)}
 const e=environment();assert.equal(installAnalytics('',e.win,e.doc),false);assert.equal(e.scripts.length,0);
});
