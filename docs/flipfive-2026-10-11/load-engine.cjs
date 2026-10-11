'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const repo=path.resolve(__dirname,'../..');
const requested=process.env.FLIP_FIVE_ENGINE&&path.resolve(process.env.FLIP_FIVE_ENGINE);
const modulePath=requested||path.join(repo,'flip-five-engine.js');
let F,source;
if(fs.existsSync(modulePath)){source=modulePath;F=require(modulePath);}else{
  if(requested)throw Error(`Requested engine does not exist: ${requested}`);
  source=path.join(repo,'flip_five.html');const html=fs.readFileSync(source,'utf8'),match=html.match(/<script id="flip-engine">([\s\S]*?)<\/script>/);
  if(!match)throw Error('Production engine module and legacy inline engine are both unavailable');
  F=vm.runInNewContext(match[1]+'; FlipFive;');
}
module.exports={F,source,sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),coord:i=>String.fromCharCode(65+i%9)+(Math.floor(i/9)+1)};
