'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const sourcePath = process.argv[2] || require('node:path').join(__dirname, '../dist/app.js');
const flush = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };
const deferred = () => { let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}; };
const audioBlob = ({size=1024,tag}={}) => Object.assign(new Blob([new Uint8Array(size)],{type:'audio/mpeg'}),{tag});
class ClassList {
 constructor(el){this.el=el;this.values=new Set()}
 add(...xs){xs.forEach(x=>this.values.add(x))}
 remove(...xs){xs.forEach(x=>this.values.delete(x))}
 contains(x){return this.values.has(x)}
 toggle(x,force){const value=force??!this.values.has(x);if(value)this.add(x);else this.remove(x);return value}
}
class Element {
 constructor(id=''){Object.assign(this,{id,children:[],listeners:{},attributes:{},dataset:{},textContent:'',value:'0',max:'100',disabled:false,scrollTop:0,scrollLeft:0,clientWidth:400,clientHeight:400,offsetHeight:20,offsetTop:0});this.classList=new ClassList(this)}
 set className(v){this._className=v;this.classList.values=new Set(v.split(/\s+/))}
 get className(){return this._className||''}
 set innerHTML(v){this._innerHTML=v;this.trackName=new Element('track-name');this.trackState=new Element('track-state')}
 querySelector(s){if(s==='span')return this.guide??=new Element('span');if(s==='.track-name')return this.trackName;if(s==='.track-state')return this.trackState;if(s==='.active')return this.children.find(x=>x.classList.contains('active'))??null;return null}
 querySelectorAll(s){return this.children.flatMap(x=>[...(s==='input'&&x.id==='input'?[x]:[]),...x.querySelectorAll(s)])}
 addEventListener(type,handler){(this.listeners[type]??=[]).push(handler)}
 emit(type,props={}){const event={type,target:this,...props};for(const fn of [...this.listeners[type]??[]])fn(event)}
 click(){if(this.disabled)return;this.onclick?.({target:this});this.emit('click')}
 replaceChildren(...children){this.children=children}
 append(...children){children.forEach(x=>{x.offsetTop=this.children.length*24;this.children.push(x)})}
 setAttribute(k,v){this.attributes[k]=String(v)}
 removeAttribute(k){delete this.attributes[k]}
 getAttribute(k){return this.attributes[k]??null}
 scrollTo(o){if(o.top!=null)this.scrollTop=o.top;if(o.left!=null)this.scrollLeft=o.left}
 contains(el){return this.children.includes(el)}
 focus(){this.focused=true}
 showModal(){this.open=true}
 close(){this.open=false;this.emit('close')}
}
class Audio extends Element {
 constructor(){super('audio');Object.assign(this,{src:'',currentSrc:'',readyState:0,duration:NaN,paused:true,seeking:false,ended:false,error:null,_time:0,playCalls:[],seekCalls:[]})}
 get currentTime(){return this._time}
 set currentTime(v){assert(Number.isFinite(v));this._time=v;this.seeking=true;this.ended=false;this.seekCalls.push(v)}
 removeAttribute(k){super.removeAttribute(k);if(k==='src')this.src=''}
 load(){this.currentSrc=this.src;this.readyState=0;this.duration=NaN;this._time=0;this.ended=false;this.seeking=false;this.error=null}
 pause(){const changed=!this.paused;this.paused=true;if(changed)this.emit('pause')}
 play(){const d=deferred();this.playCalls.push(d);this.paused=false;this.emit('play');if(!this.deferPlay)d.resolve();return d.promise}
 metadata(value=300){this.duration=value;this.readyState=1;this.emit('durationchange');this.emit('loadedmetadata')}
 finishSeek(){this.seeking=false;this.emit('seeked')}
 tick(v){this._time=v;this.emit('timeupdate')}
 end(){this._time=this.duration;this.paused=true;this.ended=true;this.emit('pause');this.emit('ended')}
 fail(code=3){this.error={code};this.paused=true;this.emit('error')}
}
function app({mode,storageThrows=false,extraTracks=[],withLizhiLibrary=false,withMediaSession=false,withShare=false,deferCover=false,canvasMime,emptyCanvas=false,withVideo=false}={}) {
 const els=new Map([['#audio',new Audio()]]),requests=[],created=[],revoked=[],active=new Set(),values=new Map(mode?[['playMode',mode]]:[]),timers=new Map(),windowEvents=new Element(),warnings=[];let timerId=0,now=0;
 const $=s=>{if(!els.has(s))els.set(s,new Element(s));return els.get(s)};
 const storage={get length(){return values.size},key:i=>[...values.keys()][i],getItem:k=>{if(storageThrows)throw Error('blocked');return values.get(k)??null},setItem:(k,v)=>{if(storageThrows)throw Error('blocked');values.set(k,v)},removeItem:k=>{if(storageThrows)throw Error('blocked');values.delete(k)}};
 const mediaSession={actions:{},positions:[],setActionHandler(name,fn){this.actions[name]=fn},setPositionState(state){this.positions.push(state)}};
 class TestURL extends URL {static createObjectURL(blob){const url=`blob:test/${created.length+1}`;created.push({url,blob});active.add(url);return url}static revokeObjectURL(url){revoked.push(url);active.delete(url)}}
 const context={document:{querySelector:$,createElement:()=>new Element(),baseURI:'https://player.test/'},localStorage:storage,indexedDB:{deleteDatabase:()=>({})},navigator:withMediaSession?{mediaSession}:{},MediaMetadata:class{constructor(data){Object.assign(this,data)}},Blob,AbortController,URL:TestURL,fetch:(url,options={})=>{const d=deferred();const req={url,signal:options.signal,...d};requests.push(req);return d.promise},setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms,due:now+ms});return timerId},clearTimeout:id=>timers.delete(id),requestAnimationFrame:()=>1,addEventListener(){},console:{...console,warn:(...args)=>warnings.push(args)}};
 context.addEventListener=(...args)=>windowEvents.addEventListener(...args);
 const cards=[],coverImages=[],shares=[],videos=[];
 context.LyricVideo={isSupported:()=>withVideo,create:(blob,{signal})=>{const d=deferred();videos.push({blob,signal,...d});return d.promise}};
 context.File=File;
 context.Image=class {constructor(){this.naturalWidth=945;this.naturalHeight=945;coverImages.push(this)}set src(value){this.url=value;if(!deferCover)Promise.resolve().then(()=>this.onload?.())}};
 context.document.createElement=tag=>{
  if(tag!=='canvas')return new Element(tag);
  const card={text:[],width:0,height:0};cards.push(card);
  const drawing={measureText:text=>({width:Array.from(text).length*26}),fillText:text=>card.text.push(text)};
  for(const method of ['fillRect','beginPath','arc','fill','save','rect','clip','drawImage','restore','moveTo','lineTo','stroke'])drawing[method]=()=>{};
  card.getContext=()=>drawing;card.toBlob=(callback,type,quality)=>{card.encoding={type,quality};callback(new Blob(emptyCanvas?[]:['encoded-image'],{type:canvasMime??type}))};return card;
 };
 if(withShare){context.navigator.canShare=()=>true;context.navigator.share=data=>{const d=deferred();shares.push({data,...d});return d.promise}}
 vm.runInNewContext(fs.readFileSync(require('node:path').join(require('node:path').dirname(sourcePath),'share-card.js'),'utf8'),context);
 vm.runInNewContext(fs.readFileSync(require('node:path').join(require('node:path').dirname(sourcePath),'lyric-share.js'),'utf8'),context);
 const source=fs.readFileSync(sourcePath,'utf8');
 if(withLizhiLibrary)vm.runInNewContext(fs.readFileSync(require('node:path').join(require('node:path').dirname(sourcePath),'catalog-lizhi.js'),'utf8'),context);
 assert(source.includes('  const $ = selector'));
 const fixture=extraTracks.length ? `  catalog.push(...${JSON.stringify(extraTracks)});\n` : '';
 vm.runInNewContext(source.replace('  const $ = selector',fixture+'  const $ = selector'),context,{filename:sourcePath});
 const getReq=(number,kind='audio',nth=-1)=>{const url=kind==='audio'?`audio/${String(number).padStart(2,'0')}.mp3`:`lyrics/${String(number).padStart(2,'0')}.lrc`;const found=requests.filter(x=>x.url===url);return nth<0?found.at(nth):found[nth]};
 const resolveAudio=async(number,{blob,ok=true,status=ok?200:404,nth=-1}={})=>{const req=getReq(number,'audio',nth);assert(req,`missing audio request ${number}`);req.resolve({ok,status,headers:{get:key=>key.toLowerCase()==='content-type'?'audio/mpeg':null},blob:()=>Promise.resolve(blob??audioBlob({tag:number}))});await flush();return req};
 const resolveLyrics=async(number,text=`[00:01]Track ${number}\n[00:45]Later ${number}`,nth=-1)=>{const req=getReq(number,'lyrics',nth);req.resolve({ok:true,text:()=>Promise.resolve(text)});await flush();return req};
 const ready=async(number=1,total=300)=>{await resolveAudio(number);$('#audio').metadata(total);await flush()};
 const fireTimers=ms=>{for(const [id,timer]of [...timers])if(timer.ms===ms){timers.delete(id);timer.fn()}};
 const advanceTimers=async ms=>{const end=now+ms;for(;;){const next=[...timers].filter(([,timer])=>timer.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;const [id,timer]=next;now=timer.due;timers.delete(id);timer.fn();await flush()}now=end};
 return {$,importedTracks:context.LIZHI_TRACKS,audio:$('#audio'),requests,created,revoked,active,getReq,resolveAudio,resolveLyrics,ready,select:number=>$('#trackList').children[number-1].click(),flush,fireTimers,advanceTimers,mediaSession,windowEvents,warnings,cards,coverImages,shares,videos};
}
const tests=[];function test(name,fn){tests.push({name,fn})}
test('Rapid reversed audio and lyric loads keep only final track',async()=>{const a=app();a.select(2);a.select(3);await a.resolveLyrics(3);await a.resolveAudio(3);a.audio.metadata();await a.resolveLyrics(2);await a.resolveAudio(2);await a.resolveLyrics(1);await a.resolveAudio(1);assert.equal(a.$('#trackTitle').textContent,'凌晨计程车');assert.equal(a.$('#lyrics').children[0].textContent,'Track 3');assert.equal(a.created.length,1);assert.equal(a.created[0].blob.tag,3);assert.equal(a.audio.playCalls.length,1);assert(a.getReq(1).signal.aborted);assert(a.getReq(2).signal.aborted)});
test('Abort after headers but before blob completion cannot install stale audio',async()=>{const a=app();const body=deferred();a.getReq(1).resolve({ok:true,blob:()=>body.promise});await flush();a.select(2);await a.ready(2);body.resolve(audioBlob({size:2048,tag:1}));await flush();assert.equal(a.created.length,1);assert.equal(a.created[0].blob.tag,2)});
test('Pause during download cancels intended autoplay',async()=>{const a=app();a.select(2);assert.equal(a.$('#playButton').getAttribute('aria-label'),'暂停');a.$('#playButton').click();await a.ready(2);assert.equal(a.audio.playCalls.length,0);assert.equal(a.$('#playButton').getAttribute('aria-label'),'播放');assert.equal(a.audio.paused,true)});
test('Playback begins without awaiting lyrics',async()=>{const a=app();a.select(2);await a.ready(2);assert.equal(a.audio.playCalls.length,1);assert.equal(a.$('#lyrics').children[0].textContent,'正在加载歌词…')});
test('Stale play rejection after a track switch cannot cancel the new track',async()=>{const a=app();a.audio.deferPlay=true;a.select(2);await a.ready(2);const old=a.audio.playCalls[0];a.select(3);await a.ready(3);old.reject(Object.assign(Error('old failure'),{name:'NotAllowedError'}));await flush();assert.equal(a.$('#playButton').getAttribute('aria-label'),'暂停');assert.notEqual(a.$('#toast').textContent,'歌曲已准备好，点播放即可收听');a.audio.playCalls[1].resolve();await flush()});
test('Stale play rejection after pause does not show failure',async()=>{const a=app();a.audio.deferPlay=true;a.select(2);await a.ready(2);a.$('#playButton').click();a.audio.playCalls[0].reject(Object.assign(Error('aborted'),{name:'AbortError'}));await flush();assert.equal(a.$('#playButton').getAttribute('aria-label'),'播放');assert.equal(a.$('#toast').textContent,'')});
test('Pending lyric seek applies on metadata and timeline advances after seeked',async()=>{const a=app();await a.resolveLyrics(1);a.$('#lyrics').children[1].click();assert.equal(a.audio.seekCalls.length,0);await a.ready(1);assert.equal(a.audio.currentTime,45);a.audio.finishSeek();a.audio.tick(46);assert.equal(a.$('#currentTime').textContent,'0:46')});
test('Pending seek is discarded on track switch',async()=>{const a=app();await a.resolveLyrics(1);a.$('#lyrics').children[1].click();a.select(2);await a.ready(2);assert.equal(a.audio.currentTime,0);assert.equal(a.audio.seekCalls.length,0)});
test('Duration changes update slider scale and displayed duration',async()=>{const a=app();await a.ready(1,100);assert.equal(a.$('#progress').max,'100');a.audio.duration=360;a.audio.emit('durationchange');assert.equal(a.$('#progress').max,'360');assert.equal(a.$('#duration').textContent,'6:00');assert.equal(a.$('#progress').disabled,false)});
test('Slider seeks immediately, settles on release, and preserves paused state',async()=>{const a=app();await a.ready(1);a.$('#progress').value='120';a.$('#progress').emit('input');assert.equal(a.audio.currentTime,120);a.audio.finishSeek();a.$('#progress').emit('change');a.audio.finishSeek();a.audio.tick(121);assert.equal(a.$('#currentTime').textContent,'2:01');assert.equal(a.audio.paused,true)});
test('Stale scrub release cannot seek the next track',async()=>{const a=app();await a.ready(1);a.$('#progress').value='120';a.$('#progress').emit('input');a.select(2);await a.ready(2);a.$('#progress').emit('change');assert.equal(a.audio.currentTime,0);assert.equal(a.$('#currentTime').textContent,'0:00')});
test('Single repeat reuses the Blob and returns to zero',async()=>{const a=app({mode:'single'});await a.ready(1);a.$('#playButton').click();await flush();const count=a.requests.length;a.audio.end();await flush();assert.equal(a.audio.currentTime,0);assert.equal(a.requests.length,count);assert.equal(a.created.length,1);assert.equal(a.audio.playCalls.length,2);assert.equal(a.$('#playButton').getAttribute('aria-label'),'暂停')});
test('Sequence advances normally and stops after final track',async()=>{const a=app();a.select(30);await a.ready(30);a.audio.end();assert.equal(a.$('#trackTitle').textContent,'辞行');await a.ready(31);const count=a.requests.length;a.audio.end();assert.equal(a.requests.length,count);assert.equal(a.$('#playButton').getAttribute('aria-label'),'播放');a.$('#nextButton').click();assert.equal(a.requests.length,count);assert.equal(a.$('#toast').textContent,'已经是最后一首')});
test('Failed audio fetch exposes retry, which downloads and plays',async()=>{const a=app();await a.resolveAudio(1,{ok:false});assert.equal(a.$('#playerView').getAttribute('aria-busy'),'false');assert.equal(a.$('#trackMeta').textContent,'歌曲服务暂时不可用，点播放重试');a.$('#playButton').click();assert.equal(a.requests.filter(x=>x.url==='audio/01.mp3').length,2);await a.ready(1);assert.equal(a.audio.playCalls.length,1);assert.equal(a.$('#trackMeta').textContent,'赵雷 · 鸟巢现场')});
test('Media decode failure exposes retry and releases failed Blob',async()=>{const a=app();await a.ready(1);a.audio.fail();assert.match(a.$('#trackMeta').textContent,/播放失败/);a.$('#playButton').click();assert.equal(a.active.size,0);await a.ready(1);assert.equal(a.active.size,1);assert.equal(a.audio.playCalls.length,1)});
test('Twenty switches retain at most one object URL',async()=>{const a=app();await a.ready(1);for(let n=2;n<=21;n++){a.select(n);assert.equal(a.active.size,0);await a.ready(n);assert.equal(a.active.size,1)}assert.equal(a.created.length,21);assert.equal(a.revoked.length,20);assert.equal(new Set(a.revoked).size,20)});
test('Unavailable local storage does not prevent playback',async()=>{const a=app({storageThrows:true});await a.ready(1);a.$('#playButton').click();await flush();assert.equal(a.audio.playCalls.length,1)});
test('External media pause changes control to play and next tap resumes',async()=>{const a=app();a.select(2);await a.ready(2);a.audio.pause();assert.equal(a.$('#playButton').getAttribute('aria-label'),'播放');const before=a.audio.playCalls.length;a.$('#playButton').click();await flush();assert.equal(a.audio.playCalls.length,before+1)});
test('Both lyric panes follow seeking and reset together on track change', async () => {
 const a = app();
 await a.ready(1); await a.resolveLyrics(1);
 a.$('#progress').value = '45'; a.$('#progress').emit('input'); a.audio.finishSeek();
 assert.equal(a.$('#lyrics').querySelector('.active').textContent, 'Later 1');
 assert.equal(a.$('#miniLyrics').querySelector('.active').textContent, 'Later 1');
 a.select(2);
 assert.equal(a.$('#lyricsTitle').textContent, a.$('#trackTitle').textContent);
 assert.equal(a.$('#lyricsMeta').textContent, a.$('#trackMeta').textContent);
 assert.equal(a.$('#miniLyrics').children[0].textContent, '正在加载歌词…');
 assert.equal(a.$('#lyrics').children[0].textContent, '正在加载歌词…');
 await a.ready(2); await a.resolveLyrics(2); a.audio.tick(45);
 assert.equal(a.$('#miniLyrics').querySelector('.active').textContent, 'Later 2');
 assert.equal(a.$('#lyrics').querySelector('.active').textContent, 'Later 2');
 assert.equal(a.$('#lyricsMeta').textContent, a.$('#trackMeta').textContent);
});
const lizhiFixtures=[32,33].map(n=>({id:`test-lizhi-${n}`,number:String(n),title:`测试李志${n}`,artistId:'lizhi',artist:'李志',album:'测试现场',audioUrl:`audio/${n}.mp3`,lyricsUrl:`lyrics/${n}.lrc`}));
test('Browsing artist tabs preserves current playback and shows an honest empty category',async()=>{
 const a=app();await a.ready(1);a.$('#playButton').click();await flush();a.audio.tick(42);
 const src=a.audio.src,count=a.requests.length;assert.equal(a.$('#trackList').children.length,31);
 a.$('#tab-lizhi').click();assert.equal(a.$('#trackList').children.length,0);assert.equal(a.$('#libraryEmpty').classList.contains('hidden'),false);assert.equal(a.$('#libraryEmpty').textContent,'李志的歌曲待添加');
 a.$('#tab-all').click();assert.equal(a.$('#trackList').children.length,31);assert.equal(a.$('#tab-all').getAttribute('aria-selected'),'true');
 a.$('#tab-zhaolei').click();assert.equal(a.$('#trackList').children.length,31);assert.equal(a.$('#tab-all').getAttribute('tabindex'),'-1');
 assert.equal(a.audio.src,src);assert.equal(a.audio.currentTime,42);assert.equal(a.audio.paused,false);assert.equal(a.requests.length,count);
});
test('An empty browsed tab cannot change the active sequence or its endpoint',async()=>{
 const a=app();a.select(30);await a.ready(30);a.$('#tab-lizhi').click();a.audio.end();await a.ready(31);
 assert.equal(a.$('#trackTitle').textContent,'辞行');assert.equal(a.$('#trackList').children.length,0);
 const count=a.requests.length;a.audio.end();assert.equal(a.requests.length,count);assert.equal(a.$('#playButton').getAttribute('aria-label'),'播放');
 a.$('#prevButton').click();assert.equal(a.$('#trackTitle').textContent,'我记得');a.$('#nextButton').click();assert.equal(a.$('#trackTitle').textContent,'辞行');
});
test('Artist selection uses catalog identity and stays within its queue until another song is selected',async()=>{
 const a=app({extraTracks:lizhiFixtures});assert.equal(a.$('#trackList').children.length,31);
 a.$('#tab-lizhi').click();assert.equal(a.$('#trackList').children.length,2);a.select(1);await a.ready(32);await a.resolveLyrics(32);
 assert.equal(a.$('#trackTitle').textContent,'测试李志32');assert.equal(a.$('#trackMeta').textContent,'李志 · 测试现场');assert.equal(a.$('#lyrics').children[0].textContent,'Track 32');
 a.$('#tab-all').click();assert.equal(a.$('#trackList').children.length,33);a.audio.end();await a.ready(33);
 const count=a.requests.length;a.audio.end();assert.equal(a.requests.length,count);a.$('#prevButton').click();await a.ready(32);
 a.$('#prevButton').click();assert.equal(a.$('#trackTitle').textContent,'测试李志32');
 a.select(31);await a.ready(31);a.$('#nextButton').click();assert.equal(a.$('#trackTitle').textContent,'测试李志32');
});
test('Shuffle uses the selected artist queue and browsing retains history while a new selection clears it',async()=>{
 const a=app({mode:'shuffle',extraTracks:lizhiFixtures});a.$('#tab-lizhi').click();a.select(1);await a.ready(32);
 a.$('#nextButton').click();await a.ready(33);assert.equal(a.$('#trackTitle').textContent,'测试李志33');
 a.$('#tab-all').click();a.$('#prevButton').click();await a.ready(32);assert.equal(a.$('#trackTitle').textContent,'测试李志32');
 a.$('#nextButton').click();await a.ready(33);assert.equal(a.$('#trackTitle').textContent,'测试李志33');
 a.select(1);await a.ready(1);const count=a.requests.length;a.$('#prevButton').click();assert.equal(a.requests.length,count);assert.equal(a.$('#trackTitle').textContent,'阿卜杜拉');
});
test('A one-song artist shuffle replays that song without loading another artist',async()=>{
 const a=app({mode:'shuffle',extraTracks:lizhiFixtures.slice(0,1)});a.$('#tab-lizhi').click();a.select(1);await a.ready(32);
 const count=a.requests.length;a.audio.end();await flush();assert.equal(a.requests.length,count);assert.equal(a.audio.currentTime,0);assert.equal(a.$('#trackTitle').textContent,'测试李志32');
});
test('Visible queue reflects its source, and tab browsing cannot change it or interrupt playback',async()=>{
 const a=app({extraTracks:lizhiFixtures});await a.ready(1);a.$('#playButton').click();await flush();a.audio.tick(42);
 const src=a.audio.src,count=a.requests.length;a.$('#tab-lizhi').click();a.$('#queueButton').click();
 assert.equal(a.$('#playbackQueueDialog').open,true);assert.equal(a.$('#queueButton').getAttribute('aria-expanded'),'true');assert.equal(a.$('#queueSummary').textContent,'赵雷 · 31 首');
 assert.equal(a.$('#playbackQueueList').children.length,31);assert.equal(a.$('#playbackQueueList').querySelector('.active').querySelector('.track-name').textContent,'阿卜杜拉');
 a.$('#closeQueueButton').click();assert.equal(a.$('#queueButton').getAttribute('aria-expanded'),'false');a.$('#tab-all').click();a.$('#queueButton').click();
 assert.equal(a.$('#queueSummary').textContent,'赵雷 · 31 首');assert.equal(a.audio.src,src);assert.equal(a.audio.currentTime,42);assert.equal(a.audio.paused,false);assert.equal(a.requests.length,count);
});
test('Choosing a queue row uses the captured artist queue even after browsing all songs',async()=>{
 const a=app({extraTracks:lizhiFixtures});a.$('#tab-lizhi').click();a.select(1);await a.ready(32);a.$('#tab-all').click();a.$('#queueButton').click();
 assert.equal(a.$('#queueSummary').textContent,'李志 · 2 首');assert.equal(a.$('#playbackQueueList').children.length,2);
 a.$('#playbackQueueList').children[1].click();await a.ready(33);
 assert.equal(a.$('#queueSummary').textContent,'李志 · 2 首');assert.equal(a.$('#trackTitle').textContent,'测试李志33');assert.equal(a.$('#playbackQueueList').children[1].getAttribute('aria-current'),'true');
 const count=a.requests.length;a.audio.end();assert.equal(a.requests.length,count);assert.equal(a.audio.paused,true);
 a.$('#closeQueueButton').click();a.select(1);assert.equal(a.$('#queueSummary').textContent,'全部 · 33 首');assert.equal(a.$('#playbackQueueList').children.length,33);
});
test('Queue current marker follows automatic playback and tapping the current song preserves its time',async()=>{
 const a=app();await a.ready(1);a.$('#queueButton').click();a.$('#playbackQueueList').children[0].click();await flush();a.audio.tick(42);
 const count=a.requests.length;a.$('#playbackQueueList').children[0].click();assert.equal(a.audio.currentTime,42);assert.equal(a.requests.length,count);
 a.audio.end();await a.ready(2);assert.equal(a.$('#playbackQueueList').children[1].getAttribute('aria-current'),'true');assert.equal(a.$('#playbackQueueList').children[0].getAttribute('aria-current'),null);
 assert.equal(a.$('#playbackQueueDialog').open,true);a.$('#closeQueueButton').click();assert.equal(a.audio.paused,false);
});
test('Imported Li Zhi library contains 78 tracks and keeps its queue separate from all 109 songs',async()=>{
 const a=app({withLizhiLibrary:true});await a.ready(1);a.$('#tab-lizhi').click();
 assert.equal(a.$('#trackList').children.length,78);assert.equal(a.$('#trackList').children[0].querySelector('.track-name').textContent,'卡夫卡');
 assert.equal(a.$('#trackList').children[77].querySelector('.track-name').textContent,'死人');a.select(1);
 assert.equal(a.$('#queueSummary').textContent,'李志 · 78 首');
 const first=a.requests.find(r=>r.url===a.importedTracks[0].audioUrl);assert(first);first.resolve({ok:true,blob:async()=>audioBlob({size:1024})});await flush();a.audio.metadata(260);
 assert.equal(a.$('#trackMeta').textContent,'李志 · 被禁忌的游戏');a.$('#tab-all').click();assert.equal(a.$('#trackList').children.length,109);
 a.audio.end();assert.equal(a.$('#trackTitle').textContent,'欢愉');assert(a.requests.some(r=>r.url===a.importedTracks[1].audioUrl));assert.equal(a.$('#queueSummary').textContent,'李志 · 78 首');
 a.$('#tab-lizhi').click();a.select(78);const last=a.requests.find(r=>r.url===a.importedTracks[77].audioUrl);last.resolve({ok:true,blob:async()=>audioBlob({size:1024})});await flush();a.audio.metadata(220);
 const count=a.requests.length;a.audio.end();assert.equal(a.requests.length,count);assert.equal(a.audio.paused,true);
 a.$('#tab-all').click();a.select(31);a.$('#nextButton').click();assert.equal(a.$('#trackTitle').textContent,'卡夫卡');assert.equal(a.$('#queueSummary').textContent,'全部 · 109 首');
});
test('Songs without lyrics do not fetch a missing URL or display lyrics left over from another song',async()=>{
 const a=app({withLizhiLibrary:true});await a.resolveLyrics(1);a.$('#tab-lizhi').click();
 assert.equal(a.$('#trackList').children[0].querySelector('.track-state').textContent,'暂无歌词');const before=a.requests.length;a.select(1);
 assert.equal(a.requests.length,before+1);assert(a.requests.every(r=>typeof r.url==='string'&&r.url.length>0));
 for(const id of ['#lyrics','#miniLyrics'])assert.equal(a.$(id).children[0].textContent,'这首歌暂无歌词');
 a.$('#tab-zhaolei').click();assert.equal(a.$('#trackList').children[0].querySelector('.track-state').textContent,'有歌词');a.select(2);a.$('#tab-lizhi').click();a.select(2);await a.resolveLyrics(2);
 for(const id of ['#lyrics','#miniLyrics'])assert.equal(a.$(id).children[0].textContent,'这首歌暂无歌词');
});
test('An unavailable primary source falls back without losing a pause requested during download',async()=>{
 const a=app({withLizhiLibrary:true});a.$('#tab-lizhi').click();a.select(1);const track=a.importedTracks[0];
 a.requests.find(r=>r.url===track.audioUrl).resolve({ok:false,status:404});await flush();
 const fallback=a.requests.find(r=>r.url===track.audioFallbackUrl);assert(fallback);assert.equal(a.$('#playerView').getAttribute('aria-busy'),'true');
 a.$('#playButton').click();fallback.resolve({ok:true,blob:async()=>audioBlob({size:4096,tag:'fallback'})});await flush();a.audio.metadata(177);
 assert.equal(a.created.at(-1).blob.tag,'fallback');assert.equal(a.audio.playCalls.length,0);assert.equal(a.audio.paused,true);assert.equal(a.$('#trackMeta').textContent,'李志 · 被禁忌的游戏');
});
test('A stale primary failure cannot start a fallback after another song was selected',async()=>{
 const a=app({withLizhiLibrary:true});a.$('#tab-lizhi').click();a.select(1);const track=a.importedTracks[0],primary=a.requests.find(r=>r.url===track.audioUrl);
 a.$('#tab-zhaolei').click();a.select(2);await a.ready(2);primary.reject(Error('network'));await flush();
 assert(!a.requests.some(r=>r.url===track.audioFallbackUrl));assert.equal(a.$('#trackTitle').textContent,'开往北京的火车');assert.equal(a.created.at(-1).blob.tag,2);
});
test('Failure of both audio sources exposes retry from the primary source',async()=>{
 const a=app({withLizhiLibrary:true});a.$('#tab-lizhi').click();a.select(1);const track=a.importedTracks[0];
 a.requests.find(r=>r.url===track.audioUrl).resolve({ok:false,status:404});await flush();a.requests.find(r=>r.url===track.audioFallbackUrl).resolve({ok:false,status:404});await flush();
 assert.equal(a.$('#trackMeta').textContent,'歌曲服务暂时不可用，点播放重试');a.$('#playButton').click();assert.equal(a.requests.filter(r=>r.url===track.audioUrl).length,2);
});
test('A prepared next song starts synchronously on ended without another audio request',async()=>{
 const a=app();await a.ready(1);a.$('#playButton').click();await flush();a.audio.emit('playing');
 assert(a.getReq(2));await a.resolveAudio(2);const plays=a.audio.playCalls.length;
 assert.equal(a.created.length,1);assert.equal(a.active.size,1);
 a.audio.end();assert.equal(a.audio.playCalls.length,plays+1);assert.equal(a.$('#trackTitle').textContent,'开往北京的火车');
 assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,1);assert.equal(a.created.at(-1).blob.tag,2);assert.equal(a.active.size,1);
});
test('An unfinished prefetch is adopted without restarting and respects a subsequent pause',async()=>{
 const a=app();a.select(1);await a.ready(1);a.audio.emit('playing');const next=a.getReq(2);
 a.audio.end();assert.equal(next.signal.aborted,false);assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,1);
 a.$('#playButton').click();const plays=a.audio.playCalls.length;await a.ready(2);
 assert.equal(a.audio.playCalls.length,plays);assert.equal(a.audio.paused,true);assert.equal(a.created.at(-1).blob.tag,2);
});
test('Skipping an upcoming download cancels it and a late response cannot change the current song',async()=>{
 const a=app();a.select(1);await a.ready(1);a.audio.emit('playing');const next=a.getReq(2);
 a.select(4);assert(next.signal.aborted);await a.ready(4);await a.resolveAudio(2);
 assert.equal(a.created.at(-1).blob.tag,4);assert.equal(a.active.size,1);a.audio.emit('playing');assert(a.getReq(5));assert(!a.getReq(3));
});
test('Browsing tabs preserves the prepared song and pause cannot autoplay it',async()=>{
 const a=app();a.select(1);await a.ready(1);a.audio.emit('playing');const next=a.getReq(2);
 a.$('#tab-lizhi').click();a.$('#playButton').click();await a.resolveAudio(2);
 assert.equal(next.signal.aborted,false);assert.equal(a.$('#trackTitle').textContent,'阿卜杜拉');assert.equal(a.audio.paused,true);
 a.$('#nextButton').click();assert.equal(a.created.at(-1).blob.tag,2);assert.equal(a.$('#queueSummary').textContent,'赵雷 · 31 首');
});
test('Shuffle plays the prepared candidate and changes history only on actual navigation',async()=>{
 const extra=[32,33,34].map(n=>({...lizhiFixtures[0],id:`shuffle-${n}`,number:String(n),title:`随机${n}`,audioUrl:`audio/${n}.mp3`}));
 const a=app({mode:'shuffle',extraTracks:extra});a.$('#tab-lizhi').click();a.select(1);await a.ready(32);a.audio.emit('playing');
 const candidate=Number(a.requests.at(-1).url.match(/(\d+)\.mp3/)[1]);assert([33,34].includes(candidate));await a.resolveAudio(candidate);
 a.$('#tab-all').click();a.$('#nextButton').click();assert.equal(a.created.at(-1).blob.tag,candidate);assert.equal(a.$('#queueSummary').textContent,'李志 · 3 首');
 a.$('#prevButton').click();assert.equal(a.$('#trackTitle').textContent,'随机32');
});
test('Single-repeat cancels prefetch and the last sequential song does not prefetch or wrap',async()=>{
 const a=app();a.select(1);await a.ready(1);a.audio.emit('playing');const next=a.getReq(2);a.$('#modeButton').click();assert(next.signal.aborted);
 const count=a.requests.length;a.audio.end();a.audio.emit('playing');assert.equal(a.requests.length,count);assert.equal(a.$('#trackTitle').textContent,'阿卜杜拉');
 const b=app();b.select(31);await b.ready(31);const lastCount=b.requests.length;b.audio.emit('playing');b.audio.end();assert.equal(b.requests.length,lastCount);assert.equal(b.audio.paused,true);
});
test('A prefetch failure stays silent and the current load can retry it',async()=>{
 const a=app();a.select(1);await a.ready(1);a.audio.emit('playing');a.getReq(2).resolve({ok:false,status:404});await flush();
 assert.equal(a.audio.paused,false);assert.equal(a.$('#trackMeta').textContent,'赵雷 · 鸟巢现场');a.audio.end();await flush();
 assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,2);await a.ready(2);assert.equal(a.audio.paused,false);
});
test('An adopted prefetch that exhausts two network attempts fails without starting a new retry cycle',async()=>{
 const a=app();a.select(1);await a.ready(1);a.audio.emit('playing');
 a.getReq(2).reject(new TypeError('Failed to fetch'));await flush();a.audio.end();
 const plays=a.audio.playCalls.length;await a.advanceTimers(1000);
 assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,2);
 a.getReq(2).reject(new TypeError('Failed to fetch'));await flush();await a.advanceTimers(120000);
 assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,2);assert.equal(a.$('#trackTitle').textContent,'开往北京的火车');
 assert.equal(a.$('#playerView').getAttribute('aria-busy'),'false');assert.match(a.$('#trackMeta').textContent,/点播放重试/);
 assert.equal(a.audio.playCalls.length,plays);assert.equal(a.audio.paused,true);assert.match(JSON.stringify(a.warnings),/network/);
});
test('An adopted prefetch receiving a permanent 404 fails after its sole request',async()=>{
 const a=app();a.select(1);await a.ready(1);a.audio.emit('playing');const upcoming=a.getReq(2);
 a.audio.end();assert.equal(upcoming.signal.aborted,false);upcoming.resolve({ok:false,status:404});await flush();await a.advanceTimers(120000);
 assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,1);assert.equal(a.$('#playerView').getAttribute('aria-busy'),'false');
 assert.equal(a.$('#trackMeta').textContent,'歌曲服务暂时不可用，点播放重试');assert.equal(a.audio.paused,true);assert.equal(a.audio.playCalls.length,1);
});
test('Resuming after a failed prefetch prepares the next song again and joins synchronously',async()=>{
 const a=app();a.select(1);await a.ready(1);a.audio.emit('playing');a.getReq(2).resolve({ok:false,status:404});await flush();
 assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,1);
 a.$('#playButton').click();a.$('#playButton').click();await flush();a.audio.emit('playing');
 assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,2);await a.resolveAudio(2);
 const plays=a.audio.playCalls.length;a.audio.end();assert.equal(a.audio.playCalls.length,plays+1);assert.equal(a.created.at(-1).blob.tag,2);
});
test('Network recovery retries a failed prefetch once while playing, but never while paused',async()=>{
 const a=app();a.select(1);await a.ready(1);a.audio.emit('playing');a.getReq(2).resolve({ok:false,status:404});await flush();
 a.$('#playButton').click();a.windowEvents.emit('online');assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,1);
 a.$('#playButton').click();await flush();a.windowEvents.emit('online');a.windowEvents.emit('online');a.audio.emit('playing');
 assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,2);
 a.getReq(2).resolve({ok:false,status:404});await flush();assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,2);
 assert.equal(a.audio.paused,false);assert.equal(a.$('#trackMeta').textContent,'赵雷 · 鸟巢现场');
 a.windowEvents.emit('online');assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,3);
});
test('A cancelled prefetch rejection cannot clear a newer prepared candidate',async()=>{
 const a=app();a.select(1);await a.ready(1);a.audio.emit('playing');const old=a.getReq(2);
 a.$('#modeButton').click();a.$('#modeButton').click();const candidate=a.requests.at(-1);assert.notEqual(candidate,old);
 old.reject(Error('late failure'));await flush();a.audio.emit('playing');assert.equal(a.requests.at(-1),candidate);
 candidate.resolve({ok:true,blob:async()=>audioBlob({size:16,tag:'new candidate'})});await flush();
 const plays=a.audio.playCalls.length;a.audio.end();assert.equal(a.audio.playCalls.length,plays+1);assert.equal(a.created.at(-1).blob.tag,'new candidate');
});
test('A multi-chunk stream completes with correct bytes and releases its reader',async()=>{
 const a=app();let n=0,released=false;
 a.getReq(1).resolve({ok:true,headers:{get:key=>key.toLowerCase()==='content-length'?'256':'audio/mpeg'},body:{getReader:()=>({read:async()=>n++<64?{done:false,value:new Uint8Array([1,2,3,4])}:{done:true},releaseLock:()=>{released=true}})}});
 for(let i=0;i<32;i++)await flush();assert(released);const blob=a.created.at(-1).blob;assert.equal(blob.size,256);
 assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())],Array.from({length:256},(_,i)=>i%4+1));
});
test('Header and body stalls time out and move to the fallback source',async()=>{
 for(const phase of ['headers','body']){
  const a=app({withLizhiLibrary:true});a.$('#tab-lizhi').click();a.select(1);const track=a.importedTracks[0],primary=a.requests.find(r=>r.url===track.audioUrl);
  if(phase==='body'){primary.resolve({ok:true,blob:()=>deferred().promise});await flush()}
  a.fireTimers(phase==='headers'?30000:60000);await flush();assert(primary.signal.aborted);
  const backup=a.requests.find(r=>r.url===track.audioFallbackUrl);assert(backup,phase);backup.resolve({ok:true,blob:async()=>audioBlob({size:100,tag:phase})});await flush();assert.equal(a.created.at(-1).blob.tag,phase);
 }
});
test('Streaming download reports progress and a stalled reader falls back',async()=>{
 const a=app({withLizhiLibrary:true});a.$('#tab-lizhi').click();a.select(1);const track=a.importedTracks[0];let reads=0,released=false;
 a.requests.find(r=>r.url===track.audioUrl).resolve({ok:true,headers:{get:key=>key.toLowerCase()==='content-length'?'8':'audio/mpeg'},body:{getReader:()=>({read:()=>++reads===1?Promise.resolve({done:false,value:new Uint8Array(4)}):deferred().promise,releaseLock:()=>{released=true}})}});await flush();
 assert.match(a.$('#trackMeta').textContent,/50%/);a.fireTimers(30000);await flush();assert(released);assert(a.requests.some(r=>r.url===track.audioFallbackUrl));
});
test('A slow successful first response survives 29 seconds instead of failing at 12 seconds',async()=>{
 const a=app();a.select(2);const request=a.getReq(2);
 await a.advanceTimers(12000);assert.equal(request.signal.aborted,false);assert.equal(a.$('#playerView').getAttribute('aria-busy'),'true');
 await a.advanceTimers(17000);assert.equal(request.signal.aborted,false);await a.ready(2);
 assert.equal(a.audio.playCalls.length,1);assert.equal(a.audio.paused,false);assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,1);
});
test('Transient HTTP errors retry once after a delay and recover without another user tap',async()=>{
 for(const status of [408,425,429,500,503]){
  const a=app();a.select(2);await a.resolveAudio(2,{ok:false,status});
  assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,1);assert.equal(a.$('#playerView').getAttribute('aria-busy'),'true');
  await a.advanceTimers(999);assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,1);
  await a.advanceTimers(1);assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,2);
  await a.ready(2);assert.equal(a.audio.playCalls.length,1);assert.equal(a.$('#trackMeta').textContent,'赵雷 · 鸟巢现场');
 }
});
test('A brief network failure retries the same song and preserves pause during the retry wait',async()=>{
 for(const pause of [false,true]){
  const a=app();a.select(2);a.getReq(2).reject(new TypeError('Failed to fetch'));await flush();
  if(pause)a.$('#playButton').click();
  await a.advanceTimers(1000);assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,2);
  await a.ready(2);assert.equal(a.audio.paused,pause);assert.equal(a.audio.playCalls.length,pause?0:1);
 }
});
test('Pausing during prefetch backoff suppresses its retry until playback resumes',async()=>{
 const a=app();a.select(1);await a.ready(1);a.audio.emit('playing');
 a.getReq(2).reject(new TypeError('Failed to fetch'));await flush();a.$('#playButton').click();await a.advanceTimers(1000);
 assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,1);assert.equal(a.audio.paused,true);
 assert.equal(a.$('#trackMeta').textContent,'赵雷 · 鸟巢现场');assert.equal(a.warnings.length,0);
 a.$('#playButton').click();await flush();a.audio.emit('playing');
 assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,2);await a.resolveAudio(2);
 const plays=a.audio.playCalls.length;a.audio.end();assert.equal(a.audio.playCalls.length,plays+1);assert.equal(a.created.at(-1).blob.tag,2);
});
test('Pausing with the first prefetch source in flight prevents its fallback from starting',async()=>{
 const a=app({withLizhiLibrary:true});a.$('#tab-lizhi').click();a.select(1);
 a.requests.find(r=>r.url===a.importedTracks[0].audioUrl).resolve({ok:true,blob:async()=>audioBlob()});await flush();a.audio.metadata();a.audio.emit('playing');
 const track=a.importedTracks[1],primary=a.requests.find(r=>r.url===track.audioUrl);assert(primary);
 a.$('#playButton').click();primary.reject(new TypeError('Failed to fetch'));await flush();await a.advanceTimers(1000);
 assert.equal(a.requests.filter(r=>r.url===track.audioUrl).length,1);assert(!a.requests.some(r=>r.url===track.audioFallbackUrl));
 assert.equal(a.audio.paused,true);assert.equal(a.$('#trackTitle').textContent,'卡夫卡');assert.equal(a.warnings.length,0);
});
test('Pausing with the second-round prefetch source in flight prevents a second fallback request',async()=>{
 const a=app({withLizhiLibrary:true});a.$('#tab-lizhi').click();a.select(1);
 a.requests.find(r=>r.url===a.importedTracks[0].audioUrl).resolve({ok:true,blob:async()=>audioBlob()});await flush();a.audio.metadata();a.audio.emit('playing');
 const track=a.importedTracks[1];
 a.requests.find(r=>r.url===track.audioUrl).reject(new TypeError('Failed to fetch'));await flush();
 a.requests.find(r=>r.url===track.audioFallbackUrl).reject(new TypeError('Failed to fetch'));await flush();await a.advanceTimers(1000);
 assert.equal(a.requests.filter(r=>r.url===track.audioUrl).length,2);
 a.$('#playButton').click();a.requests.filter(r=>r.url===track.audioUrl).at(-1).reject(new TypeError('Failed to fetch'));await flush();await a.advanceTimers(1000);
 assert.equal(a.requests.filter(r=>r.url===track.audioUrl).length,2);assert.equal(a.requests.filter(r=>r.url===track.audioFallbackUrl).length,1);
 assert.equal(a.audio.paused,true);assert.equal(a.$('#trackTitle').textContent,'卡夫卡');assert.equal(a.warnings.length,0);
});
test('Adopting a prefetch during backoff allows its retry even while the new audio is not installed',async()=>{
 for(const pause of [false,true]){
  const a=app();a.select(1);await a.ready(1);a.audio.emit('playing');
  a.getReq(2).reject(new TypeError('Failed to fetch'));await flush();a.audio.end();
  assert.equal(a.$('#trackTitle').textContent,'开往北京的火车');assert.equal(a.audio.paused,true);assert.equal(a.$('#playerView').getAttribute('aria-busy'),'true');
  if(pause)a.$('#playButton').click();
  const plays=a.audio.playCalls.length;await a.advanceTimers(1000);
  assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,2);await a.ready(2);
  assert.equal(a.created.at(-1).blob.tag,2);assert.equal(a.audio.paused,pause);assert.equal(a.audio.playCalls.length,plays+(pause?0:1));
 }
});
test('Changing songs during retry backoff cancels the old retry and cannot change the new song',async()=>{
 const a=app();a.select(2);a.getReq(2).reject(new TypeError('Failed to fetch'));await flush();
 a.select(3);await a.ready(3);await a.advanceTimers(1000);
 assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,1);assert.equal(a.$('#trackTitle').textContent,'凌晨计程车');
 assert.equal(a.created.at(-1).blob.tag,3);assert.equal(a.audio.paused,false);assert.equal(a.warnings.length,0);
});
test('Each recoverable source is tried at most twice, in primary then fallback order',async()=>{
 const a=app({withLizhiLibrary:true});a.$('#tab-lizhi').click();a.select(1);const track=a.importedTracks[0];
 const urls=[track.audioUrl,track.audioFallbackUrl],attempts=()=>a.requests.filter(r=>urls.includes(r.url));
 for(let round=0;round<2;round++){
  for(const url of urls){const request=attempts().at(-1);assert.equal(request.url,url);request.resolve({ok:false,status:503});await flush()}
  if(round===0)await a.advanceTimers(1000);
 }
 assert.deepEqual(attempts().map(r=>r.url),[...urls,...urls]);assert.equal(a.$('#playerView').getAttribute('aria-busy'),'false');
 assert.equal(a.$('#trackMeta').textContent,'歌曲服务暂时不可用，点播放重试');await a.advanceTimers(120000);assert.equal(attempts().length,4);
 assert(a.warnings.length>0);assert.match(JSON.stringify(a.warnings),/http/);assert.match(JSON.stringify(a.warnings),/503/);
});
test('A permanent primary failure is not retried when only the fallback has a transient error',async()=>{
 const a=app({withLizhiLibrary:true});a.$('#tab-lizhi').click();a.select(1);const track=a.importedTracks[0];
 a.requests.find(r=>r.url===track.audioUrl).resolve({ok:false,status:404});await flush();
 a.requests.find(r=>r.url===track.audioFallbackUrl).resolve({ok:false,status:503});await flush();await a.advanceTimers(1000);
 assert.equal(a.requests.filter(r=>r.url===track.audioUrl).length,1);assert.equal(a.requests.filter(r=>r.url===track.audioFallbackUrl).length,2);
 a.requests.filter(r=>r.url===track.audioFallbackUrl).at(-1).resolve({ok:true,blob:async()=>audioBlob({tag:'recovered fallback'})});await flush();
 assert.equal(a.created.at(-1).blob.tag,'recovered fallback');assert.equal(a.audio.paused,false);
});
async function exhaustNetworkAttempts(a,number){
 a.getReq(number).reject(new TypeError('Failed to fetch'));await flush();await a.advanceTimers(1000);
 a.getReq(number).reject(new TypeError('Failed to fetch'));await flush();
}
test('Online recovery resumes a failed requested song once and preserves the captured queue',async()=>{
 const a=app();a.select(2);await exhaustNetworkAttempts(a,2);assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,2);
 a.$('#tab-lizhi').click();a.windowEvents.emit('online');a.windowEvents.emit('online');await flush();
 assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,3);await a.ready(2);
 assert.equal(a.audio.paused,false);assert.equal(a.$('#queueSummary').textContent,'赵雷 · 31 首');assert.equal(a.$('#trackTitle').textContent,'开往北京的火车');
 a.windowEvents.emit('online');await flush();assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,3);
});
test('Repeated online events cannot create an unbounded recovery loop after recovery also fails',async()=>{
 const a=app();a.select(2);await exhaustNetworkAttempts(a,2);
 a.windowEvents.emit('online');await flush();await exhaustNetworkAttempts(a,2);
 assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,4);
 for(let i=0;i<5;i++){a.windowEvents.emit('online');await flush();await a.advanceTimers(1000)}
 assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,4);assert.equal(a.audio.playCalls.length,0);
});
test('Pausing before or after failure prevents online recovery, and initial loading never autoplays on online',async()=>{
 for(const when of ['before','after','initial']){
  const a=app({withMediaSession:true});if(when!=='initial')a.select(2);
  const number=when==='initial'?1:2;
  if(when==='before')a.$('#playButton').click();
  await exhaustNetworkAttempts(a,number);
  if(when==='after')a.mediaSession.actions.pause();
  const count=a.requests.length;a.windowEvents.emit('online');await flush();await a.advanceTimers(1000);
  assert.equal(a.requests.length,count,when);assert.equal(a.audio.playCalls.length,0,when);
 }
});
test('Choosing a different song removes the failed song from online recovery',async()=>{
 const a=app();a.select(2);await exhaustNetworkAttempts(a,2);a.select(3);await a.ready(3);
 a.windowEvents.emit('online');await flush();assert.equal(a.requests.filter(r=>r.url==='audio/02.mp3').length,2);
 assert.equal(a.$('#trackTitle').textContent,'凌晨计程车');assert.equal(a.audio.paused,false);
});
test('HTML and JSON success responses are rejected before decode and the real fallback audio is used',async()=>{
 for(const type of ['text/html; charset=utf-8','application/json']){
  const a=app({withLizhiLibrary:true});a.$('#tab-lizhi').click();a.select(1);const track=a.importedTracks[0];let bodyRead=false;
  a.requests.find(r=>r.url===track.audioUrl).resolve({ok:true,status:200,headers:{get:key=>key.toLowerCase()==='content-type'?type:null},blob:async()=>{bodyRead=true;return new Blob(['temporary error'],{type})}});
  await flush();assert.equal(a.created.length,0);assert.equal(bodyRead,false);
  const fallback=a.requests.find(r=>r.url===track.audioFallbackUrl);assert(fallback,type);
  fallback.resolve({ok:true,status:200,blob:async()=>audioBlob({tag:'actual mp3'})});await flush();
  assert.equal(a.created.at(-1).blob.tag,'actual mp3');assert.equal(a.audio.playCalls.length,1);
 }
});
test('Octet-stream MP3 becomes audio/mpeg without changing any bytes in either body path',async()=>{
 const bytes=new Uint8Array([0x49,0x44,0x33,4,0,0,0,0,0,1,0xff,0xfb,0x90,0x64]);
 for(const streaming of [false,true]){
  const a=app();a.select(2);let reads=0,released=false;
  const response={ok:true,status:200,headers:{get:key=>key.toLowerCase()==='content-type'?'application/octet-stream':String(bytes.length)}};
  if(streaming)response.body={getReader:()=>({read:async()=>++reads===1?{done:false,value:bytes}:{done:true},releaseLock:()=>{released=true}})};
  else response.blob=async()=>new Blob([bytes],{type:'application/octet-stream'});
  a.getReq(2).resolve(response);for(let i=0;i<3;i++)await flush();
  const blob=a.created.at(-1).blob;assert.equal(blob.type,'audio/mpeg');assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),bytes);
  if(streaming)assert(released);assert.equal(a.audio.playCalls.length,1);
 }
});
test('Media-session controls keep the selected queue, metadata and pause intent',async()=>{
 const a=app({withMediaSession:true,extraTracks:lizhiFixtures});await a.ready(1);assert.equal(a.mediaSession.metadata.artist,'赵雷');
 a.mediaSession.actions.play();await flush();a.audio.emit('playing');await a.resolveAudio(2);a.$('#tab-lizhi').click();a.mediaSession.actions.nexttrack();
 assert.equal(a.created.at(-1).blob.tag,2);a.audio.metadata(300);a.mediaSession.actions.pause();a.mediaSession.actions.seekto({seekTime:40});assert.equal(a.audio.paused,true);assert.equal(a.audio.currentTime,40);
 a.select(1);await a.ready(32);assert.equal(a.mediaSession.metadata.artist,'李志');assert.equal(a.mediaSession.metadata.artwork[0].src,'https://player.test/cover-lizhi.jpg');
 a.audio.tick(30);assert.equal(a.mediaSession.positions.at(-1).position,30);assert.equal(a.mediaSession.playbackState,'playing');
});
test('Short lyric taps still seek; long press selects without seeking or playing',async()=>{
 const a=app();await a.ready(1);await a.resolveLyrics(1);
 const line=a.$('#lyrics').children[1];line.emit('pointerdown',{clientX:0,clientY:0,button:0});line.emit('pointerup');line.click();assert.equal(a.audio.currentTime,45);
 a.$('#playButton').click();a.audio.tick(50);const plays=a.audio.playCalls.length;
 line.emit('pointerdown',{clientX:0,clientY:0,button:0});a.fireTimers(550);line.emit('pointerup');line.click();
 assert.equal(a.$('#lyricShareDialog').open,true);assert.equal(a.$('#shareCount').textContent,'已选 1 句');assert.equal(a.audio.currentTime,50);assert.equal(a.audio.paused,true);assert.equal(a.audio.playCalls.length,plays);
});
test('Dragging, scrolling, pointer cancellation and switching songs cancel a pending long press',async()=>{
 for(const reason of ['drag','scroll','cancel','switch','outside-release','mouse-leave']){
  const a=app();await a.ready(1);await a.resolveLyrics(1);const line=a.$('#lyrics').children[0];line.emit('pointerdown',{clientX:0,clientY:0,button:0});
  if(reason==='drag')line.emit('pointermove',{clientX:30,clientY:0});
  if(reason==='scroll')a.$('#lyrics').emit('scroll');
  if(reason==='cancel')line.emit('pointercancel');
  if(reason==='switch')a.select(2);
  if(reason==='outside-release')a.windowEvents.emit('pointerup');
  if(reason==='mouse-leave')line.emit('pointerleave',{pointerType:'mouse'});
  a.fireTimers(550);assert.notEqual(a.$('#lyricShareDialog').open,true,reason);
 }
});
test('Lyric selection is a snapshot and image order follows the song, not checkbox order',async()=>{
 const a=app();await a.ready(1);await a.resolveLyrics(1,'[00:00]（前奏）\n[00:01]First\n[00:02]Second\n[00:03]Third');a.$('#lyricShareButton').click();
 const boxes=a.$('#shareSelection').querySelectorAll('input');assert.equal(boxes.length,3);
 for(const i of [2,0]){boxes[i].checked=true;boxes[i].onchange()}
 a.select(2);await a.ready(2);await a.resolveLyrics(2);assert.equal(a.$('#shareSubtitle').textContent,'阿卜杜拉 · 赵雷');
 await a.$('#generateShareButton').onclick();assert(a.cards[0].text.indexOf('First')<a.cards[0].text.indexOf('Third'));assert(!a.cards[0].text.includes('Second'));assert(a.cards[0].text.includes('阿卜杜拉'));
 assert.match(a.$('#saveShareImage').download,/阿卜杜拉/);assert.equal(a.audio.paused,false);assert.equal(a.cards[0].width,1080);
});
test('Empty selection disables generation; regenerating and closing release preview URLs',async()=>{
 const a=app();await a.resolveLyrics(1);a.$('#lyricShareButton').click();const first=a.$('#shareSelection').querySelectorAll('input')[0];
 first.checked=true;first.onchange();first.checked=false;first.onchange();assert.equal(a.$('#generateShareButton').disabled,true);
 first.checked=true;first.onchange();await a.$('#generateShareButton').onclick();assert.equal(a.active.size,1);assert.equal(a.$('#nativeShareButton').classList.contains('hidden'),true);
 a.$('#editShareButton').click();assert.equal(a.active.size,0);assert.equal(a.$('#shareCount').textContent,'已选 1 句');await a.$('#generateShareButton').onclick();assert.equal(a.active.size,1);
 a.$('#closeShareButton').click();assert.equal(a.active.size,0);
});
test('Closing a pending render cannot replace a newer share or leak its preview URL',async()=>{
 const a=app({deferCover:true});await a.resolveLyrics(1);a.$('#lyricShareButton').click();let input=a.$('#shareSelection').querySelectorAll('input')[0];input.checked=true;input.onchange();const old=a.$('#generateShareButton').onclick();
 a.$('#closeShareButton').click();a.select(2);await a.resolveLyrics(2);a.$('#lyricShareButton').click();input=a.$('#shareSelection').querySelectorAll('input')[0];input.checked=true;input.onchange();const fresh=a.$('#generateShareButton').onclick();
 a.coverImages[1].onload();await fresh;const url=a.$('#shareImage').src;a.coverImages[0].onload();await old;
 assert.equal(a.$('#shareImage').src,url);assert.equal(a.active.size,1);assert.match(a.$('#saveShareImage').download,/开往北京的火车/);
});
test('System share uses the prepared file; cancellation is silent and errors retain save fallback',async()=>{
 const a=app({withShare:true});await a.resolveLyrics(1);a.$('#lyricShareButton').click();const box=a.$('#shareSelection').querySelectorAll('input')[0];box.checked=true;box.onchange();await a.$('#generateShareButton').onclick();
 assert.equal(a.$('#nativeShareButton').classList.contains('hidden'),false);let result=a.$('#nativeShareButton').onclick();assert.equal(a.shares.length,1);const file=a.shares[0].data.files[0];assert.equal(file.type,'image/jpeg');assert.match(file.name,/^lyrics-[0-9]+-[0-9]+\.jpg$/);assert.equal(file.size,a.created.at(-1).blob.size);assert.deepEqual(Object.keys(a.shares[0].data),['files','url']);assert.equal(a.shares[0].data.url,'https://player.test/');assert.equal(a.shares[0].data.files.length,1);assert.match(a.$('#saveShareImage').download,/歌词分享\.jpg$/);
 a.shares[0].reject(Object.assign(Error('cancel'),{name:'AbortError'}));await result;assert.equal(a.$('#shareStatus').textContent,'');
 result=a.$('#nativeShareButton').onclick();a.shares[1].reject(Error('unavailable'));await result;assert.match(a.$('#shareStatus').textContent,/保存图片/);assert(a.$('#saveShareImage').href);assert.equal(a.$('#nativeShareButton').disabled,false);
});
test('No lyrics disables sharing and queue artist shortcut preserves playback and queue',async()=>{
 const a=app({withLizhiLibrary:true});await a.ready(1);await a.resolveLyrics(1);a.$('#playButton').click();await flush();a.audio.tick(40);
 a.$('#queueButton').click();a.$('#queueLibraryButton').click();assert.equal(a.$('#playbackQueueDialog').open,false);assert.equal(a.$('#sidebar').classList.contains('open'),true);assert.equal(a.$('#libraryButton').getAttribute('aria-expanded'),'true');
 a.$('#tab-lizhi').click();assert.equal(a.$('#queueSummary').textContent,'赵雷 · 31 首');assert.equal(a.audio.currentTime,40);assert.equal(a.audio.paused,false);
 a.select(1);assert.equal(a.$('#lyricShareButton').disabled,true);assert.equal(a.$('#coverShareButton').disabled,true);assert.equal(a.$('#queueSummary').textContent,'李志 · 78 首');
});
test('Both share buttons work without a long press and preserve playback time and pause state',async()=>{
 for(const playing of [false,true]){
  const a=app();assert.equal(a.$('#coverShareButton').disabled,true);assert.equal(a.$('#lyricShareButton').disabled,true);
  await a.ready(1);await a.resolveLyrics(1);if(playing){a.$('#playButton').click();await flush()}a.audio.tick(42);
  const calls=a.audio.playCalls.length;
  for(const id of ['#coverShareButton','#lyricShareButton']){
   assert.equal(a.$(id).disabled,false);a.$(id).click();assert.equal(a.$('#lyricShareDialog').open,true);assert.equal(a.$('#shareSelection').children.length,2);
   a.$('#closeShareButton').click();assert.equal(a.audio.currentTime,42);assert.equal(a.audio.paused,!playing);assert.equal(a.audio.playCalls.length,calls);
  }
 }
});
test('Invalid or empty JPEG output cannot be mislabeled and passed to system share',async()=>{
 for(const options of [{canvasMime:'image/png'},{emptyCanvas:true}]){
  const a=app({withShare:true,...options});await a.resolveLyrics(1);a.$('#lyricShareButton').click();const box=a.$('#shareSelection').querySelectorAll('input')[0];box.checked=true;box.onchange();await a.$('#generateShareButton').onclick();
  assert.match(a.$('#shareStatus').textContent,/JPG 图片生成失败/);assert.equal(a.active.size,0);assert.equal(a.$('#generateShareButton').disabled,false);await a.$('#nativeShareButton').onclick();assert.equal(a.shares.length,0);
 }
});
test('Reopening a poster while system share is pending cannot dispatch concurrent shares',async()=>{
 const a=app({withShare:true});await a.ready(1);await a.resolveLyrics(1);a.audio.tick(42);
 const prepare=async()=>{a.$('#lyricShareButton').click();const box=a.$('#shareSelection').querySelectorAll('input')[0];box.checked=true;box.onchange();await a.$('#generateShareButton').onclick()};
 await prepare();const old=a.$('#nativeShareButton').onclick();a.$('#closeShareButton').click();await prepare();assert.equal(a.$('#nativeShareButton').disabled,true);await a.$('#nativeShareButton').onclick();assert.equal(a.shares.length,1);
 a.shares[0].reject(Object.assign(Error('cancel'),{name:'AbortError'}));await old;assert.equal(a.$('#nativeShareButton').disabled,false);const fresh=a.$('#nativeShareButton').onclick();assert.equal(a.shares.length,2);assert.notEqual(a.shares[0].data.files[0].name,a.shares[1].data.files[0].name);a.shares[1].resolve();await fresh;assert.equal(a.audio.currentTime,42);assert.equal(a.audio.paused,true);
});
test('Status video is prepared before a separate share tap and preserves playback',async()=>{
 const a=app({withShare:true,withVideo:true});await a.ready();await a.resolveLyrics(1);a.audio.tick(42);a.$('#coverShareButton').click();const box=a.$('#shareSelection').querySelectorAll('input')[0];box.checked=true;box.onchange();await a.$('#generateShareButton').onclick();
 assert.equal(a.$('#statusVideoButton').classList.contains('hidden'),false);const prepare=a.$('#statusVideoButton').onclick();assert.equal(a.videos.length,1);assert.equal(a.shares.length,0);assert.equal(a.$('#statusVideoButton').disabled,true);
 await a.$('#statusVideoButton').onclick();assert.equal(a.videos.length,1);a.videos[0].resolve(new Blob(['real-test-video'],{type:'video/mp4'}));await prepare;
 assert.match(a.$('#saveStatusVideo').download,/状态\.mp4$/);assert.equal(a.$('#statusVideoButton').textContent,'分享视频');assert.equal(a.active.size,3);
 const sharing=a.$('#statusVideoButton').onclick();assert.equal(a.shares.length,1);assert.equal(a.shares[0].data.files[0].type,'video/mp4');assert.match(a.shares[0].data.files[0].name,/^lyrics-status-.*\.mp4$/);assert.deepEqual(Object.keys(a.shares[0].data),['files']);assert.equal(a.$('#nativeShareButton').disabled,true);
 await a.$('#nativeShareButton').onclick();assert.equal(a.shares.length,1);a.shares[0].resolve();await sharing;assert.equal(a.audio.currentTime,42);assert.equal(a.audio.paused,true);
 a.$('#closeShareButton').click();assert.equal(a.active.size,1);
});
test('Closing or reselecting aborts video generation and rejects stale completion',async()=>{
 for(const close of [true,false]){
  const a=app({withVideo:true});await a.resolveLyrics(1);a.$('#lyricShareButton').click();const box=a.$('#shareSelection').querySelectorAll('input')[0];box.checked=true;box.onchange();await a.$('#generateShareButton').onclick();const pending=a.$('#statusVideoButton').onclick();
  a.$(close?'#closeShareButton':'#editShareButton').click();assert.equal(a.videos[0].signal.aborted,true);a.videos[0].resolve(new Blob(['stale'],{type:'video/mp4'}));await pending;assert.equal(a.active.size,0);assert.equal(a.$('#saveStatusVideo').classList.contains('hidden'),true);
 }
});
test('Video failure retains the JPEG and permits a fresh attempt',async()=>{
 const a=app({withVideo:true});await a.resolveLyrics(1);a.$('#lyricShareButton').click();const box=a.$('#shareSelection').querySelectorAll('input')[0];box.checked=true;box.onchange();await a.$('#generateShareButton').onclick();const image=a.$('#saveShareImage').href;
 const first=a.$('#statusVideoButton').onclick();a.videos[0].reject(Error('编码失败'));await first;assert.equal(a.$('#shareStatus').textContent,'编码失败');assert.equal(a.$('#saveShareImage').href,image);assert.equal(a.$('#statusVideoButton').disabled,false);
 const second=a.$('#statusVideoButton').onclick();assert.equal(a.videos.length,2);a.$('#closeShareButton').click();a.videos[1].reject(Error('abort'));await second;assert.equal(a.active.size,0);
});
(async()=>{let failed=0;for(const {name,fn}of tests){try{await fn();console.log(`PASS ${name}`)}catch(error){failed++;console.log(`FAIL ${name}\n  ${error.stack}`)}}console.log(`\n${tests.length-failed}/${tests.length} passed`);process.exitCode=failed?1:0})().catch(error=>{console.error(error);process.exitCode=1});
