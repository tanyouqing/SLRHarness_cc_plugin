import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

test('default manuscript length is 6000–15000 words across writing instructions and conference guides',()=>{
  const base=new URL('../',import.meta.url);
  const library=new URL('skills/paper/template/library/',base);
  const files=['README.md','skills/paper/SKILL.md','skills/paper/references/paper-template.md',
    ...readdirSync(library,{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>`skills/paper/template/library/${d.name}/survey/guide.md`)];
  for(const file of files){
    const text=readFileSync(new URL(file,base),'utf8');
    assert.match(text,/6,000–15,000 words/,file);
    assert.doesNotMatch(text,/6,000–9,000/,file);
  }
  const skill=readFileSync(new URL('skills/paper/SKILL.md',base),'utf8');
  assert.match(skill,/words excluding references/);
  assert.match(skill,/Resume\/revise preserve existing settings/);
});
