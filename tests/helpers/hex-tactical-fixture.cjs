'use strict';
// Synthetic tactical puzzles use the documented canonical six-seat orientation.
// Production games retain seed-rotated homes, independently tested in the
// shared-core factory and seeded-layout suites. This keeps old puzzle geometry
// (barrier, goal, hostile border) meaningful after seat-layout migration.
function canonicalHomes(g,H) {
  g.anchors.fill(0);
  const axes=['q','s','r','q','s','r'], signs=[1,-1,1,-1,1,-1];
  let q=H.RADIUS,r=-Math.floor(H.RADIUS/2);
  for(let p=1;p<=6;p++) {
    const home=H.index(q,r);Object.assign(g.players[p],{home,seatSlot:p-1,axis:axes[p-1],sign:signs[p-1]});g.anchors[home]=p;
    [q,r]=[-r,q+r];
  }
  return g;
}
module.exports={canonicalHomes};
