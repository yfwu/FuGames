'use strict';
// These fixtures document replaced normal-Hex semantics. They deliberately do
// not load the current page, and are not evidence that shared-core rules pass.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../fixtures/card_hex-96c109a.html'),'utf8');
assert.equal(crypto.createHash('sha256').update(source).digest('hex'),'740e18b32a467ab9ff87613caff8b1b9501acfaac30d9bfb96c1ba5ee5ed7ac0','Historical source must remain the exact released96c109a HTML');
const engine=source.match(/<script id="hex-engine">([\s\S]*?)<\/script>/)[1];
exports.loadHistoricalHex=(realm='vm')=>realm==='function'?new Function(engine+';return CardHex;')():vm.runInNewContext(engine+';CardHex;');
exports.test=(name,...args)=>require('node:test')('[historical96c109a normal Hex] '+name,...args);
