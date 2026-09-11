import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import Core from './core-sim.js';

const $=id=>document.getElementById(id);
const ROMS={};
let session=null, mode=0, selected={addr:2,bit:0}, paused=false, speed=1, accumulator=0, last=performance.now();
let scene,camera,renderer,controls,raycaster,pointer,bitMeshes=[],shutter,playerGlow;

async function loadFirmware(){
  for(const m of Core.MODES){
    const [meta,bin]=await Promise.all([
      fetch(`./firmware/${m.file}.json`).then(r=>r.json()),
      fetch(`./firmware/${m.file}.bin`).then(r=>r.arrayBuffer())
    ]);
    ROMS[m.file]={...meta,rom:Array.from(new Uint8Array(bin))};
  }
}

function initThree(){
  const canvas=$('world');
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  scene=new THREE.Scene(); scene.background=new THREE.Color(0x08121b); scene.fog=new THREE.Fog(0x08121b,14,36);
  camera=new THREE.PerspectiveCamera(52,1,.1,100); camera.position.set(8,7,12);
  controls=new OrbitControls(camera,canvas); controls.target.set(0,1.8,0); controls.enableDamping=true; controls.maxPolarAngle=Math.PI*.48; controls.minDistance=6; controls.maxDistance=22;
  scene.add(new THREE.HemisphereLight(0x9ecfff,0x101018,1.5));
  const key=new THREE.DirectionalLight(0xffdda0,2.3); key.position.set(5,10,4); scene.add(key);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(30,24),new THREE.MeshStandardMaterial({color:0x101d27,roughness:.92,metalness:.1})); floor.rotation.x=-Math.PI/2; scene.add(floor);
  const grid=new THREE.GridHelper(30,30,0x32566c,0x183244); grid.position.y=.01; scene.add(grid);
  const wallMat=new THREE.MeshStandardMaterial({color:0x122938,roughness:.8});
  for(const [x,z,sx,sz] of [[0,-7,18,.35],[-8,0,.35,14],[8,0,.35,14]]){const w=new THREE.Mesh(new THREE.BoxGeometry(sx,4.5,sz),wallMat);w.position.set(x,2.25,z);scene.add(w)}
  shutter=new THREE.Mesh(new THREE.BoxGeometry(4.5,3.2,.35),new THREE.MeshStandardMaterial({color:0x6d7c85,metalness:.75,roughness:.35})); shutter.position.set(0,1.6,-6.7);scene.add(shutter);
  const frameMat=new THREE.MeshStandardMaterial({color:0x2b4656,metalness:.5});
  for(const x of [-2.5,2.5]){const f=new THREE.Mesh(new THREE.BoxGeometry(.35,4.2,.5),frameMat);f.position.set(x,2.1,-6.7);scene.add(f)}
  const top=new THREE.Mesh(new THREE.BoxGeometry(5.35,.35,.5),frameMat);top.position.set(0,4.05,-6.7);scene.add(top);
  playerGlow=new THREE.PointLight(0x66dfff,1.4,7);playerGlow.position.set(0,2.5,4);scene.add(playerGlow);
  raycaster=new THREE.Raycaster(); pointer=new THREE.Vector2();
  canvas.addEventListener('pointerup',pickBit);
  window.addEventListener('resize',resize); resize();
}

function resize(){
  if(!renderer)return; const rect=renderer.domElement.getBoundingClientRect();
  renderer.setSize(rect.width,rect.height,false); camera.aspect=rect.width/rect.height; camera.updateProjectionMatrix();
}

function rebuildBanks(){
  bitMeshes.forEach(m=>{scene.remove(m);m.geometry.dispose();m.material.dispose()}); bitMeshes=[];
  const zRows=[2.8,.9,-1.0,-2.9];
  Core.BANKS.forEach((bank,row)=>{
    const base=new THREE.Mesh(new THREE.BoxGeometry(7.9,.35,1.25),new THREE.MeshStandardMaterial({color:0x122735,metalness:.3,roughness:.55}));base.position.set(-1.3,.2,zRows[row]);scene.add(base);bitMeshes.push(base);
    for(let bit=0;bit<8;bit++){
      const m=new THREE.Mesh(new THREE.BoxGeometry(.72,.72,.72),new THREE.MeshStandardMaterial({color:0x28475a,emissive:0x000000,metalness:.25,roughness:.35}));
      m.position.set(-4.25+bit*.85,.78,zRows[row]); m.userData={addr:bank.addr,bit}; scene.add(m); bitMeshes.push(m);
    }
  });
}

