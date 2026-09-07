/* APEX / TELEMETRY. Canvas is a projection of the sampled route, never invented terrain.
   Charts share pure transforms in ApexData. All navigation remains synchronous. */
(() => {
  'use strict';
  const D = window.ApexData;
  if (!D) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const fmt = (v, decimals = 0) => D.finite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : '—';
  const md = s => s?.slice(5).replace('-', '/') || '—';
  const duration = s => s < 60 ? `${s}秒` : `${s / 60}分`;
  const svg = (content, w, h, label) => `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escape(label)}">${content}</svg>`;
  const marker = '<line class="apx-crosshair" x1="0" x2="0" y1="16" y2="180"/>';
  const typeColors = { ride:'#d5f558', run:'#75dedb', swim:'#7b9cff', weight:'#deacf1' };
  const fallback = text => `<p class="apx-empty">${text}</p>`;
  let mounted = false;

  function init(data) {
    const overview = $('.view[data-view="overview"]');
    if (mounted || !overview || !data) return;
    mounted = true;
    document.body.classList.add('apx-telemetry');
    const hero = $('.td-hero', overview);
    const deck = document.createElement('div');
    deck.className = 'apx-flightdeck';
    if (hero) { hero.before(deck); deck.append(hero); }
    else overview.prepend(deck);
    const replay = document.createElement('section');
    replay.className = 'apx-replay';
    replay.setAttribute('aria-label', '騎行航跡重播');
    deck.append(replay);
    mountReplay(replay, data);
    const snap = $('.td-snap', overview);
    if (snap) deck.after(snap);
    const analytics = document.createElement('div');
    analytics.className = 'apx-analytics';
    analytics.innerHTML = '<section class="apx-chart apx-load" data-anchor="pmc"></section><section class="apx-chart apx-power"></section><section class="apx-chart apx-week"></section>';
    (snap || deck).after(analytics);
    mountLoad($('.apx-load', analytics), window._wellness || {}, 28);
    mountPower($('.apx-power', analytics), data);
    mountWeek($('.apx-week', analytics), data);
    const grid = $('.td-grid', overview);
    if (grid) {
      const archive = document.createElement('details');
      archive.className = 'apx-details';
      archive.innerHTML = '<summary><span><b>訓練明細與日曆</b><small>課表、待辦、歷史訊號與活動紀錄</small></span><span class="apx-plus" aria-hidden="true">＋</span></summary>';
      grid.before(archive); archive.append(grid);
      archive.addEventListener('toggle', () => { if (archive.open) window.__tcalRefresh?.(); });
    }
    if (hero) mountBalance(hero);
    // A dedicated wide chart also leads the longer-term Review view.
    const trends = $('.view[data-view="trends"]');
    if (trends) {
      const load = document.createElement('section'); load.className = 'apx-chart apx-review-load';
      const header = $('.view-h', trends); if (header) header.after(load); else trends.prepend(load);
      mountLoad(load, window._wellness || {}, 84);
    }
  }

  function mountBalance(hero) {
    const st = window.__cinemaState || {};
    const node = document.createElement('div');
    node.className = 'apx-balance';
    const position = D.finite(st.tsb) ? D.clamp((st.tsb + 40) / 80) * 100 : null;
    node.innerHTML = `<div class="apx-balance-head"><span>訓練平衡 <small>CTL − ATL</small></span><b>${D.finite(st.tsb) && st.tsb > 0 ? '+' : ''}${fmt(st.tsb,1)}</b></div><div class="apx-balance-track" aria-hidden="true"><i style="left:${position ?? 50}%;${position == null ? 'display:none' : ''}"></i></div><div class="apx-balance-axis"><span>−40 疲勞累積</span><span>0</span><span>+40 負荷較低</span></div>`;
    $('.td-verdict', hero)?.before(node);
  }

  function mountReplay(root, data) {
    const rides = (data.recent_rides || []).filter(r => D.routeModel(r.route_stream)).slice().sort((a,b) => `${b.date} ${b.time || ''}`.localeCompare(`${a.date} ${a.time || ''}`)).slice(0,24);
    if (!rides.length) { root.innerHTML = fallback('還沒有可重播的 GPS 航跡。活動與訓練圖表仍可查看。'); return; }
    let selected = Math.max(0, rides.findIndex(r => r.sport_type !== 'VirtualRide' && !r.trainer));
    let ride, model, progress = 0, playing = !reduce.matches && !navigator.connection?.saveData, camera = 'orbit', speed = 1;
    let width = 0, height = 0, raf = 0, last = 0, onscreen = true, previousSample = -1;
    let angle = -.45, targetAngle = -.45, pitch = .82, targetPitch = .82, zoom = 1, targetZoom = 1;
    let cx = 0, cz = 0, drag = null, manualAngle = 0, settle = 0;
    root.innerHTML = `<div class="apx-replay-head"><span class="apx-kicker"><i></i>RIDE / REPLAY</span><span class="apx-source"></span></div>
      <label class="apx-route-label" for="apx-route">選擇騎行</label><select id="apx-route">${rides.map((r,i) => `<option value="${i}"${i===selected?' selected':''}>${escape(r.date)} · ${escape(r.name)}${r.sport_type === 'VirtualRide' ? '〔虛擬〕' : ''}</option>`).join('')}</select>
      <div class="apx-route-summary"></div>
      <div class="apx-stage"><canvas aria-label="選中騎行的三維航跡；可拖曳旋轉" role="img"></canvas>
        <div class="apx-camera" role="group" aria-label="路線鏡頭"><button type="button" data-camera="orbit" aria-pressed="true">鳥瞰</button><button type="button" data-camera="chase" aria-pressed="false">追蹤</button><button type="button" data-camera="map" aria-pressed="false">俯視</button></div>
        <div class="apx-stage-caption"><span class="apx-height-note"></span><span>拖曳旋轉</span></div>
      </div>
      <div class="apx-live-values"><div><small>POWER</small><b data-value="watts">—</b><span>W</span></div><div><small>HEART RATE</small><b data-value="hr">—</b><span>bpm</span></div><div><small>SPEED</small><b data-value="speed">—</b><span>km/h</span></div><div><small>ALTITUDE</small><b data-value="elev">—</b><span>m</span></div></div>
      <div class="apx-traces"></div>
      <div class="apx-transport"><button class="apx-play" type="button" aria-label="暫停航跡重播">Ⅱ</button><label class="apx-sr" for="apx-scrub">航跡重播進度</label><input id="apx-scrub" type="range" min="0" max="1000" step="1" value="0"><button class="apx-speed" type="button" aria-label="切換重播速度">1×</button><output class="apx-progress">0%</output></div>
      <div class="apx-replay-foot"><span>GPS 取樣重播 · 非原始時間軸</span><a class="apx-ride-link">這趟紀錄 ↗</a></div>`;
    const canvas = $('canvas', root), context = canvas.getContext('2d');
    const stage = $('.apx-stage', root), scrub = $('#apx-scrub', root), play = $('.apx-play', root);
    const motionOK = () => !document.hidden && onscreen && document.body.dataset.view === 'overview';
    function updateButton() { play.textContent = playing ? 'Ⅱ' : progress >= 1 ? '↺' : '▶'; play.setAttribute('aria-label', playing ? '暫停航跡重播' : progress >= 1 ? '重新播放航跡' : '播放航跡'); play.setAttribute('aria-pressed', String(playing)); }
    function chooseRide(index) {
      selected = index; ride = rides[index]; model = D.routeModel(ride.route_stream); progress = 0; previousSample = -1; cx = cz = 0;
      const virtual = ride.sport_type === 'VirtualRide' || ride.trainer;
      $('.apx-source', root).textContent = `${virtual ? 'VIRTUAL ROUTE' : 'RECORDED GPS'} · ${model.points.length} SAMPLES`;
      $('.apx-route-summary', root).innerHTML = `<b>${escape(ride.date)}</b><span>${fmt(ride.distance_km,1)} km${ride.distance_estimated ? '（估算）' : ''}</span><span>↑ ${fmt(ride.elevation_m)} m</span><span>${fmt((ride.moving_time_sec ?? (ride.moving_time_hr || 0) * 3600) / 60)} min</span>`;
      $('.apx-height-note', root).textContent = model.hasElev ? `高度放大 ${fmt(model.exaggeration,1)}×` : '沒有海拔資料 · 平面航跡';
      const link = $('.apx-ride-link', root); link.href = '#log'; link.dataset.goto = 'log'; link.dataset.actdate = ride.date;
      canvas.setAttribute('aria-label', `${ride.date} ${ride.name}，${virtual ? '虛擬路線' : 'GPS 航跡'}。數值顯示在下方，可用進度滑桿選擇取樣點。`);
      drawTraces(); updateReadings(true); settle = 20; updateButton(); requestDraw();
    }
    function drawTraces() {
      const W = 740, left = 44, right = 682, H = 126;
      const x = (_,p) => left + (model.distance ? p.distance / model.distance : p.index / Math.max(1,model.points.length - 1)) * (right-left);
      let lines = '';
      for (const [row,key,label,color] of [[0,'watts','W','#d5f558'],[1,'hr','bpm','#f0a595'],[2,'elev','m','#75dedb']]) {
        const values = model.points.map(p=>p[key]).filter(D.finite), low = values.length ? Math.min(...values) : 0, high = values.length ? Math.max(...values) : 1;
        const y = v => 11 + row*40 + 25 - (v-low)/(high-low || 1)*25;
        lines += `<text x="2" y="${27+row*40}" fill="${color}">${label}</text><line x1="${left}" x2="${right}" y1="${38+row*40}" y2="${38+row*40}" stroke="#28332c"/><path d="${D.linePath(model.points,x,y,key)}" fill="none" stroke="${color}" stroke-width="1.6"/><text x="692" y="${27+row*40}" fill="#9caaa0">${values.length?fmt(high):'—'}</text>`;
      }
      $('.apx-traces', root).innerHTML = svg(`${lines}<line class="apx-trace-cursor" x1="44" x2="44" y1="3" y2="120" stroke="#eef6e1" stroke-width="1" stroke-dasharray="3 3"/>`,W,H,'功率、心率與海拔取樣曲線，各列使用獨立刻度；右側為該列最大值');
    }
    function updateReadings(force = false) {
      const p = D.sampleRoute(model,progress); if (!p) return;
      scrub.value = Math.round(progress*1000); scrub.setAttribute('aria-valuetext', `航跡 ${Math.round(progress*100)}%，取樣 ${p.raw.index+1}/${model.points.length}`);
      $('.apx-progress',root).textContent = `${Math.round(progress*100)}%`;
      const line = $('.apx-trace-cursor',root); if (line) { const x=44+progress*638;line.setAttribute('x1',x);line.setAttribute('x2',x); }
      if (p.raw.index !== previousSample || force) {
        $$('[data-value]',root).forEach(el=>{el.textContent=fmt(p.raw[el.dataset.value],el.dataset.value==='speed'?1:0)});
        previousSample=p.raw.index;
      }
    }
    function project(p, ground = false) {
      return D.projectPoint(p,{extent:model.extent,cx,cz,angle,pitch,zoom,width,height,map:camera==='map'},ground);
    }
    function strokePath(points,color,lineWidth,ground=false) {
      if (!points.length) return;
      context.beginPath(); points.forEach((p,i)=>{const q=project(p,ground);i?context.lineTo(q.x,q.y):context.moveTo(q.x,q.y)});
      context.strokeStyle=color;context.lineWidth=lineWidth;context.stroke();
    }
    function dot(p,color,r) { context.beginPath();context.arc(p.x,p.y,r,0,Math.PI*2);context.fillStyle=color;context.fill(); }
    function draw(dt) {
      if (!context || !width || !model) return;
      const sample = D.sampleRoute(model,progress), current = sample.raw;
      if(camera==='map'){targetAngle=manualAngle;targetPitch=Math.PI/2;targetZoom=1;}
      else if(camera==='orbit'){targetAngle=-.45+Math.sin(progress*Math.PI*2)*.32+manualAngle;targetPitch=.8;targetZoom=1;}
      else {const next=model.points[Math.min(model.points.length-1,current.index+2)],prev=model.points[Math.max(0,current.index-2)];targetAngle=-Math.atan2(next.x-prev.x,next.z-prev.z)+manualAngle;targetPitch=.94;targetZoom=1.9;}
      // Interpolate shortest angular distance to prevent a full spin at ±π.
      angle+=Math.atan2(Math.sin(targetAngle-angle),Math.cos(targetAngle-angle))*.13;
      pitch+=(targetPitch-pitch)*.13;zoom+=(targetZoom-zoom)*.13;
      cx+=((camera==='chase'?sample.x/model.extent:0)-cx)*.13;cz+=((camera==='chase'?sample.z/model.extent:0)-cz)*.13;
      if(reduce.matches){angle=targetAngle;pitch=targetPitch;zoom=targetZoom;cx=camera==='chase'?sample.x/model.extent:0;cz=camera==='chase'?sample.z/model.extent:0;}
      context.clearRect(0,0,width,height);
      const gradient=context.createRadialGradient(width*.5,height*.5,0,width*.5,height*.5,width*.7);gradient.addColorStop(0,'#182822');gradient.addColorStop(1,'#080f10');context.fillStyle=gradient;context.fillRect(0,0,width,height);
      const extent=model.extent;
      for(let i=-7;i<=7;i++){const v=i/10*extent;strokePath([{x:v,z:-extent*.7,y:0},{x:v,z:extent*.7,y:0}],i===0?'#3d4d3c':'#25342d',.7);strokePath([{x:-extent*.7,z:v,y:0},{x:extent*.7,z:v,y:0}],i===0?'#3d4d3c':'#25342d',.7);}
      context.save();context.beginPath();model.points.forEach((p,i)=>{const q=project(p);i?context.lineTo(q.x,q.y):context.moveTo(q.x,q.y)});[...model.points].reverse().forEach(p=>{const q=project(p,true);context.lineTo(q.x,q.y)});context.closePath();context.fillStyle='rgba(132,195,125,.075)';context.fill();context.restore();
      strokePath(model.points,'rgba(94,150,124,.24)',1,true);
      strokePath(model.points,'#637a65',2.1);
      for(let i=0;i<model.points.length;i+=Math.max(1,Math.floor(model.points.length/32))){const p=model.points[i],top=project(p),bottom=project(p,true);context.beginPath();context.moveTo(top.x,top.y);context.lineTo(bottom.x,bottom.y);context.strokeStyle='rgba(156,201,128,.2)';context.lineWidth=.7;context.stroke();}
      const end=sample.segmentIndex;
      context.save();context.shadowColor='#b7e96a';context.shadowBlur=9;
      strokePath([...model.points.slice(0,end+1),sample],'#d5f558',2.8);context.restore();
      const cursor=project(sample);context.save();context.shadowColor='#d5f558';context.shadowBlur=18;dot(cursor,'#e8ff98',5);context.restore();
      context.beginPath();context.arc(cursor.x,cursor.y,11,0,Math.PI*2);context.strokeStyle='rgba(222,255,151,.55)';context.lineWidth=1;context.stroke();
      const start=project(model.points[0]),finish=project(model.points.at(-1));dot(start,'#75dedb',3.5);dot(finish,'#f0a595',3.5);
      context.font='10px ui-monospace, monospace';context.fillStyle='#91a89a';const north=project({x:0,z:-extent*.66,y:0});context.fillText('N',north.x-3,north.y-9);
      if(progress<.04){context.fillStyle='#75dedb';context.fillText('START',start.x+9,start.y+4);}
      context.font='10px ui-monospace, monospace';context.fillStyle='#83978b';context.fillText(`GPS ${fmt(model.lat,3)} / ${fmt(model.lng,3)}`,16,23);
      context.fillStyle='#bfd19c';context.fillText(`SAMPLE ${String(current.index+1).padStart(3,'0')} / ${model.points.length}`,16,height-15);
      const caption=`${fmt(sample.distance/1000,1)} / ${fmt(model.distance/1000,1)} km`;context.fillText(caption,Math.max(16,width-context.measureText(caption).width-16),height-15);
    }
    function frame(now) {
      raf=0;const dt=last?Math.min(.08,(now-last)/1000):0;last=now;
      if(motionOK()&&playing){progress=D.clamp(progress+dt*speed/55);if(progress>=1){playing=false;updateButton()}updateReadings();}
      draw(dt);settle=Math.max(0,settle-1);
      if(motionOK()&&(playing||(!reduce.matches&&settle>0)))raf=requestAnimationFrame(frame);else last=0;
    }
    function requestDraw(){if(!raf&&motionOK())raf=requestAnimationFrame(frame);}
    function sync(){if(!motionOK()&&raf){cancelAnimationFrame(raf);raf=0;last=0;}else requestDraw();}
    function resize(){const rect=stage.getBoundingClientRect();width=rect.width;height=rect.height;const ratio=Math.min(devicePixelRatio||1,2);canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));context?.setTransform(ratio,0,0,ratio,0,0);requestDraw();}
    $('#apx-route',root).addEventListener('change',e=>chooseRide(Number(e.target.value)));
    play.addEventListener('click',()=>{if(progress>=1)progress=0;playing=!playing;updateButton();updateReadings();requestDraw();});
    scrub.addEventListener('input',()=>{progress=Number(scrub.value)/1000;playing=false;settle=12;updateButton();updateReadings();requestDraw();});
    $('.apx-speed',root).addEventListener('click',e=>{speed=speed===1?2:speed===2?4:1;e.currentTarget.textContent=`${speed}×`;});
    $$('.apx-camera button',root).forEach(button=>button.addEventListener('click',()=>{camera=button.dataset.camera;manualAngle=0;settle=35;$$('.apx-camera button',root).forEach(b=>b.setAttribute('aria-pressed',String(b===button)));requestDraw();}));
    canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={x:e.clientX,angle:manualAngle};canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove',e=>{if(!drag)return;manualAngle=drag.angle+(e.clientX-drag.x)*.007;settle=20;requestDraw();});
    const endDrag=()=>{drag=null;};canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);canvas.addEventListener('lostpointercapture',endDrag);
    addEventListener('strava:hub',()=>{resize();sync();});document.addEventListener('visibilitychange',sync);
    reduce.addEventListener('change',e=>{if(e.matches){playing=false;updateButton();settle=0;requestDraw();}});
    if('ResizeObserver'in window)new ResizeObserver(resize).observe(stage);else addEventListener('resize',resize);
    if('IntersectionObserver'in window)new IntersectionObserver(entries=>{onscreen=entries[0].isIntersecting;sync();},{rootMargin:'80px'}).observe(root);
    chooseRide(selected);resize();
  }

  function mountLoad(root,wellness,initial) {
    let range=initial,rows=[],selected=0;
    const available=Object.keys(wellness).filter(D.day).sort();
    if(!available.length){root.innerHTML=fallback('尚無體能與疲勞紀錄。');return;}
    root.innerHTML=`<div class="apx-chart-head"><div><span class="apx-kicker">LOAD / RESPONSE</span><h2>體能與疲勞</h2></div><div class="apx-segmented" role="group" aria-label="負荷圖表期間">${[7,28,84].map(n=>`<button type="button" data-days="${n}" aria-pressed="${n===range}">${n} 天</button>`).join('')}</div></div><div class="apx-load-reading" aria-live="polite"></div><div class="apx-plot"></div><label class="apx-chart-scrub"><span>選擇日期</span><input aria-label="選擇負荷圖表日期" type="range" min="0" max="27" value="27"></label><div class="apx-chart-legend"><span style="--series:#d5f558">體能 CTL</span><span style="--series:#75dedb">疲勞 ATL</span><span style="--series:#a9b4a1">下方柱：CTL − ATL</span></div>`;
    const plot=$('.apx-plot',root), slider=$('input',root), W=720,H=265,L=43,R=701;
    function reading(){const p=rows[selected];$('.apx-load-reading',root).innerHTML=`<span>${escape(p.date)}</span><b>${fmt(p.ctl,1)}<small>CTL</small></b><b class="apx-cyan">${fmt(p.atl,1)}<small>ATL</small></b><b>${D.finite(p.tsb)&&p.tsb>0?'+':''}${fmt(p.tsb,1)}<small>平衡</small></b>`;const x=L+selected/Math.max(1,rows.length-1)*(R-L);const line=$('.apx-crosshair',root);if(line){line.setAttribute('x1',x);line.setAttribute('x2',x)}slider.value=selected;slider.setAttribute('aria-valuetext',`${p.date}，體能 ${fmt(p.ctl,1)}，疲勞 ${fmt(p.atl,1)}`);}
    function render(){rows=D.wellnessRows(wellness,range);selected=rows.length-1;slider.max=rows.length-1;const ceiling=Math.max(20,Math.ceil(Math.max(0,...rows.flatMap(p=>[p.ctl,p.atl]).filter(D.finite))/20)*20),tsbMax=Math.max(10,...rows.map(p=>Math.abs(p.tsb||0)));const x=i=>L+i/Math.max(1,rows.length-1)*(R-L),y=v=>170-v/ceiling*145;let grid='';for(let i=0;i<=4;i++){const v=ceiling*i/4;grid+=`<line x1="${L}" x2="${R}" y1="${y(v)}" y2="${y(v)}" stroke="#303c31" stroke-dasharray="2 5"/><text x="${L-9}" y="${y(v)+4}" text-anchor="end">${fmt(v)}</text>`;}
      const bars=rows.map((p,i)=>{if(p.tsb==null)return '';const h=Math.abs(p.tsb)/tsbMax*23;return `<rect x="${x(i)-Math.min(6,(R-L)/rows.length*.33)}" y="${p.tsb>=0?214-h:214}" width="${Math.min(12,(R-L)/rows.length*.66)}" height="${Math.max(.6,h)}" fill="${p.tsb>=0?'#a5ba79':'#cc9382'}" opacity=".6"/>`}).join('');
      plot.innerHTML=svg(`${grid}<path class="apx-draw-line" d="${D.linePath(rows,x,y,'atl')}" stroke="#75dedb"/><path class="apx-draw-line" d="${D.linePath(rows,x,y,'ctl')}" stroke="#d5f558"/><text x="5" y="217">TSB</text><line x1="${L}" x2="${R}" y1="214" y2="214" stroke="#52604a"/>${bars}<text x="${L}" y="259">${md(rows[0].date)}</text><text x="${(L+R)/2}" y="259" text-anchor="middle">${md(rows[Math.floor(rows.length/2)].date)}</text><text x="${R}" y="259" text-anchor="end">${md(rows.at(-1).date)}</text>${marker}`,W,H,`${range}天體能與疲勞曲線，共用縱軸，下方為訓練平衡；缺少的日期不連線`);reading();}
    $$('.apx-segmented button',root).forEach(b=>b.addEventListener('click',()=>{range=Number(b.dataset.days);$$('.apx-segmented button',root).forEach(x=>x.setAttribute('aria-pressed',String(x===b)));render();}));
    slider.addEventListener('input',()=>{selected=Number(slider.value);reading()});
    plot.addEventListener('pointermove',e=>{if(e.pointerType==='touch'&&e.buttons===0)return;const rect=plot.getBoundingClientRect();selected=Math.round(D.clamp(((e.clientX-rect.left)/rect.width*W-L)/(R-L))*(rows.length-1));reading();});
    render();
  }

  function mountPower(root,data) {
    const records=D.powerRecords(data);if(!records.length){root.innerHTML=fallback('尚無功率最佳紀錄。');return;}
    let selected=Math.max(0,records.findIndex(p=>p.duration_sec===1200));
    const W=460,H=230,L=36,R=444,top=Math.ceil(Math.max(...records.map(p=>p.watts))/200)*200;
    const logMin=Math.log(records[0].duration_sec),logSpan=Math.log(records.at(-1).duration_sec)-logMin||1;
    const x=(_,p)=>L+(Math.log(p.duration_sec)-logMin)/logSpan*(R-L),y=v=>187-v/top*159;
    let grid='';for(let n=0;n<=4;n++){const v=top*n/4;grid+=`<line x1="${L}" x2="${R}" y1="${y(v)}" y2="${y(v)}" stroke="#303c31" stroke-dasharray="2 5"/><text x="${L-8}" y="${y(v)+4}" text-anchor="end">${fmt(v)}</text>`;}
    const path=D.linePath(records,x,y,'watts');
    root.innerHTML=`<div class="apx-chart-head"><div><span class="apx-kicker">POWER / SIGNATURE</span><h2>功率指紋</h2></div><span class="apx-chart-tag">歷史最佳</span></div><div class="apx-power-reading"></div><div class="apx-power-plot">${svg(`${grid}<path d="${path} L${x(0,records.at(-1))},187 L${L},187 Z" fill="rgba(213,245,88,.065)"/><path d="${path}" class="apx-draw-line" stroke="#d5f558"/>${records.map((p,i)=>`<circle cx="${x(i,p)}" cy="${y(p.watts)}" r="3" fill="#d5f558"/>`).join('')}<circle class="apx-power-dot" r="6" fill="#efffd1" stroke="#9bbb63" stroke-width="4"/><text x="${L}" y="220">${duration(records[0].duration_sec)}</text><text x="${R}" y="220" text-anchor="end">${duration(records.at(-1).duration_sec)} · 對數時間軸</text>`,W,H,'歷史最佳功率曲線：橫軸為持續時間（對數），縱軸為瓦數')}</div><div class="apx-power-pills" role="group" aria-label="選擇功率持續時間">${records.map((p,i)=>`<button type="button" data-record="${i}" aria-pressed="${i===selected}">${duration(p.duration_sec)}</button>`).join('')}</div><button class="apx-record-link" type="button">查看這筆最佳紀錄 ↗</button>`;
    function reading(){const p=records[selected];$('.apx-power-reading',root).innerHTML=`<b>${fmt(p.watts)}<small>W</small></b><span>${duration(p.duration_sec)} 最大平均功率<small>${escape(p.date || '日期未記錄')}</small></span>`;const circle=$('.apx-power-dot',root);circle.setAttribute('cx',x(selected,p));circle.setAttribute('cy',y(p.watts));$('.apx-record-link',root).dataset.power=p.duration_sec;$$('[data-record]',root).forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.record)===selected)));}
    $$('[data-record]',root).forEach(b=>b.addEventListener('click',()=>{selected=Number(b.dataset.record);reading()}));
    $('.apx-power-plot',root).addEventListener('pointermove',e=>{if(e.pointerType==='touch'&&e.buttons===0)return;const box=e.currentTarget.getBoundingClientRect(),px=(e.clientX-box.left)/box.width*W;selected=records.reduce((best,p,i)=>Math.abs(x(i,p)-px)<Math.abs(x(best,records[best])-px)?i:best,0);reading()});reading();
  }

  function mountWeek(root,data) {
    const rows=D.dailyActivity(data,14),max=Math.max(60,...rows.map(p=>p.minutes));
    const total=rows.reduce((n,p)=>n+p.minutes,0),count=rows.reduce((n,p)=>n+p.count,0);
    root.innerHTML=`<div class="apx-chart-head"><div><span class="apx-kicker">CONSISTENCY / 14 DAYS</span><h2>每一天，都算數。</h2></div><div class="apx-week-total"><b>${fmt(total/60,1)}<small>小時</small></b><span>${count} 次訓練</span></div></div><div class="apx-week-bars" role="group" aria-label="近十四天訓練時數">${rows.map((p,i)=>`<button type="button" class="apx-day" data-day="${i}" aria-label="${p.date}，${fmt(p.minutes)}分鐘，${p.count}次訓練" aria-pressed="false"><span class="apx-day-value">${p.minutes?fmt(p.minutes):'·'}</span><span class="apx-day-track">${Object.entries(p.types).map(([type,m])=>`<i style="height:${m/max*100}%;background:${typeColors[type]}"></i>`).join('')}</span><span class="apx-day-label">${md(p.date)}</span></button>`).join('')}</div><div class="apx-week-bottom"><p class="apx-day-reading" aria-live="polite">選一天，查看訓練紀錄。柱高以分鐘計。</p><div class="apx-chart-legend">${[['ride','騎行'],['run','跑步'],['swim','游泳'],['weight','重訓']].map(([k,l])=>`<span style="--series:${typeColors[k]}">${l}</span>`).join('')}</div></div>`;
    $$('[data-day]',root).forEach(b=>b.addEventListener('click',()=>{const p=rows[Number(b.dataset.day)];$$('[data-day]',root).forEach(x=>x.setAttribute('aria-pressed',String(x===b)));const read=$('.apx-day-reading',root);read.innerHTML=`${escape(p.date)} · ${fmt(p.minutes)} 分鐘 · ${p.count} 次訓練 ${p.count?`<button type="button" data-goto="log" data-actdate="${p.date}">查看紀錄 ↗</button>`:'· 沒有已同步紀錄'}`;}));
  }
  addEventListener('strava:ready',e=>init(e.detail?.data));
  if(window.__cinemaData)init(window.__cinemaData);
})();
