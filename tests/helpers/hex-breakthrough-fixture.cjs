'use strict';
const assert=require('node:assert/strict');
const {canonicalHomes}=require('./hex-tactical-fixture.cjs');
function fixture(mode,Core=require('../../hex-core.js')){
 const H=Core.create({mode,playerCount:6}),g=new H.Game({seed:'breach-wall',neutralEvents:false});g.start();canonicalHomes(g,H);g.board.set(g.anchors);g.terrain.fill(0);g.airports=[];g.depots=[];g.turrets=[];g._draw=()=>{};
 const target=H.index(-H.RADIUS,Math.floor(H.RADIUS/2)+2),source=H.index(-H.RADIUS+1,Math.floor(H.RADIUS/2)+2);
 let i=g.players[1].home;while(i!==source){const j=H.ADJ[i].filter(j=>!g.anchors[j]&&H.distance(j,source)<H.distance(i,source)).sort((a,b)=>a-b)[0];assert.notEqual(j,undefined);g.board[j]=1;i=j;}
 for(const c of H.CELLS)if(c.q===-H.RADIUS&&!g.anchors[c.i])g.board[c.i]=2;
 for(const j of H.ADJ[target])if(j!==source&&!g.anchors[j]&&g.board[j]!==1)g.board[j]=2;
 for(const c of H.CELLS)if(c.q===-H.RADIUS+2 && Math.abs(c.r-H.CELLS[source].r)<=1&&!g.anchors[c.i])g.board[c.i]=1;
 for(const c of H.CELLS)if(c.q===-H.RADIUS&&c.i!==target)g.shields[c.i]=8;
 g.shields[source]=8;g.terrain[source]=2;g.hands[1]=[];g.handAges[1]=[];Object.assign(g.players[1],{energy:8,breachReady:true});g._countStones();return {H,g,target,source};
}
module.exports={fixture};
