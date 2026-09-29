/* STILL BECOMING — deterministic film timeline, real DEM + activity records.
   Local Three.js r128; no remote runtime, video, or API keys required. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const clamp = (n,a=0,b=1) => Math.max(a,Math.min(b,n));
const mix = (a,b,t) => a+(b-a)*t;
const smooth = t => {t=clamp(t);return t*t*(3-2*t)};
const clock = s => `${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}`;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const duration=100, boundaries=[0,18,38,60,80];
let ready=false,started=false,playing=false,time=0,last=0,act=-1,renderFrame,soundOn=false,audio,master,voices=[];
let renderer,scene,camera,skyScene,skyCamera,skyMaterial,terrainMaterial,route,runner,halo,particles,ghosts=[],data,film,chapters;
const pointer={x:0,y:0};
const controls=[...document.querySelectorAll('[data-time]')];
function fail(message){$('error').textContent=message;$('error').hidden=false;$('start-label').textContent='無法載入';$('start').disabled=true;}
async function read(url){const r=await fetch(url);if(!r.ok)throw new Error(`${url} (${r.status})`);return r.json()}
function prepareStory(){
 const segment=data.segments.find(s=>s.id===film.climb.id);
 // Live segment records take priority over the older cinematic snapshot.
 const efforts=(segment?.efforts||[]).filter(e=>e.elapsed_sec>0).map(e=>({date:e.date,sec:e.elapsed_sec,w:e.avg_watts,hr:e.avg_heartrate}));
 if(!efforts.length)film.efforts.forEach(e=>efforts.push({date:e[0],sec:e[2],w:e[3],hr:e[4]}));
 efforts.sort((a,b)=>a.date.localeCompare(b.date));
 const first=efforts[0],best=efforts.reduce((a,b)=>a.sec<b.sec?a:b),latest=efforts[efforts.length-1];
 const longest=data.recent_rides.reduce((a,b)=>a.distance_km>b.distance_km?a:b);
 const firstRide=film.rides.first;
 chapters=[
 {label:'01 / THE FIRST TRACE',title:'一切，始於<br>一次出發。',copy:`${firstRide.d.replaceAll('-','.') }\n那天，沒有宏大的計畫。\n只有一段 ${firstRide.km.toFixed(1)} 公里的路。`,number:firstRide.km.toFixed(1),unit:'KM / THE FIRST RIDE',eLabel:'THE BEGINNING',eValue:'午後騎乘',eNote:'第一筆騎乘紀錄 · '+firstRide.d,sub:'還不知道會走多遠，只知道想出發。'},
 {label:'02 / AGAINST GRAVITY',title:'山不會<br>為誰變低。',copy:`中社路，${film.climb.km.toFixed(2)} 公里。\n最初的 ${clock(first.sec)}，\n是後來每一次回來的理由。`,number:clock(first.sec),unit:'FIRST RECORDED EFFORT',eLabel:'ZHONGSHE ROAD / 中社路',eValue:efforts.length+' 次留下痕跡',eNote:'已收錄的路段挑戰紀錄',sub:'有些路，得走很多次，才看得見自己。'},
 {label:'03 / A MOMENT EARNED',title:'直到時間，<br>有了答案。',copy:`${best.date.replaceAll('-','.')}\n不是突然變快。\n是那些沒有人看見的累積。`,number:clock(best.sec),unit:'PERSONAL BEST / 中社路',eLabel:'THE BREAKTHROUGH',eValue:best.w?`${Math.round(best.w)} W · ${best.hr?Math.round(best.hr)+' BPM':'—'}`:'個人最佳紀錄',eNote:'該次路段平均功率 / 平均心率',sub:`同一條路，比第一次快了 ${clock(first.sec-best.sec)}。`},
 {label:'04 / BEYOND THE FAMILIAR',title:'把熟悉的路，<br>騎成遠方。',copy:`${longest.date.replaceAll('-','.')} · ${longest.name}\n當城市慢慢退到身後，\n距離成了另一種自由。`,number:longest.distance_km.toFixed(1),unit:'KM / LONGEST SAVED RIDE',eLabel:'ONE DAY. A DIFFERENT HORIZON.',eValue:Math.round(longest.elevation_m).toLocaleString()+' M ↑',eNote:'這一天的累積爬升',sub:'遠方不是一個地方，是再多踩一下。'},
 {label:'05 / STILL BECOMING',title:'故事，<br>還在路上。',copy:`${data.summary.all_time_rides} 次騎乘。${data.summary.all_time_distance_km.toLocaleString()} 公里。\n最佳紀錄留在昨天。\n下一次出發，留給自己。`,number:data.summary.all_time_distance_km.toLocaleString(),unit:'KM / THE JOURNEY SO FAR',eLabel:'THE MOST RECENT RETURN',eValue:clock(latest.sec)+' / 中社路',eNote:latest.date+' · 一次新的回來',sub:'未竟。因為還想繼續。'}
 ];
 const values=efforts.map(e=>e.sec),min=Math.min(...values),max=Math.max(...values);
 $('sparkline').firstElementChild.setAttribute('d',values.map((v,i)=>`${i?'L':'M'}${i/(values.length-1||1)*220},${4+(v-min)/(max-min||1)*28}`).join(' '));
 $('source-date').textContent='運動資料更新：'+data.updated_at.slice(0,10)+'。歷次挑戰僅代表資料中已收錄的紀錄。';
}
function buildWorld(){
 const T=window.THREE;if(!T)throw new Error('Three.js 尚未載入');
 renderer=new T.WebGLRenderer({canvas:$('world'),antialias:true,alpha:false,powerPreference:'high-performance'});
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.autoClear=false;
 scene=new T.Scene();camera=new T.PerspectiveCamera(44,1,.1,600);
 skyScene=new T.Scene();skyCamera=new T.OrthographicCamera(-1,1,1,-1,0,1);
 skyMaterial=new T.ShaderMaterial({depthWrite:false,depthTest:false,uniforms:{uTime:{value:0},uWarm:{value:0},uAspect:{value:1}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:`
 varying vec2 vUv;uniform float uTime,uWarm,uAspect;
 float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
 void main(){vec2 p=vUv;vec2 sun=(p-vec2(.72,.54))*vec2(uAspect,1.);float d=length(sun);
 vec3 c=mix(vec3(.021,.036,.046),vec3(.15,.15,.125),pow(1.-p.y,2.));
 c+=vec3(.65,.26,.09)*exp(-d*4.5)*(.65+uWarm*.4);
 c+=vec3(.75,.43,.19)*exp(-d*14.)*.65;
 float disc=1.-smoothstep(.039,.042,d);c+=vec3(.91,.68,.4)*disc*(.3+uWarm*.5);
 float band=sin(p.y*110.+sin(p.x*9.)*3.+uTime*.015)*.5+.5;c+=vec3(.09,.07,.05)*pow(band,8.)*exp(-d*3.)*.18;
 c+=(hash(p*1700.)-.5)*.019;gl_FragColor=vec4(c,1.);}`});
 skyScene.add(new T.Mesh(new T.PlaneGeometry(2,2),skyMaterial));
 const g=film.terrain.near,bytes=Uint8Array.from(atob(g.h),c=>c.charCodeAt(0)),view=new DataView(bytes.buffer);
 const geometry=new T.PlaneGeometry((g.nx-1)*g.dx/100,(g.nz-1)*g.dx/100,g.nx-1,g.nz-1);
 geometry.rotateX(-Math.PI/2);
 const pos=geometry.attributes.position;
 for(let i=0;i<pos.count;i++){const x=i%g.nx,z=Math.floor(i/g.nx);pos.setXYZ(i,(g.x0+x*g.dx)/100,(view.getUint16(i*2,true)/10-10)/100*1.6,(g.z0+z*g.dx)/100)}
 geometry.computeVertexNormals();
 terrainMaterial=new T.ShaderMaterial({extensions:{derivatives:true},uniforms:{uTime:{value:0},uWarm:{value:0}},vertexShader:`varying vec3 vPos,vNormal;varying float vDepth;void main(){vPos=position;vNormal=normal;vec4 mv=modelViewMatrix*vec4(position,1.);vDepth=-mv.z;gl_Position=projectionMatrix*mv;}`,fragmentShader:`
 varying vec3 vPos,vNormal;varying float vDepth;uniform float uTime,uWarm;
 void main(){float light=max(dot(normalize(vNormal),normalize(vec3(.7,.5,-.6))),0.);
 float rough=sin(vPos.x*24.)*sin(vPos.z*19.)*.02;
 vec3 shade=mix(vec3(.024,.048,.056),vec3(.24,.25,.20),pow(light,2.));
 shade+=vec3(.25,.13,.06)*pow(light,5.)*(.5+uWarm);
 float level=vPos.y*3.;float contour=1.-smoothstep(.015,.015+fwidth(level)*1.15,abs(fract(level)-.5));
 shade+=vec3(.30,.32,.24)*contour*.15;shade+=rough;
 float fog=1.-exp(-vDepth*.014);vec3 mist=vec3(.12,.15,.15)+vec3(.09,.025,0.)*uWarm;
 shade=mix(shade,mist,clamp(fog,0.,.82));gl_FragColor=vec4(shade,1.);}`});
 scene.add(new T.Mesh(geometry,terrainMaterial));
 const points=film.roads['中社路'].map(p=>new T.Vector3(p[0]/100,p[2]/100*1.6+.085,p[1]/100));
 route=new T.CatmullRomCurve3(points);const routeGeometry=new T.TubeGeometry(route,600,.026,5,false);
 scene.add(new T.Mesh(routeGeometry,new T.MeshBasicMaterial({color:0xffdfac})));
 for(const [radius,opacity] of [[.09,.15],[.22,.045]])scene.add(new T.Mesh(new T.TubeGeometry(route,450,radius,5,false),new T.MeshBasicMaterial({color:0xffa350,transparent:true,opacity,depthWrite:false,blending:T.AdditiveBlending})));
 Object.entries(film.roads).filter(([n])=>n!=='中社路').forEach(([,p])=>{
 const geo=new T.BufferGeometry().setFromPoints(p.map(v=>new T.Vector3(v[0]/100,v[2]/100*1.6+.04,v[1]/100)));
 scene.add(new T.Line(geo,new T.LineBasicMaterial({color:0xbeb89c,transparent:true,opacity:.19})));
 });
 runner=new T.Mesh(new T.SphereGeometry(.10,12,12),new T.MeshBasicMaterial({color:0xfff2ce}));scene.add(runner);
 const glowCanvas=document.createElement('canvas');glowCanvas.width=glowCanvas.height=64;const ctx=glowCanvas.getContext('2d');const gradient=ctx.createRadialGradient(32,32,0,32,32,32);gradient.addColorStop(0,'rgba(255,228,176,1)');gradient.addColorStop(.18,'rgba(255,179,82,.7)');gradient.addColorStop(1,'rgba(255,130,40,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);
 halo=new T.Sprite(new T.SpriteMaterial({map:new T.CanvasTexture(glowCanvas),transparent:true,blending:T.AdditiveBlending,depthWrite:false}));halo.scale.set(2.1,2.1,1);scene.add(halo);
 for(let i=0;i<16;i++){const m=new T.Mesh(new T.SphereGeometry(.043,6,6),new T.MeshBasicMaterial({color:0xffcd88,transparent:true,opacity:.25}));scene.add(m);ghosts.push(m)}
 const pv=[];let seed=42;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};for(let i=0;i<600;i++)pv.push((random()-.5)*100,random()*35,(random()-.5)*100);
 const pg=new T.BufferGeometry();pg.setAttribute('position',new T.Float32BufferAttribute(pv,3));particles=new T.Points(pg,new T.PointsMaterial({color:0xe7caa0,size:.06,transparent:true,opacity:.42,depthWrite:false}));scene.add(particles);
 resize();window.addEventListener('resize',resize);
 $('world').addEventListener('webglcontextlost',e=>{e.preventDefault();playing=false;cancelAnimationFrame(renderFrame);updatePlay();fail('圖形運算暫時中斷。請重新整理頁面，再次播放。')});
}
function resize(){if(!renderer)return;const w=$('film').clientWidth,h=$('film').clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();skyMaterial.uniforms.uAspect.value=w/h;}
function updateChapter(){const index=boundaries.reduce((a,t,i)=>time>=t?i:a,0);if(index===act)return;act=index;const c=chapters[index];$('act-label').textContent=c.label;$('act-title').innerHTML=c.title;$('act-copy').textContent=c.copy;$('hero-value').textContent=c.number;$('hero-unit').textContent=c.unit;$('evidence-label').textContent=c.eLabel;$('evidence-value').textContent=c.eValue;$('evidence-note').textContent=c.eNote;$('subtitle').textContent=c.sub;$('sparkline').style.display=index===1?'block':'none';controls.forEach((b,i)=>{b.classList.toggle('active',i===index);if(i===index)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current')});$('film-state').textContent=c.label;$('hero-number').style.opacity=1;$('end-actions').hidden=index!==4;$('evidence').hidden=false;}
function updatePlay(){$('pause').textContent=playing?'Ⅱ':'▶';$('pause').setAttribute('aria-label',playing?'暫停':'播放');if(master)master.gain.setTargetAtTime(soundOn&&playing?.13:0,audio.currentTime,.4)}
function begin(at=0){if(!ready)return;started=true;time=at;playing=true;act=-1;$('film').classList.add('playing');$('intro').inert=true;$('story').hidden=false;$('pause').disabled=false;updateChapter();updatePlay();}
function toggle(){if(!ready)return;if(!started||time>=duration)begin();else{playing=!playing;updatePlay()}}
async function toggleSound(){try{if(!audio){audio=new (window.AudioContext||window.webkitAudioContext)();master=audio.createGain();master.gain.value=0;master.connect(audio.destination);[55,82.4069,110,164.8138].forEach((f,i)=>{const o=audio.createOscillator(),gain=audio.createGain();o.type='sine';o.frequency.value=f;gain.gain.value=[.38,.13,.10,.04][i];o.connect(gain);gain.connect(master);o.start();voices.push({o,gain})});}await audio.resume();soundOn=!soundOn;$('sound').innerHTML=`聲音 ${soundOn?'ON':'OFF'} <span>▂▅▃▆</span>`;$('sound').setAttribute('aria-pressed',String(soundOn));updatePlay()}catch(e){$('sound').textContent='聲音無法啟用'}}
function frame(now){renderFrame=requestAnimationFrame(frame);const dt=last?Math.min((now-last)/1000,.1):0;last=now;if(document.hidden)return;if(playing){time=Math.min(time+dt,duration);if(time>=duration){playing=false;updatePlay()}}
 const t=started?time:0,sceneTime=started?t:(reduced?0:now/1000),section=started?Math.max(0,act):0;
 if(started){updateChapter();$('seek').value=time;$('elapsed').textContent=clock(time);const local=time-boundaries[act],end=act===4?100:boundaries[act+1];const opacity=act===4?smooth(local/1.3):smooth(local/1.3)*smooth((end-time)/1);$('story').style.opacity=opacity;$('hero-number').style.opacity=opacity;$('evidence').style.opacity=opacity;$('subtitle').style.opacity=smooth((local-4)/2);}
 const warm=started?clamp((t-34)/60):.15;skyMaterial.uniforms.uTime.value=sceneTime;skyMaterial.uniforms.uWarm.value=warm;terrainMaterial.uniforms.uWarm.value=warm;
 const viewTime=reduced?0:sceneTime;
 // Camera paths are keyed to film time, so pause and scrubbing reproduce the same shot.
 let cx,cy,cz,tx=-2,ty=3,tz=-11;
 if(!started){cx=27+Math.sin(viewTime*.04)*2;cy=24;cz=34;}
 else if(t<18){const p=smooth(t/18);cx=mix(37,23,p);cy=mix(32,20,p);cz=mix(43,30,p);}
 else if(t<38){const p=smooth((t-18)/20);cx=mix(23,-23,p);cy=mix(20,16,p);cz=mix(30,24,p);}
 else if(t<60){const p=smooth((t-38)/22);cx=mix(-23,-6,p);cy=mix(16,33,p);cz=mix(24,15,p);ty=3;}
 else if(t<80){const p=smooth((t-60)/20);cx=mix(-6,20,p);cy=mix(33,48,p);cz=mix(15,44,p);}
 else{const p=smooth((t-80)/20);cx=mix(20,30,p);cy=mix(48,28,p);cz=mix(44,37,p);}
 if(reduced){cx=27;cy=30;cz=38}const mobile=camera.aspect<1;camera.position.set(cx+(reduced?0:pointer.x*1.2),cy+(mobile?9:0),cz+(mobile?15:0));camera.lookAt(tx,ty,tz);
 const progress=started?clamp(t/100):.38;const pt=route.getPointAt(progress);runner.position.copy(pt);halo.position.copy(pt);if(!reduced)halo.scale.setScalar(1.7+Math.sin(sceneTime*3)*.2);
 ghosts.forEach((g,i)=>{g.position.copy(route.getPointAt(clamp(progress-(i+1)*.012)));g.visible=started&&t>18&&t<60;});
 particles.rotation.y=reduced?0:viewTime*.003;particles.position.y=reduced?0:Math.sin(viewTime*.09)*.7;
 if(audio&&soundOn&&playing)voices.forEach(({gain},i)=>gain.gain.setTargetAtTime(([.38,.13,.10,.04][i])*(1+Math.sin(t*.2+i)*.12),audio.currentTime,.3));
 renderer.clear();renderer.render(skyScene,skyCamera);renderer.clearDepth();renderer.render(scene,camera);
}
$('start').addEventListener('click',()=>{begin();$('pause').focus()});$('pause').addEventListener('click',toggle);$('replay').addEventListener('click',()=>begin());$('sound').addEventListener('click',toggleSound);
controls.forEach(b=>b.addEventListener('click',()=>begin(Number(b.dataset.time))));
$('seek').addEventListener('input',e=>{if(!ready)return;const next=Number(e.target.value);if(!started){begin(next);playing=false;updatePlay()}time=next;updateChapter()});
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('film').requestFullscreen()}catch(e){$('fullscreen').title='此瀏覽器不支援全螢幕'}});
$('sources').addEventListener('click',()=>{if(playing){playing=false;updatePlay()}$('about').showModal();$('sources').setAttribute('aria-expanded','true')});$('close-about').addEventListener('click',()=>$('about').close());$('about').addEventListener('close',()=>$('sources').setAttribute('aria-expanded','false'));
window.addEventListener('keydown',e=>{if($('about').open||/INPUT|BUTTON|A/.test(e.target.tagName))return;if(e.code==='Space'){e.preventDefault();toggle()}if(ready&&started&&['ArrowLeft','ArrowRight'].includes(e.code)){e.preventDefault();time=clamp(time+(e.code==='ArrowRight'?5:-5),0,100);updateChapter()}});
window.addEventListener('pointermove',e=>{pointer.x=e.clientX/innerWidth-.5;pointer.y=e.clientY/innerHeight-.5});
document.addEventListener('visibilitychange',()=>{last=0;if(document.hidden&&playing){playing=false;updatePlay()}});
Promise.all([read('data/strava.json'),read('data/film.json')]).then(([s,f])=>{data=s;film=f;prepareStory();buildWorld();ready=true;$('start').disabled=false;$('start-label').textContent='開始這段旅程';$('pause').disabled=false;renderFrame=requestAnimationFrame(frame)}).catch(e=>{console.error(e);fail('無法建立電影畫面。請使用本機網站伺服器開啟此頁，並確認瀏覽器已啟用 WebGL。詳細資訊：'+e.message)});
})();
