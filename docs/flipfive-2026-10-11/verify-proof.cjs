'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {F,coord,source,sourceSha256}=require('./load-engine.cjs');
const filename=process.argv[2]||__dirname+'/after-e3-h8-proof.json.gz';
const input=fs.readFileSync(filename),bytes=filename.endsWith('.gz')?zlib.gunzipSync(input):input;
const proof=JSON.parse(bytes),reached=new Set(),pending=[proof.root];let transitions=0,leaves=0,defenderNodes=0,attackerNodes=0;
while(pending.length){const id=pending.pop();if(reached.has(id))continue;reached.add(id);const node=proof.records[id];assert.ok(node);const board=node.board.split('').map(Number),outcome=F.outcome(board);assert.equal(node.winner,outcome?outcome.winner:-1);
 if(outcome){assert.equal(outcome.winner,proof.attacker);assert.equal(node.edges.length,0);leaves++;continue;}
 assert.ok(node.depth>0);const legal=Array.from(F.legalMoves(board));
 if(node.turn===proof.attacker){assert.equal(node.edges.length,1);attackerNodes++;}else{assert.deepEqual(node.edges.map(x=>x[0]).sort((a,b)=>a-b),legal);defenderNodes++;}
 for(const [cell,childId] of node.edges){assert.ok(legal.includes(cell));const next=F.apply(board,cell,node.turn),child=proof.records[childId];assert.ok(next&&child);assert.equal(child.board,next.board.join(''));assert.equal(child.turn,3-node.turn);assert.equal(child.depth,node.depth-1);transitions++;pending.push(childId);}
}
assert.equal(reached.size,proof.records.length);assert.equal(proof.records[proof.root].depth,proof.horizonPlies);
const root=proof.records[proof.root];console.log(JSON.stringify({proofFile:filename,proofSha256:crypto.createHash('sha256').update(bytes).digest('hex'),attacker:proof.attacker,horizonPlies:proof.horizonPlies,rootBoard:root.board,rootTurn:root.turn,rootAttack:root.turn===proof.attacker?coord(root.edges[0][0]):null,uniqueRecords:reached.size,transitions,attackerNodes,defenderNodes,winningLeaves:leaves,verifiedUsing:source,engineSha256:sourceSha256,valid:true},null,2));
