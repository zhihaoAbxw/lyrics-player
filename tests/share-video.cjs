const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../dist/share-video.js'),'utf8');
const u32=value=>{const b=Buffer.alloc(4);b.writeUInt32BE(value);return b;};
const box=(type,...parts)=>{const data=Buffer.concat(parts);return Buffer.concat([u32(data.length+8),Buffer.from(type),data]);};
function fixture({version=0,duration=0,codec='avc1'}={}){
  const timing=Buffer.alloc(version?32:20);timing[0]=version;timing.writeUInt32BE(1000,version?20:12);
  if(version){timing.writeUInt32BE(0,24);timing.writeUInt32BE(duration,28);}else timing.writeUInt32BE(duration,16);
  const track=Buffer.alloc(version?36:24);track[0]=version;track.writeUInt32BE(duration,version?32:20);
  const stsd=box('stsd',Buffer.alloc(4),u32(1),box(codec,Buffer.alloc(78)));
  return Buffer.concat([box('ftyp',Buffer.from('isom'),u32(0),Buffer.from('isomavc1')),box('moov',box('mvhd',timing),box('trak',box('tkhd',track),box('mdia',box('mdhd',timing),box('minf',box('stbl',stsd))))),box('moof',Buffer.alloc(8)),box('mdat',Buffer.from([1,2,3,4]))]);
}
function setup(options={}){
  let next=0,now=0;const tasks=new Map(),tracks=[],urls=[],revoked=[],draws=[],fills=[],frames=[],recorders=[],canvases=[];
  function schedule(fn,delay,repeat=false){const id=++next;tasks.set(id,{fn,at:now+delay,delay,repeat});return id;}
  const context={Blob,DOMException,performance:{now:()=>now},Uint8Array,DataView,Number,String,Error,Math,Promise,
    setTimeout:(fn,ms)=>schedule(fn,ms),clearTimeout:id=>tasks.delete(id),
    setInterval:(fn,ms)=>schedule(fn,ms,true),clearInterval:id=>tasks.delete(id),
    URL:{createObjectURL:()=>{const url=`blob:test-${urls.length}`;urls.push(url);return url;},revokeObjectURL:url=>revoked.push(url)},
    document:{createElement:()=>{
      const drawing={fillRect(...args){fills.push({color:this.fillStyle,args});},drawImage(...args){draws.push(args);frames.push({width:canvas.width,height:canvas.height});}};
      const canvas={width:0,height:0,getContext:()=>drawing,captureStream(){const track={stops:0,frames:0,stop(){this.stops++;},requestFrame(){this.frames++;}};tracks.push(track);return {getTracks:()=>[track],getVideoTracks:()=>[track]};}};
      if(options.noCapture)delete canvas.captureStream;canvases.push(canvas);return canvas;
    }},
    Image:class{
      set src(value){this.value=value;if(value&&options.image!==false)schedule(()=>{this.naturalWidth=options.width||1080;this.naturalHeight=options.height||1440;this.onload?.();},1);}
      get src(){return this.value;}
    },
    MediaRecorder:class{
      static isTypeSupported(type){return options.support!==false&&type.startsWith('video/mp4');}
      constructor(stream,settings){if(options.constructError)throw Error('encoder unavailable');this.mimeType=options.mime||settings.mimeType;this.state='inactive';recorders.push(this);}
      start(){this.state='recording';if(options.encoderError)schedule(()=>this.onerror?.({}),50);}
      stop(){this.state='inactive';if(options.neverStop)return;schedule(()=>{this.ondataavailable?.({data:new Blob(options.empty?[]:[options.bytes||fixture(options)],{type:options.chunkType||this.mimeType})});this.onstop?.();},1);}
    }
  };
  vm.runInNewContext(source,context);
  async function tick(ms){const end=now+ms;while(true){let selected;for(const [id,task]of tasks)if(task.at<=end&&(!selected||task.at<selected[1].at))selected=[id,task];if(!selected)break;const[id,task]=selected;now=task.at;if(task.repeat)task.at+=task.delay;else tasks.delete(id);task.fn();await Promise.resolve();}now=end;for(let i=0;i<8;i++)await Promise.resolve();}
  return {api:context.LyricVideo,tick,tasks,tracks,urls,revoked,draws,fills,frames,recorders,canvases};
}
const jpg=()=>new Blob(['jpeg'],{type:'image/jpeg'});
function clean(env){assert.equal(env.tasks.size,0,'all timers released');assert.equal(env.revoked.length,env.urls.length,'all image URLs released');assert.ok(env.tracks.every(t=>t.stops===1),'all capture tracks stopped exactly once');}
async function result(env,settings){const pending=env.api.create(jpg(),settings);await env.tick(4100);return pending;}
const tests=[];function test(name,run){tests.push([name,run]);}
test('explicit AVC MP4 and capture support required',async()=>{for(const options of[{support:false},{noCapture:true}]){const e=setup(options);assert.equal(e.api.isSupported(),false);await assert.rejects(e.api.create(jpg()),/不支持/);clean(e);}});
test('4 second silent video fills a 3:4 frame exactly and repeats the whole poster',async()=>{const e=setup();assert.equal(e.api.isSupported(),true);const blob=await result(e);assert.equal(blob.type,'video/mp4');const data=Buffer.from(await blob.arrayBuffer());assert.equal(data.toString('ascii',4,8),'ftyp');assert.ok(e.draws.length>50);for(let i=0;i<e.draws.length;i++){assert.deepEqual(e.draws[i].slice(1),[0,0,1080,1440]);assert.deepEqual(e.frames[i],{width:1080,height:1440});assert.deepEqual(e.fills[i],{color:'#f7f5ee',args:[0,0,1080,1440]});}assert.equal(e.recorders.length,1);assert.ok(e.tracks[0].frames>50);clean(e);});
test('tall and wide images stay centred, proportional and entirely inside the 3:4 frame',async()=>{for(const source of[{width:1080,height:2600},{width:2400,height:1080}]){const e=setup(source);await result(e);const[,x,y,w,h]=e.draws[0];assert.deepEqual(e.frames[0],{width:1080,height:1440});assert.ok(x>=0&&y>=0);assert.ok(x+w<=1080&&y+h<=1440);assert.ok(Math.abs(w/h-source.width/source.height)<1e-9);assert.ok(Math.abs(x*2+w-1080)<1e-9);assert.ok(Math.abs(y*2+h-1440)<1e-9);if(source.height>source.width){assert.equal(h,1440);assert.ok(x>0);assert.equal(y,0);}else{assert.equal(w,1080);assert.equal(x,0);assert.ok(y>0);}assert.deepEqual(e.fills[0],{color:'#f7f5ee',args:[0,0,1080,1440]});clean(e);}});
test('zero duration movie, track and media fields gain finite durations',async()=>{for(const version of[0,1]){const e=setup({version});const data=Buffer.from(await(await result(e)).arrayBuffer());for(const type of['mvhd','mdhd']){const start=data.indexOf(type)-4;const value=data.readUInt32BE(start+(version?36:24));assert.equal(value,4000);}const start=data.indexOf('tkhd')-4;assert.equal(data.readUInt32BE(start+(version?40:28)),4000);clean(e);}});
test('existing valid MP4 durations remain unchanged',async()=>{const e=setup({duration:4123});const data=Buffer.from(await(await result(e)).arrayBuffer());assert.equal(data.readUInt32BE(data.indexOf('mvhd')-4+24),4123);clean(e);});
test('pre-abort does not allocate resources',async()=>{const e=setup(),controller=new AbortController();controller.abort();await assert.rejects(e.api.create(jpg(),{signal:controller.signal}),{name:'AbortError'});assert.equal(e.urls.length,0);clean(e);});
test('abort while image loading revokes URL and timeout',async()=>{const e=setup({image:false}),controller=new AbortController();const pending=e.api.create(jpg(),{signal:controller.signal});controller.abort();await assert.rejects(pending,{name:'AbortError'});clean(e);});
test('abort during recording stops stream and frame timer',async()=>{const e=setup(),controller=new AbortController();const pending=e.api.create(jpg(),{signal:controller.signal});await e.tick(200);controller.abort();await assert.rejects(pending,{name:'AbortError'});await e.tick(2);clean(e);});
test('encoder errors stop all resources',async()=>{const e=setup({encoderError:true}),pending=e.api.create(jpg());const check=assert.rejects(pending,/编码失败/);await e.tick(100);await check;clean(e);});
test('constructor failure releases capture track',async()=>{const e=setup({constructError:true}),pending=e.api.create(jpg());const check=assert.rejects(pending,/encoder unavailable/);await e.tick(2);await check;clean(e);});
test('unresponsive recorder times out and releases everything',async()=>{const e=setup({neverStop:true}),pending=e.api.create(jpg());const check=assert.rejects(pending,/超时/);await e.tick(16000);await check;clean(e);});
test('WebM MIME is rejected rather than renamed',async()=>{const e=setup({chunkType:'video/webm'}),pending=e.api.create(jpg());const check=assert.rejects(pending,/未输出 MP4/);await e.tick(4100);await check;clean(e);});
test('WebM bytes disguised as MP4 are rejected',async()=>{const e=setup({bytes:Buffer.from([0x1a,0x45,0xdf,0xa3,0,0,0,0])}),pending=e.api.create(jpg());const check=assert.rejects(pending,/MP4/);await e.tick(4100);await check;clean(e);});
test('MP4 using another codec is rejected',async()=>{const e=setup({codec:'vp09'}),pending=e.api.create(jpg());const check=assert.rejects(pending,/H.264/);await e.tick(4100);await check;clean(e);});
test('empty video and invalid image are rejected',async()=>{const e=setup({empty:true}),pending=e.api.create(jpg());const check=assert.rejects(pending,/有效的 MP4/);await e.tick(4100);await check;await assert.rejects(e.api.create(new Blob(['png'],{type:'image/png'})),/JPG/);clean(e);});
(async()=>{let count=0;for(const[name,run]of tests){await run();count++;console.log(`✓ ${name}`);}console.log(`${count} share-video checks passed`);})().catch(error=>{console.error(error);process.exitCode=1;});
