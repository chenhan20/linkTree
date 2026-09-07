const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const D = require('../strava-apex-data.js');
const root = resolve(__dirname, '..');
const data = JSON.parse(readFileSync(resolve(root, 'data/strava.json')));
const wellness = JSON.parse(readFileSync(resolve(root, 'data/fit/_wellness.json')));

test('route geometry uses metres, preserves missing telemetry and retains zero watts', () => {
  const m = D.routeModel([[25,121,0,0,null,0],[25.001,121,150,24,300,null],[25.002,121,155,30,305,250]]);
  assert(m.distance > 220 && m.distance < 224);
  assert.equal(m.points[0].hr, null);
  assert.equal(m.points[0].watts, 0);
  assert.equal(m.points[1].watts, null);
  assert.equal(m.points[0].elev, null);
  assert.equal(m.points[0].speed, 0);
  assert.equal(D.routeModel([[null,121],['25',121],[Infinity,121]]), null);
  assert.equal(D.routeModel(undefined), null);
});

test('sampling clamps endpoints and finishes on the last sample, including stationary endings', () => {
  const m = D.routeModel([[25,121,100,0,20,0],[25.001,121,120,20,25,150],[25.001,121,110,0,25,0]]);
  assert.equal(D.sampleRoute(m,-1).raw.index,0);
  assert.equal(D.sampleRoute(m,1).raw.index,2);
  assert.equal(D.sampleRoute(m,2).distance,m.distance);
  const halfway=D.sampleRoute(m,.5);
  assert(Math.abs(halfway.distance-m.distance*.5)<.001);
  assert(halfway.x===0 && Number.isFinite(halfway.z));
});

test('top-down camera keeps north above and east right, without flattening the map', () => {
  const camera={extent:1000,cx:0,cz:0,angle:0,pitch:Math.PI/2,zoom:1,width:800,height:400,map:true};
  const centre=D.projectPoint({x:0,y:0,z:0},camera);
  const north=D.projectPoint({x:0,y:0,z:-100},camera);
  const east=D.projectPoint({x:100,y:0,z:0},camera);
  assert(north.y<centre.y);assert(east.x>centre.x);
  assert(Math.abs(north.x-centre.x)<1e-8);
  const high=D.projectPoint({x:0,y:100,z:0},camera);
  assert(Math.abs(high.y-centre.y)<1e-8);
});

test('wellness chart uses calendar dates and leaves missing days as gaps', () => {
  const rows=D.wellnessRows({'2026-09-01':{ctl:30,atl:40},'2026-09-03':{ctl:31}},3);
  assert.deepEqual(rows.map(r=>r.date),['2026-09-01','2026-09-02','2026-09-03']);
  assert.equal(rows[0].tsb,-10);assert.equal(rows[1].ctl,null);assert.equal(rows[2].tsb,null);
  const path=D.linePath(rows,i=>i*10,v=>v,'ctl');
  assert.equal(path,'M0.00,30.00  M20.00,31.00');
  assert.deepEqual(D.wellnessRows({},7),[]);
});

test('activity chart includes all four sports, uses seconds before rounded hours, and excludes future records', () => {
  const rows=D.dailyActivity({recent_rides:[{date:'2026-09-01',moving_time_sec:90,moving_time_hr:1}],recent_runs:[{date:'2026-09-01',moving_time_hr:.5}],recent_swims:[{date:'2026-09-01',moving_time_sec:600}],recent_weights:[{date:'2026-09-01',moving_time_hr:1},{date:'2026-09-02',moving_time_hr:9}]},1,'2026-09-01');
  assert.equal(rows[0].minutes,101.5);assert.equal(rows[0].count,4);
  assert.deepEqual(rows[0].types,{ride:1.5,run:30,swim:10,weight:60});
});

test('power chart sorts actual best efforts and excludes invalid durations', () => {
  const records=D.powerRecords({power_prs:[{duration_sec:60,watts:400},{duration_sec:0,watts:500},{duration_sec:5,watts:900},{duration_sec:120,watts:null}]});
  assert.deepEqual(records.map(p=>p.duration_sec),[5,60]);
  assert.equal(D.powerRecords(data).length,data.power_prs.length);
});

test('all real GPS routes sample and project to finite positions in every camera', () => {
  let routes=0;
  for(const ride of data.recent_rides){
    const model=D.routeModel(ride.route_stream);if(!model)continue;routes++;
    for(let i=0;i<=100;i++){
      const p=D.sampleRoute(model,i/100);
      assert(model.points.includes(p.raw));
      for(const pitch of [.8,.94,Math.PI/2]){
        const point=D.projectPoint(p,{extent:model.extent,cx:0,cz:0,angle:-.45,pitch,zoom:1.9,width:360,height:285,map:pitch===Math.PI/2});
        assert(Number.isFinite(point.x)&&Number.isFinite(point.y));
      }
    }
    assert.equal(D.sampleRoute(model,1).raw,model.points.at(-1));
  }
  assert(routes>20);
});

test('the real wellness series retains CTL minus ATL for every complete day', () => {
  const rows=D.wellnessRows(wellness,84);assert.equal(rows.length,84);
  for(const p of rows)if(p.ctl!==null&&p.atl!==null)assert.equal(p.tsb,p.ctl-p.atl);
  assert.equal(rows.at(-1).date,Object.keys(wellness).sort().at(-1));
});

test('all inline scripts still parse after the Cinema-to-telemetry integration', () => {
  const html=readFileSync(resolve(root,'strava_apex.html'),'utf8');
  const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  for(const [,attributes,source]of scripts){if(attributes.includes('src=')||attributes.includes('type="module"'))continue;new vm.Script(source);}
  assert(html.includes("dispatchEvent(new CustomEvent('strava:ready'"));
  assert(!html.includes('strava-cinema-fx.js?v='));
  assert(!html.includes('data-mp4="${esc(media.mp4)}"'));
});

test('the retained readiness template renders populated and missing-data states without film dependencies', () => {
  const html=readFileSync(resolve(root,'strava_apex.html'),'utf8');
  const start=html.indexOf('  const tpeToday =');
  const end=html.indexOf('  function mountToday(data)',start);
  assert(start>0&&end>start);
  const context={window:{},matchMedia:()=>({matches:true}),mdBold:t=>t,MC_PASS:()=>({}),domsAdvice:()=>''};
  vm.createContext(context);
  vm.runInContext(html.slice(start,end)+'\nwindow.heroTest=todayHeroHTML;',context);
  const V={level:'go',today:'2026-09-05',judgeDay:'2026-09-05',reasons:[{k:'TSB',v:'-2.5',s:'CTL 29 / ATL 32',lvl:0}],notes:[],tasks:[]};
  const out=context.window.heroTest({},V);
  assert(out.includes('照表'));assert(out.includes('-2.5'));assert(!out.includes('<video'));
  const empty=context.window.heroTest({},{...V,level:'nodata',reasons:[]});assert(empty.includes('資料不足'));
  const next=context.window.heroTest({},{...V,next:{date:'2026-09-06',name:'Tempo',target:{if:.75,tss:80},plan:'90 分鐘'}});
  assert(next.includes('Tempo'));assert(next.includes('data-ses="2026-09-06"'));
});
