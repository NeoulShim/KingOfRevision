import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {writeHwpx,readHwpx} from '../src/core/hwpx.js';
import {compareDocuments,splitScenes} from '../src/core/compare.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await mkdir(path.join(root,'public/examples'),{recursive:true});
const docs=[];
for(const version of ['원문','개고안']){
  const name='한_쪽이_너무_유리한_게임_'+version;
  const text=await readFile(path.join(root,'examples',name+'.txt'),'utf8');
  const paragraphs=text.replace(/\r\n/g,'\n').split('\n');
  const bytes=writeHwpx(paragraphs,{title:'한 쪽이 너무 유리한 게임 — '+version});
  await writeFile(path.join(root,'examples',name+'.hwpx'),bytes);
  await writeFile(path.join(root,'public/examples',name+'.hwpx'),bytes);
  const parsed=readHwpx(bytes,name+'.hwpx');
  if(JSON.stringify(parsed.paragraphs)!==JSON.stringify(paragraphs))throw Error('Example round-trip failed.');
  docs.push(parsed);
  console.log(version,parsed.characters+'자',splitScenes(paragraphs).length+'장면',bytes.length+'bytes');
}
const result=compareDocuments(...docs);
await writeFile(path.join(root,'examples/예제_정보.json'),JSON.stringify({title:'한 쪽이 너무 유리한 게임',author:'심너울',revision:'시연용 AI 개고안',scenes:result.scenes.length,changes:result.totalChanges,originalCharacters:docs[0].characters,revisedCharacters:docs[1].characters},null,2));
console.log('비교 구간:',result.totalChanges);
