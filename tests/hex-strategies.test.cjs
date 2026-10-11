'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const S=require('../hex-strategies.js'),copy=x=>structuredClone(x);
const sample=()=>({version:1,profiles:[copy(S.DEFAULT_CONFIG.profiles[0])]});
function rejects(edit,pattern=/策略 JSON/){const c=sample();edit(c);assert.throws(()=>S.normalize(c),pattern);}

test('strategy JSON defaults match checked-in data and normalize to a detached canonical configuration',()=>{
  const disk=JSON.parse(fs.readFileSync(path.join(__dirname,'../config/hex-strategies.json'),'utf8'));
  assert.deepEqual(S.normalize(disk),S.normalize(S.DEFAULT_CONFIG));assert.equal(S.id(disk),S.id(S.DEFAULT_CONFIG));
  assert.ok(Object.isFrozen(S.DEFAULT_CONFIG.profiles[0].route));
  const normalized=S.normalize(disk);normalized.profiles[0].route.side=1;
  assert.equal(disk.profiles[0].route.side,0);assert.equal(S.DEFAULT_CONFIG.profiles[0].route.side,0);
  const reordered={profiles:disk.profiles.map(p=>Object.fromEntries(Object.entries(p).reverse())),version:1};
  assert.equal(S.id(reordered),S.id(disk));assert.notEqual(S.id(normalized),S.id(disk));
  assert.deepEqual(S.resolve(disk,'airhead'),disk.profiles[1]);assert.throws(()=>S.resolve(disk,'missing'),/strategyIds/);
});

test('strategy parser rejects malformed, oversized, unsupported and executable-looking structures atomically',()=>{
  for(const value of ['{',JSON.stringify({version:2,profiles:[]}),JSON.stringify({version:1,profiles:[]}), ' '.repeat(S.MAX_BYTES+1)])assert.throws(()=>S.normalize(value),/策略 JSON/);
  rejects(c=>{c.script='return fetch(secret)';},/不支援欄位 script/);
  rejects(c=>{c.profiles[0].route.evaluate=()=>42;},/不支援欄位 evaluate/);
  rejects(c=>{c.profiles[0].constructor={};},/不支援欄位 constructor/);
  const proto=JSON.parse(JSON.stringify(sample()).replace('"version":1','"version":1,"__proto__":{"polluted":true}'));
  assert.throws(()=>S.normalize(proto),/不支援欄位 __proto__/);assert.equal({}.polluted,undefined);
  rejects(c=>{delete c.profiles[0].airport;},/缺少必要欄位/);
  rejects(c=>{c.profiles[0]=new Date();},/普通物件/);
});

test('all mission programs enforce finite integer budgets, known enums, unique IDs and bounded names',()=>{
  for(const value of [NaN,Infinity,-Infinity,2.5,-1,19])rejects(c=>{c.profiles[0].route.maxDetour=value;});
  for(const [field,bad] of [['side',2],['transport','teleport']])rejects(c=>{c.profiles[0].route[field]=bad;});
  for(const [field,bad] of [['mode','always'],['projection','nuke'],['maxOwnActions',25],['maxSetupCost',37]])rejects(c=>{c.profiles[0].airport[field]=bad;});
  for(const [field,bad] of [['reviewOwnTurns',9],['stalledOwnTurns',7],['maxOwnTurns',37]])rejects(c=>{c.profiles[0].commitment[field]=bad;});
  for(const [field,bad] of [['id','__proto__'],['id','Bad ID'],['name','x'.repeat(33)],['name','bad\nname'],['mission','arbitrary'],['diplomacy','forced']])rejects(c=>{c.profiles[0][field]=bad;});
  rejects(c=>{c.profiles.push(copy(c.profiles[0]));},/不可重複/);
  rejects(c=>{c.profiles=Array.from({length:13},(_,i)=>({...copy(c.profiles[0]),id:'p'+i}));});
  const c=sample();Object.assign(c.profiles[0].route,{side:-1,transport:'tunnel',maxDetour:18});Object.assign(c.profiles[0].airport,{maxOwnActions:6,maxSetupCost:36});Object.assign(c.profiles[0].commitment,{reviewOwnTurns:8,stalledOwnTurns:6,maxOwnTurns:36});assert.deepEqual(S.normalize(c),c);
});

test('normalization never invokes accessors or custom array methods and rejects sparse profile lists',()=>{
  let executed=0;
  for(const make of [
    ()=>{const c=sample();Object.defineProperty(c.profiles[0].route,'side',{get(){executed++;return 0;}});return c;},
    ()=>{const c=sample();Object.defineProperty(c.profiles,0,{get(){executed++;return S.DEFAULT_CONFIG.profiles[0];}});return c;},
    ()=>{const c=sample();c.profiles.map=()=>{executed++;return [];};return c;},
    ()=>{const c=sample();c.profiles=Array(1);return c;}
  ])assert.throws(()=>S.normalize(make()),/策略 JSON/);
  assert.equal(executed,0);
});
