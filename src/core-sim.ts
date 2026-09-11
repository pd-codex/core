/* Core 0.1: dependency-free HCS08 instruction subset + deterministic fixture.
 * The native GDScript port is scripts/mcu.gd + scripts/session.gd.
 * Source of opcodes/register semantics: docs/FIDELITY.md. No game-script CPU traps.
 */
'use strict';
const Core = (() => {
 const PTBD=2, PTBDD=3, REQUEST=0x60, INHIBIT=0x61, SENSE=0x62, HEART=0x63;
 const V=0x80,H=0x10,I=8,N=4,Z=2,C=1;
 const hex=(n,w=2)=>n.toString(16).toUpperCase().padStart(w,'0');
 class MCU {
  constructor(rom,listing={}) {
   this.mem=new Uint8Array(65536); this.mem.fill(0xA5,0x60,0x260); // chosen power-on seed, not a hardware reset claim
   this.mem.set(rom,0xE000); this.mem[0x1802]=0xD2;
   this.a=0;this.x=0;this.h=0;this.sp=0xFF;this.ccr=0x68;
   this.pc=(this.mem[0xFFFE]<<8)|this.mem[0xFFFF];this.cycles=0;this.instructions=0;
   this.inputB=0;this.soptWritten=false;this.fault='';this.currentPC=this.pc;
   this.forces={};this.events=[];this.trace=[];this.listing=listing;
  }
  record(kind,addr,before,after,attempt=null) {
   this.events.push({cycle:this.cycles,pc:this.currentPC,kind,addr,before,after,attempt});
   if(this.events.length>80)this.events.shift();
  }
  trap(s){ if(!this.fault)this.fault=`$${hex(this.currentPC,4)}: ${s}`;return 0; }
  validData(addr){return addr===PTBD||addr===PTBDD||addr===0x1802||(addr>=0x60&&addr<=0x25F)||(addr>=0xE000&&addr<=0xFFFF);}
  read(addr){
   addr&=0xFFFF;
   if(!this.validData(addr))return this.trap(`Unimplemented read $${hex(addr,4)}`);
   if(addr===PTBD)return (this.mem[PTBD]&this.mem[PTBDD])|(this.inputB&(~this.mem[PTBDD]&255));
   return this.mem[addr];
  }
  raw(addr){return this.mem[addr&0xFFFF];}
  applyForces(addr,value){
   for(const f of Object.values(this.forces))if(f.addr===addr)value=(value&~(1<<f.bit))|(f.value<<f.bit);
   return value&255;
  }
  write(addr,value){
   addr&=65535;value&=255;
   if(addr===0x1802){
    if(this.soptWritten)return;
    if(value&0x80){this.trap('COP-enabled configuration is not implemented');return;}
    this.soptWritten=true;this.mem[addr]=value&0xF3;return;
   }
   if(addr!==PTBD&&addr!==PTBDD&&!(addr>=0x60&&addr<=0x25F)){
    this.trap(`Unimplemented write $${hex(addr,4)} (flash is not writable RAM)`);return;
   }
   const old=this.mem[addr],out=this.applyForces(addr,value);this.mem[addr]=out;
   if(old!==out||out!==value||addr===PTBD||addr===REQUEST||addr===INHIBIT)
    this.record(out!==value?'blocked':'cpu',addr,old,out,value);
  }
  pulse(addr,bit,value){
   if(!(addr===2||addr===3||(addr>=0x60&&addr<=0x25F))||bit<0||bit>7)return false;
   if(Object.values(this.forces).some(f=>f.addr===addr&&f.bit===bit&&f.value!==value))return false;
   const old=this.mem[addr];this.mem[addr]=(old&~(1<<bit))|((value&1)<<bit);
   this.record(value?'positive':'negative',addr,old,this.mem[addr]);return true;
  }
  force(hand,addr,bit,value){
   const other=hand==='positive'?'negative':'positive';
   if(this.forces[other]?.addr===addr&&this.forces[other]?.bit===bit)return false;
   if(!this.pulse(addr,bit,value))return false;
   this.forces[hand]={addr,bit,value};this.record('clamp',addr,this.mem[addr],this.mem[addr]);return true;
  }
  release(hand){const f=this.forces[hand];if(f){delete this.forces[hand];this.record('release',f.addr,this.mem[f.addr],this.mem[f.addr]);}}
  fetch(){const v=this.read(this.pc);this.pc=(this.pc+1)&65535;return v;}
  word(){const hi=this.fetch(),lo=this.fetch();return (hi<<8)|lo;}
  flag(mask,on){this.ccr=((on?this.ccr|mask:this.ccr&~mask)|0x60)&255;}
  nz(v,overflow=false){this.flag(N,!!(v&128));this.flag(Z,(v&255)===0);this.flag(V,overflow);}
  branch(d){this.pc=(this.pc+(d<128?d:d-256))&65535;}
  step(){
   if(this.fault)return 0;
   this.currentPC=this.pc;const op=this.fetch();let cyc=0,addr=0,v=0;
   if(op<=15){
    addr=this.fetch();const offset=this.fetch(),bit=op>>1;v=(this.read(addr)>>bit)&1;
    this.flag(C,!!v);if(v===(op%2===0?1:0))this.branch(offset);cyc=5;
   }else if(op>=0x10&&op<=0x1F){
    addr=this.fetch();const bit=(op-0x10)>>1;v=this.read(addr);
    this.write(addr,op%2===0?v|(1<<bit):v&~(1<<bit));cyc=5;
   }else switch(op){
    case 0xA6:this.a=this.fetch();this.nz(this.a);cyc=2;break;
    case 0xB6:addr=this.fetch();this.a=this.read(addr);this.nz(this.a);cyc=3;break;
    case 0xC6:addr=this.word();this.a=this.read(addr);this.nz(this.a);cyc=4;break;
    case 0xB7:addr=this.fetch();this.write(addr,this.a);this.nz(this.a);cyc=3;break;
    case 0xC7:addr=this.word();this.write(addr,this.a);this.nz(this.a);cyc=4;break;
    case 0xA4:this.a&=this.fetch();this.nz(this.a);cyc=2;break;
    case 0xAA:this.a|=this.fetch();this.nz(this.a);cyc=2;break;
    case 0xA8:this.a^=this.fetch();this.nz(this.a);cyc=2;break;
    case 0xA1:v=this.fetch();{const r=(this.a-v)&255;this.nz(r,!!((this.a^v)&(this.a^r)&128));this.flag(C,this.a<v);}cyc=2;break;
    case 0x20:case 0x26:case 0x27:v=this.fetch();if(op===0x20||(op===0x26&&!(this.ccr&Z))||(op===0x27&&(this.ccr&Z)))this.branch(v);cyc=3;break;
    case 0x3F:addr=this.fetch();this.write(addr,0);this.nz(0);cyc=5;break;
    case 0x3C:case 0x3A:addr=this.fetch();v=this.read(addr);this.write(addr,(v+(op===0x3C?1:-1))&255);this.nz((v+(op===0x3C?1:-1))&255,op===0x3C?v===0x7F:v===0x80);cyc=5;break;
    case 0x4F:this.a=0;this.nz(0);cyc=1;break;
    case 0x9B:this.flag(I,true);cyc=1;break;
    case 0x9D:cyc=1;break;
    default:return this.trap(`Unimplemented opcode $${hex(op)} (development halt, not hardware reset)`);
   }
   if(this.fault)return 0;
   this.cycles+=cyc;this.instructions++;
   this.trace.push({pc:this.currentPC,op,a:this.a,ccr:this.ccr,cycles:this.cycles,text:this.listing[this.currentPC]||`OP $${hex(op)}`});
   if(this.trace.length>24)this.trace.shift();return cyc;
  }
  snapshot(){return {mem:Array.from(this.mem),a:this.a,x:this.x,h:this.h,sp:this.sp,ccr:this.ccr,pc:this.pc,cycles:this.cycles,instructions:this.instructions,inputB:this.inputB,soptWritten:this.soptWritten,fault:this.fault,currentPC:this.currentPC,forces:structuredClone(this.forces),events:structuredClone(this.events),trace:structuredClone(this.trace)};}
  restore(s){
   if(!s||!Array.isArray(s.mem)||s.mem.length!==65536)throw Error('Invalid MCU snapshot');
   this.mem=Uint8Array.from(s.mem);
   for(const k of ['a','x','h','sp','ccr','pc','cycles','instructions','inputB','soptWritten','fault','currentPC'])this[k]=s[k];
   this.forces=structuredClone(s.forces);this.events=structuredClone(s.events);this.trace=structuredClone(s.trace);
  }
 }
 const MODES=[
  {name:'Conduction',tag:'01',brief:'Wake the output. Open the shutter and let the controller read its end-stop.',hint:'An illuminated latch is not necessarily a driven pin. Inspect DIRECTION, bit 0.',file:'01_conduction'},
  {name:'Intent',tag:'02',brief:'The controller keeps closing the shutter. Change the decision, not just the output.',hint:'Watch the write trail. REQUEST $0060 bit 0 tells the firmware to open; INHIBIT must be clear.',file:'02_intent'},
  {name:'Override',tag:'03',brief:'The controller revokes permission each loop. Sustain opposite charges until the end-stop is confirmed.',hint:'Latch + onto REQUEST bit 0 and latch − onto INHIBIT bit 0. GPIO is visibly shielded in this trial.',file:'03_override'}
 ];
 const BANKS=[{addr:2,name:'OUTPUT LATCH',role:'PTBD · physical output storage'},
 {addr:3,name:'DIRECTION',role:'PTBDD · 1 drives / 0 listens'},
 {addr:0x60,name:'REQUEST',role:'RAM · firmware open request'},
 {addr:0x61,name:'INHIBIT',role:'RAM · firmware inhibit'}];
 class Session {
  constructor(mode,roms){this.roms=roms;this.load(mode);}
  load(mode){
   this.mode=mode;const pack=this.roms[MODES[mode].file];
   const rom=typeof pack.base64==='string'?Uint8Array.from(atob(pack.base64),c=>c.charCodeAt(0)):Uint8Array.from(pack.rom);
   const listing={};for(const r of pack.listing)listing[r.address]=r.source.split(';')[0].trim();
   this.mcu=new MCU(rom,listing);this.position=0;this.stable=0;this.complete=false;this.fixtureCycles=0;
   let n=0;while(this.mcu.pc!==pack.symbols.LOOP&&!this.mcu.fault&&n++<300)this.mcu.step();
   if(n>=300)this.mcu.trap('Boot did not reach LOOP');
   this.mcu.events=[];this.mcu.trace=[];this.startCycles=this.mcu.cycles;
  }
  editable(addr,bit){
   if(bit<0||bit>7)return false;
   if((addr===2||addr===3)&&bit===0)return this.mode<2;
   return (addr===0x60||addr===0x61)&&this.mode>0;
  }
  act(hand,addr,bit,hold=false){
   if(!this.editable(addr,bit)||this.mcu.fault)return false;
   const value=hand==='positive'?1:0;
   return hold?this.mcu.force(hand,addr,bit,value):this.mcu.pulse(addr,bit,value);
  }
  step(){
   const cycles=this.mcu.step();if(!cycles)return 0;
   // Fixed-point fixture: 10,000 units of travel; 12 units per virtual bus cycle.
   const driven=!!(this.mcu.raw(3)&1),command=driven&&!!(this.mcu.raw(2)&1);
   this.position=Math.max(0,Math.min(10000,this.position+(command?1:-1)*12*cycles));
   this.mcu.inputB=this.position>=9500?2:0;this.fixtureCycles+=cycles;
   if(this.position>=9800&&command&&(this.mcu.inputB&2)&&(this.mcu.raw(SENSE)&2))this.stable+=cycles;
   else this.stable=0;
   if(this.stable>=400)this.complete=true;
   return cycles;
  }
  snapshot(){return {version:1,mode:this.mode,position:this.position,stable:this.stable,complete:this.complete,fixtureCycles:this.fixtureCycles,startCycles:this.startCycles,mcu:this.mcu.snapshot()};}
  restore(s){
   if(s?.version!==1||!Number.isInteger(s.mode)||s.mode<0||s.mode>2)throw Error('Unsupported checkpoint');
   this.load(s.mode);this.mcu.restore(s.mcu);
   for(const k of ['position','stable','complete','fixtureCycles','startCycles'])this[k]=s[k];
  }
 }
 return {MCU,Session,MODES,BANKS,hex,PTBD,PTBDD,REQUEST,INHIBIT,SENSE,HEART};
})();
if(typeof window!=='undefined')window.Core=Core;
export default Core;
export const {MCU,Session,MODES,BANKS,hex,PTBD,PTBDD,REQUEST,INHIBIT,SENSE,HEART}=Core;
