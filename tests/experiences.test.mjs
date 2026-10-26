import test from 'node:test';
import assert from 'node:assert/strict';
import {validateExperiences,EXPERIENCE_ROLES,EXPERIENCE_SOURCE_TYPES} from '../scripts/experiences.mjs';
const entry={sourceType:'review',role:'worker',executionSummary:'Dataset versions are absent from the comparison.',strategy:'Record dataset versions with reported metrics.'};
test('shared experience contract accepts both origins and all four exact roles with only required fields',()=>{
  for(const sourceType of EXPERIENCE_SOURCE_TYPES)for(const role of EXPERIENCE_ROLES) {
    const value={experiences:[{...entry,sourceType,role}]};assert.equal(validateExperiences(value),value);
  }
  assert.deepEqual(validateExperiences({experiences:[]}),{experiences:[]});
  const value={experiences:[{...entry,stage:'reading',task:'Extract results',applicability:'Empirical comparisons'}]};
  assert.equal(validateExperiences(value,{sourceType:'review'}),value);
  for(const blank of [null,'',' ']) {
    const optionalEmpty={experiences:[{...entry,stage:blank,task:blank,applicability:blank}]};
    assert.equal(validateExperiences(optionalEmpty,{sourceType:'review'}),optionalEmpty);
  }
});
test('shared contract rejects missing, malformed, unknown and incorrectly cased parameters',()=>{
  for(const key of Object.keys(entry))for(const invalid of [undefined,null,'',42]) {
    const e={...entry};if(invalid===undefined)delete e[key];else e[key]=invalid;
    assert.throws(()=>validateExperiences({experiences:[e]}));
  }
  for(const value of [null,[],{}, {experiences:{}}, {experiences:[null]}, {experiences:[],extra:true}])assert.throws(()=>validateExperiences(value));
  for(const e of [{...entry,role:'Worker'},{...entry,role:'checker'},{...entry,sourceType:'unknown'},{...entry,differenceId:'diff-1'},{...entry,applicability:[]}])
    assert.throws(()=>validateExperiences({experiences:[e]}));
  assert.throws(()=>validateExperiences({experiences:[{...entry,sourceType:'trajectory'}]},{sourceType:'review'}),/sourceType review/);
});