function pickBit(e){
  if(!session)return; const rect=renderer.domElement.getBoundingClientRect(); pointer.x=((e.clientX-rect.left)/rect.width)*2-1; pointer.y=-((e.clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(pointer,camera); const hits=raycaster.intersectObjects(bitMeshes.filter(m=>m.userData.bit!==undefined));
  if(hits.length){selected={addr:hits[0].object.userData.addr,bit:hits[0].object.userData.bit}; $('bank').value=String(selected.addr); renderHUD();}
}

function startTrial(index){
  mode=index; session=new Core.Session(index,ROMS); selected={addr:index===0?2:0x60,bit:0}; paused=false; accumulator=0;
  $('title').classList.add('hidden');$('game').classList.remove('hidden');$('complete').classList.add('hidden');$('hint').classList.add('hidden');
  $('trialTag').textContent=`TRIAL 0${index+1}`;$('trialName').textContent=Core.MODES[index].name;$('brief').textContent=Core.MODES[index].brief;$('hint').textContent=Core.MODES[index].hint;
  $('bank').innerHTML=Core.BANKS.map(b=>`<option value="${b.addr}">${b.name}</option>`).join(''); $('bank').value=String(selected.addr);
  rebuildBanks();renderHUD();resize();
}

function editable(){return session?.editable(selected.addr,selected.bit)}
function act(hand,hold=false){if(!session)return;session.act(hand,selected.addr,selected.bit,hold);renderHUD()}
function release(hand){session?.mcu.release(hand);renderHUD()}

function renderHUD(){
  if(!session)return; const bank=Core.BANKS.find(b=>b.addr===selected.addr)||Core.BANKS[0], value=session.mcu.raw(bank.addr);
  $('bankName').textContent=bank.name;$('byteValue').textContent=`$${Core.hex(bank.addr,4)} = $${Core.hex(value)}`;$('targetReadout').textContent=`TARGET $${Core.hex(selected.addr,4)}.${selected.bit}`;
  $('bits').innerHTML=''; for(let bit=7;bit>=0;bit--){const b=document.createElement('button');b.innerHTML=`<em>${bit}</em>${(value>>bit)&1}`;if((value>>bit)&1)b.classList.add('on');if(bit===selected.bit)b.classList.add('selected');b.disabled=!session.editable(bank.addr,bit);b.onclick=()=>{selected={addr:bank.addr,bit};renderHUD()};$('bits').appendChild(b)}
  $('access').textContent=editable()?'INTERVENTION PATH OPEN':'SHIELDED / READ-ONLY';
  $('minus').disabled=$('plus').disabled=!editable();
  for(const [hand,id] of [['negative','holdMinus'],['positive','holdPlus']]){const f=session.mcu.forces[hand];$(id).classList.toggle('held',!!f);$(id).textContent=f?`RELEASE ${hand==='negative'?'−':'+'}`:`LATCH ${hand==='negative'?'−':'+'}`}
  const driven=!!(session.mcu.raw(3)&1),command=driven&&!!(session.mcu.raw(2)&1);$('pin').textContent=driven?(command?'HIGH':'LOW'):'HI-Z';$('travel').textContent=`${Math.round(session.position/100)}%`;$('sensor').textContent=session.mcu.inputB&2?'HIGH':'LOW';$('sample').textContent=session.mcu.raw(Core.SENSE)&2?'YES':'NO';$('meter').style.width=`${session.position/100}%`;
  $('cpu').textContent=`PC $${Core.hex(session.mcu.pc,4)} · A $${Core.hex(session.mcu.a)} · ${session.mcu.cycles} cycles`;
  $('trail').textContent=session.mcu.events.slice(-5).map(e=>`${e.kind.padEnd(8)} $${Core.hex(e.addr,4)}  ${Core.hex(e.before)}→${Core.hex(e.after)}`).join('\n');
  $('runState').textContent=session.mcu.fault?'FAULT':paused?'PAUSED':'RUNNING';$('pause').textContent=paused?'Run':'Pause';
  const pct=session.position/10000;shutter.position.y=1.6+pct*3.6;
  bitMeshes.forEach(m=>{if(m.userData.bit===undefined)return;const on=!!(session.mcu.raw(m.userData.addr)&(1<<m.userData.bit));const sel=m.userData.addr===selected.addr&&m.userData.bit===selected.bit;m.material.color.setHex(sel?0x3b788b:(on?0x7c6532:0x28475a));m.material.emissive.setHex(on?0x5c3e0b:(sel?0x123e48:0x000000));m.scale.setScalar(sel?1.12:1)});
  if(session.complete)$('complete').classList.remove('hidden');
}

function tick(now){
  const dt=Math.min(.05,(now-last)/1000);last=now;
  if(session&&!paused&&!session.complete&&!session.mcu.fault){accumulator+=dt*400*speed;let guard=0;while(accumulator>0&&guard++<500){const c=session.step();if(!c)break;accumulator-=c}}
  controls?.update(); if(session)renderHUD(); renderer?.render(scene,camera); requestAnimationFrame(tick);
}

function bind(){
  document.querySelectorAll('[data-start]').forEach(b=>b.onclick=()=>startTrial(+b.dataset.start));$('menu').onclick=()=>{$('game').classList.add('hidden');$('title').classList.remove('hidden')};
  $('bank').onchange=e=>{selected.addr=+e.target.value;selected.bit=0;renderHUD()};$('minus').onclick=()=>act('negative');$('plus').onclick=()=>act('positive');
  $('holdMinus').onclick=()=>session.mcu.forces.negative?release('negative'):act('negative',true);$('holdPlus').onclick=()=>session.mcu.forces.positive?release('positive'):act('positive',true);
  $('pause').onclick=()=>{paused=!paused;renderHUD()};$('step').onclick=()=>{paused=true;session.step();renderHUD()};$('speed').onchange=e=>speed=+e.target.value;$('restart').onclick=()=>startTrial(mode);$('hintBtn').onclick=()=>$('hint').classList.toggle('hidden');
}

await loadFirmware();initThree();bind();requestAnimationFrame(tick);
