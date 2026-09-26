import test from 'node:test';
import assert from 'node:assert/strict';
import {installAnalytics} from '../src/analytics.js';
test('custom domain uses its own token and excludes unrelated paths',()=>{for(const host of ['neoulshim.kr','www.neoulshim.kr']){let script;const doc={getElementById:()=>null,createElement:()=>({setAttribute(k,v){this[k]=v}}),head:{appendChild(s){script=s}}};assert.equal(installAnalytics('46fad0ec45c24702af8b85af375aa8db',{location:{hostname:host,pathname:'/kingofrevision/'}},doc),true);assert.equal(JSON.parse(script['data-cf-beacon']).token,'81b9b24929344e8c90393e8775e8f0bf');assert.equal(installAnalytics('46fad0ec45c24702af8b85af375aa8db',{location:{hostname:host,pathname:'/portfolio/'}},doc),false)}});
