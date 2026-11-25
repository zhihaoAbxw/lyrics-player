/* Local-only, silent AVC video alternative for image sharing. */
(()=>{
  'use strict';
  const TYPES=['video/mp4;codecs=avc1.420028','video/mp4;codecs=avc1.42E028','video/mp4;codecs=avc1.4D0028','video/mp4;codecs=avc1'];
  const LENGTH=4000,FPS=15,DEADLINE=15000;
  const unsupported=()=>new Error('当前浏览器不支持生成 MP4 状态视频，请使用保存图片或长按图片分享。');
  function supportedType(){
    if(typeof MediaRecorder!=='function'||typeof MediaRecorder.isTypeSupported!=='function'||typeof document==='undefined')return '';
    try{
      if(typeof document.createElement('canvas').captureStream!=='function')return '';
      return TYPES.find(type=>MediaRecorder.isTypeSupported(type))||'';
    }catch{return '';}
  }
  const aborted=()=>new DOMException('已取消状态视频生成','AbortError');
  const mp4Type=type=>/^video\/mp4(?:\s*;|$)/i.test(type||'');

  // MediaRecorder can leave fragmented-MP4 duration fields at zero/unknown.
  // Fill only those fields; never relabel another container or touch AVC samples.
  async function completeMP4(blob,durationMs){
    if(!blob.size||!mp4Type(blob.type))throw new Error('浏览器未生成有效的 MP4 视频。');
    const buffer=await blob.arrayBuffer(),view=new DataView(buffer),bytes=new Uint8Array(buffer);
    const text=(at,length)=>String.fromCharCode(...bytes.subarray(at,at+length));
    function boxes(start,end){
      const result=[];
      while(start<end){
        if(end-start<8)throw new Error('MP4 文件不完整，请重新生成。');
        let size=view.getUint32(start),header=8;
        if(size===1){
          if(end-start<16)throw new Error('MP4 文件不完整，请重新生成。');
          const high=view.getUint32(start+8),low=view.getUint32(start+12);
          size=high*4294967296+low;header=16;
        }else if(size===0)size=end-start;
        if(!Number.isSafeInteger(size)||size<header||start+size>end)throw new Error('MP4 文件不完整，请重新生成。');
        result.push({start,end:start+size,payload:start+header,type:text(start+4,4)});start+=size;
      }
      return result;
    }
    const top=boxes(0,bytes.length);
    if(top[0]?.type!=='ftyp'||!top.some(b=>b.type==='mdat'&&b.end>b.payload)||!top.some(b=>b.type==='moov'))throw new Error('浏览器没有输出可用的 MP4 文件。');
    const found=[];
    function walk(list){for(const box of list){found.push(box);if(['moov','trak','mdia','minf','stbl','mvex'].includes(box.type))walk(boxes(box.payload,box.end));}}
    walk(top);
    const movie=found.find(b=>b.type==='mvhd');
    function timing(box){
      if(!box||box.end-box.payload<20)throw new Error('MP4 缺少有效的时长信息。');
      const version=view.getUint8(box.payload);
      if(version!==0&&version!==1)throw new Error('MP4 时长信息格式不支持。');
      const scaleAt=box.payload+(version===1?20:12),durationAt=scaleAt+4,length=version===1?8:4;
      if(durationAt+length>box.end)throw new Error('MP4 文件不完整，请重新生成。');
      const scale=view.getUint32(scaleAt);
      if(!scale)throw new Error('MP4 缺少有效的时间刻度。');
      return {version,scale,durationAt};
    }
    const movieTiming=timing(movie),media=found.filter(b=>b.type==='mdhd');
    if(!media.length)throw new Error('MP4 缺少视频轨道。');
    let avc=false;
    for(const box of found.filter(b=>b.type==='stsd')){
      if(box.end-box.payload<8)throw new Error('MP4 视频编码信息不完整。');
      const entries=boxes(box.payload+8,box.end);
      if(entries.some(entry=>entry.type==='avc1'||entry.type==='avc3'))avc=true;
    }
    if(!avc)throw new Error('浏览器未使用 H.264 编码，请改用保存图片。');
    function fillDuration(at,version,scale,end){
      const length=version===1?8:4;
      if(at+length>end)throw new Error('MP4 文件不完整，请重新生成。');
      const high=version===1?view.getUint32(at):0,low=view.getUint32(at+(version===1?4:0));
      const unknown=version===1?high===0xffffffff&&low===0xffffffff:low===0xffffffff;
      if((high===0&&low===0)||unknown){
        const value=Math.max(1,Math.round(durationMs*scale/1000));
        if(version===1){view.setUint32(at,Math.floor(value/4294967296));view.setUint32(at+4,value%4294967296);}
        else{if(value>=0xffffffff)throw new Error('MP4 视频时长超出支持范围。');view.setUint32(at,value);}
      }
    }
    fillDuration(movieTiming.durationAt,movieTiming.version,movieTiming.scale,movie.end);
    for(const box of media){const data=timing(box);fillDuration(data.durationAt,data.version,data.scale,box.end);}
    for(const box of found.filter(b=>b.type==='tkhd'||b.type==='mehd')){
      const version=view.getUint8(box.payload);
      if(version!==0&&version!==1)throw new Error('MP4 时长信息格式不支持。');
      const at=box.payload+(box.type==='mehd'?4:version===1?28:20);
      fillDuration(at,version,movieTiming.scale,box.end);
    }
    return new Blob([buffer],{type:'video/mp4'});
  }

  function create(blob,{signal}={}){
    return new Promise((resolve,reject)=>{
      if(signal?.aborted){reject(aborted());return;}
      const type=supportedType();
      if(!type){reject(unsupported());return;}
      if(!blob||!blob.size||!/^image\/jpeg(?:;|$)/i.test(blob.type)){reject(new Error('请先生成有效的 JPG 歌词图片。'));return;}
      let image,url,stream,recorder,canvas,drawing,track,started=0,recorded=0,settled=false;
      const timeouts=new Set(),intervals=new Set(),chunks=[];
      const timer=(fn,ms)=>{const id=setTimeout(()=>{timeouts.delete(id);fn();},ms);timeouts.add(id);return id;};
      function cleanup(){
        for(const id of timeouts)clearTimeout(id);timeouts.clear();
        for(const id of intervals)clearInterval(id);intervals.clear();
        signal?.removeEventListener('abort',cancel);
        if(image){image.onload=null;image.onerror=null;image.src='';}
        if(recorder){recorder.ondataavailable=null;recorder.onstop=null;recorder.onerror=null;try{if(recorder.state!=='inactive')recorder.stop();}catch{}}
        if(stream)for(const item of stream.getTracks()){try{item.stop();}catch{}}
        if(url){URL.revokeObjectURL(url);url=null;}
        if(canvas){canvas.width=0;canvas.height=0;}
      }
      function finish(error,value){if(settled)return;settled=true;cleanup();error?reject(error):resolve(value);}
      function cancel(){finish(aborted());}
      signal?.addEventListener('abort',cancel,{once:true});
      timer(()=>finish(new Error('状态视频生成超时，请保持页面在前台后重试。')),DEADLINE);
      try{
        image=new Image();
        image.onerror=()=>finish(new Error('无法读取歌词图片，请重新生成图片。'));
        image.onload=()=>{
          if(settled)return;
          try{
            if(!(image.naturalWidth>0&&image.naturalHeight>0))throw new Error('歌词图片尺寸无效。');
            canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1440;
            drawing=canvas.getContext('2d',{alpha:false});
            if(!drawing)throw new Error('当前浏览器无法生成状态视频。');
            const scale=Math.min(canvas.width/image.naturalWidth,canvas.height/image.naturalHeight);
            const width=image.naturalWidth*scale,height=image.naturalHeight*scale;
            const x=(canvas.width-width)/2,y=(canvas.height-height)/2;
            function draw(){drawing.fillStyle='#f7f5ee';drawing.fillRect(0,0,canvas.width,canvas.height);drawing.drawImage(image,x,y,width,height);track?.requestFrame?.();}
            draw();stream=canvas.captureStream(FPS);track=stream.getVideoTracks()[0];
            if(!track)throw new Error('浏览器无法捕获歌词图片。');
            recorder=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:6000000});
            if(!mp4Type(recorder.mimeType||type))throw new Error('浏览器不支持 MP4 状态视频。');
            recorder.ondataavailable=event=>{
              if(!settled&&event.data?.size){
                if(event.data.type&&!mp4Type(event.data.type)){finish(new Error('浏览器未输出 MP4，已取消生成。'));return;}
                chunks.push(event.data);
              }
            };
            recorder.onerror=()=>finish(new Error('状态视频编码失败，请重试或保存图片。'));
            recorder.onstop=async()=>{
              if(settled)return;
              const elapsed=Math.max(LENGTH,recorded||performance.now()-started);
              try{const output=await completeMP4(new Blob(chunks,{type:recorder.mimeType||type}),elapsed);finish(null,output);}catch(error){finish(error);}
            };
            recorder.start();started=performance.now();draw();
            intervals.add(setInterval(()=>{if(!settled){try{draw();}catch(error){finish(error);}}},1000/FPS));
            timer(()=>{
              if(settled)return;
              try{draw();recorded=performance.now()-started;recorder.stop();}catch{finish(new Error('无法完成状态视频，请重新生成。'));}
            },LENGTH);
          }catch(error){finish(error);}
        };
        url=URL.createObjectURL(blob);image.src=url;
      }catch(error){finish(error);}
    });
  }
  globalThis.LyricVideo={isSupported:()=>!!supportedType(),create};
})();
