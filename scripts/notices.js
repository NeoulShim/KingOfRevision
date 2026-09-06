import {readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
const root=new URL('../',import.meta.url);
const lock=JSON.parse(await readFile(new URL('package-lock.json',root),'utf8'));
let output='퇴고의 제왕 — Third-party notices\n\nApplication: MIT, Copyright (c) 2026 NeoulShim.\n\n';
for(const [dir,pkg] of Object.entries(lock.packages)){
  if(!dir||pkg.dev||pkg.optional)continue;
  const files=await readdir(new URL(dir+'/',root));
  const licenses=files.filter(n=>/^(licen[sc]e|copying|notice)(\.|-|$)/i.test(n));
  if(!licenses.length&&dir!=='node_modules/@nodable/entities')throw Error('Missing license: '+dir);
  output+='\n'+dir.replace('node_modules/','')+' '+pkg.version+'\n'+ '='.repeat(55)+'\n';
  for(const name of licenses)output+=await readFile(new URL(dir+'/'+name,root),'utf8')+'\n';
  if(dir==='node_modules/@nodable/entities')output+=await readFile(new URL('assets/nodable-LICENSE.txt',root),'utf8')+'\n';
}
output+='\nHWPX skeleton: python-hwpx (https://github.com/airmang/python-hwpx)\n';
output+='The embedded template is adapted from src/hwpx/data/Skeleton.hwpx. Fonts and metadata were normalized and preview content removed.\n\n';
output+=await readFile(new URL('assets/python-hwpx-LICENSE.txt',root),'utf8');
output+='\n'+await readFile(new URL('assets/python-hwpx-NOTICE.txt',root),'utf8');
await writeFile(new URL('THIRD_PARTY_NOTICES.txt',root),output);
await writeFile(new URL('public/THIRD_PARTY_NOTICES.txt',root),output);
console.log('Third-party notices written.');
