import fs from 'node:fs';
import Core from '../dist/src/core-sim.js';
const ROMS={};
for(const m of Core.MODES){const meta=JSON.parse(fs.readFileSync(`dist/firmware/${m.file}.json`));ROMS[m.file]={...meta,rom:Array.from(fs.readFileSync(`dist/firmware/${m.file}.bin`))};}
let pass=0;const ok=(v,msg)=>{if(!v)throw Error(msg);pass++};const run=(s,n)=>{for(let i=0;i<n&&!s.complete&&!s.mcu.fault;i++)s.step()};
for(let i=0;i<3;i++){const s=new Core.Session(i,ROMS);ok(!s.mcu.fault,`trial ${i+1} boots`)}
{const s=new Core.Session(0,ROMS);s.act('positive',2,0);run(s,400);ok(s.position===0,'latch alone stays still');s.act('positive',3,0);run(s,800);ok(s.complete,'conduction completes')}
{const s=new Core.Session(1,ROMS);s.act('positive',2,0);run(s,100);ok((s.mcu.raw(2)&1)===0,'firmware resists output');s.act('positive',0x60,0);run(s,900);ok(s.complete,'intent completes')}
{const s=new Core.Session(2,ROMS);s.act('positive',0x60,0,true);run(s,500);ok(s.position===0,'one hand insufficient');s.act('negative',0x61,0,true);run(s,1000);ok(s.complete,'override completes');ok(s.mcu.events.some(e=>e.kind==='blocked'),'blocked write observed')}
console.log(`Core 0.2 simulation checks passed: ${pass}`);
