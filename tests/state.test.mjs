import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../scripts/pipeline.mjs';
import {validateState,validateTransition,parseAndValidateState} from '../scripts/state.mjs';
test('v2 state validates and malformed JSON is reported',()=>{assert.deepEqual(validateState(createState({reviewId:'test',topic:'Test'})),[]);assert.ok(parseAndValidateState('{').errors.length);});
test('direct mutations disabled including legacy transitions',()=>{assert.match(validateTransition({schemaVersion:1},{}).join(),/read-only/);});
