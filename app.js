/* ══════════ App.js - 数据层 ══════════ */

/* ── Service Worker ── */
if('serviceWorker' in navigator){navigator.serviceWorker.register('sw.js').catch(()=>{});}

/* ── IndexedDB ── */
var db=null;
function openDB(){
  return new Promise(function(resolve,reject){
    var req=indexedDB.open('minichat',2);
    req.onupgradeneeded=function(e){
      var d=e.target.result;
      if(!d.objectStoreNames.contains('kv'))d.createObjectStore('kv');
      if(!d.objectStoreNames.contains('msgs'))d.createObjectStore('msgs');
      if(!d.objectStoreNames.contains('stickers'))d.createObjectStore('stickers',{keyPath:'id'});
    };
    req.onsuccess=function(e){db=e.target.result;resolve();};
    req.onerror=function(e){reject(e.target.error);};
  });
}
function kvGet(key){
  return new Promise(function(res,rej){
    var r=db.transaction('kv').objectStore('kv').get(key);
    r.onsuccess=function(){res(r.result);};r.onerror=function(){rej(r.error);};
  });
}
function kvSet(key,val){
  return new Promise(function(res,rej){
    var r=db.transaction('kv','readwrite').objectStore('kv').put(val,key);
    r.onsuccess=function(){res();};r.onerror=function(){rej(r.error);};
  });
}
function msgsGet(convId){
  return new Promise(function(res,rej){
    var r=db.transaction('msgs').objectStore('msgs').get(convId);
    r.onsuccess=function(){res(r.result||[]);};r.onerror=function(){rej(r.error);};
  });
}
function msgsSet(convId,arr){
  return new Promise(function(res,rej){
    var r=db.transaction('msgs','readwrite').objectStore('msgs').put(arr,convId);
    r.onsuccess=function(){res();};r.onerror=function(){rej(r.error);};
  });
}
function msgsDel(convId){
  return new Promise(function(res,rej){
    var r=db.transaction('msgs','readwrite').objectStore('msgs').delete(convId);
    r.onsuccess=function(){res();};r.onerror=function(){rej(r.error);};
  });
}

/* ── 全局状态 ── */
var channels=[];
var convs=[];
var activeId=null;
var msgs=[];
var pendingAtt=[];
var streaming=false, aborter=null, stopChain=false;
var editIdx=null;
var draftMembers=null;

var $=function(id){return document.getElementById(id);};
var chatEl=$('chat'), inputEl=$('input'), sendBtn=$('btnSend');
var uid=function(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7);};

var toastTimer=null;
function toast(t){
  var el=$('toast');el.textContent=t;el.style.display='block';
  clearTimeout(toastTimer);toastTimer=setTimeout(function(){el.style.display='none';},2400);
}
function getConv(){return convs.find(function(c){return c.id===activeId;});}
function getChannel(id){return channels.find(function(c){return c.id===id;});}
function saveMeta(){return Promise.all([kvSet('channels',channels),kvSet('convs',convs),kvSet('activeId',activeId)]);}
function saveMsgs(){return msgsSet(activeId,msgs).catch(function(){toast('保存失败，存储可能已满');});}

/* ── 工具函数 ── */
function estTokens(str){
  if(!str)return 0;
  var cjk=0,other=0;
  for(var i=0;i<str.length;i++){var ch=str[i];if(/[\u4e00-\u9fff\u3040-\u30ff]/.test(ch))cjk++;else other++;}
  return Math.round(cjk+other/3.8);
}
function fmtTime(ts){
  if(!ts)return'';
  var d=new Date(ts),n=new Date();
  var hm=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  return (d.toDateString()===n.toDateString())?hm:(d.getMonth()+1)+'/'+d.getDate()+' '+hm;
}
function extractThink(m){
  if(!m.content)return;
  var match=m.content.match(/<think>([\s\S]*?)<\/think>/);
  if(match){
    m.reasoning=(m.reasoning||'')+match[1].trim();
    m.content=m.content.replace(/<think>[\s\S]*?<\/think>/,'').trim();
  }
}

/* ── 消息构建 ── */
function toApiMsg(m,selfId){
  var text=m.content||'';
  (m.files||[]).forEach(function(f){text+='\n\n【附件文件: '+f.name+'】\n'+f.text;});
  if(m.role==='assistant'){
    if(m.memberId===selfId)return{role:'assistant',content:text};
    return{role:'user',content:'['+(m.name||m.model||'其他AI')+']: '+text};
  }
  if(m.images&&m.images.length){
    var parts=[];
    if(text)parts.push({type:'text',text:text});
    m.images.forEach(function(src){parts.push({type:'image_url',image_url:{url:src}});});
    return{role:'user',content:parts};
  }
  return{role:'user',content:text};
}
function buildPayloadUpTo(i,mem){
  var c=getConv();var out=[];
  var sys=c.system?c.system.trim():'';
  if(c.members.length>1){
    var names=c.members.map(function(x){return x.name||x.model;}).join('、');
    sys+=(sys?'\n\n':'')+'你是「'+(mem.name||mem.model)+'」，正在参与一个多人对话，成员有：'+names+'。其他成员的发言会以 [名字]: 开头标注。请以自己的身份自然参与对话，不要在回复开头加自己的名字标签。';
  }
  if(sys)out.push({role:'system',content:sys});
  var hist=msgs.slice(0,i);
  var slice=c.ctx>0?hist.slice(-c.ctx):hist.slice(-1);
  slice.forEach(function(m){out.push(toApiMsg(m,mem.id));});
  return out;
}

/* ── 生成核心 ── */
async function runGeneration(i,mem){
  var c=getConv();
  var ch=getChannel(mem.channelId);
  var aiMsg=msgs[i];
  if(!ch||!ch.url||!ch.key){
    aiMsg.content='❌ 成员「'+(mem.name||mem.model)+'」的渠道配置缺失或已被删除，请到设置里重新添加该成员';
    await saveMsgs();render();return;
  }
  streaming=true;stopChainCheck();
  sendBtn.textContent='■';sendBtn.classList.add('stop');
  renderMemberBar();
  var t0=Date.now();var usage=null;
  var payload=buildPayloadUpTo(i,mem);
  var baseContent=aiMsg.content||'', baseReasoning=aiMsg.reasoning||'';
  var maxAttempts=2;
  var attempt=0, lastErr=null, aborted=false;

  while(attempt<maxAttempts){
    attempt++;
    aiMsg.content=baseContent;
    aiMsg.reasoning=baseReasoning;
    lastErr=null;
    aborter=new AbortController();
    try{
      var res=await fetch(ch.url.replace(/\/+$/,'')+'/chat/completions',{
        method:'POST',signal:aborter.signal,
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+ch.key},
        body:JSON.stringify({model:mem.model,messages:payload,temperature:c.temp,stream:true,stream_options:{include_usage:true}})
      });
      if(!res.ok){
        var errText=await res.text().catch(function(){return '';});
        throw new Error('HTTP '+res.status+' '+errText.slice(0,200));
      }
      var reader=res.body.getReader();var decoder=new TextDecoder();var buf='';
      while(true){
        var chunk=await reader.read();
        if(chunk.done)break;
        buf+=decoder.decode(chunk.value,{stream:true});
        var lines=buf.split('\n');buf=lines.pop();
        for(var li=0;li<lines.length;li++){
          var t=lines[li].trim();
          if(!t.startsWith('data:'))continue;
          var data=t.slice(5).trim();
          if(data==='[DONE]')continue;
          try{
            var j=JSON.parse(data);
            if(j.usage)usage=j.usage;
            var d=j.choices&&j.choices[0]&&j.choices[0].delta;
            if(d){
              var rc=d.reasoning_content||d.reasoning;
              if(rc)aiMsg.reasoning=(aiMsg.reasoning||'')+rc;
              if(d.content)aiMsg.content+=d.content;
              updateMsgDom(i);
            }
          }catch(e){}
        }
      }
      break;
    }catch(e){
      if(e.name==='AbortError'){
        aiMsg.content+='\n[已手动停止]';
        stopChain=true;aborted=true;
        break;
      }
      lastErr=e;
      try{
        window.__xwDebug=window.__xwDebug||[];
        window.__xwDebug.push('['+new Date().toLocaleTimeString()+'] 第'+attempt+'次 '+(Date.now()-t0)+'ms后断 | '+(e.name||'?')+': '+(e.message||e)+' | 已收正文'+(aiMsg.content||'').length+'字/思维链'+(aiMsg.reasoning||'').length+'字');
      }catch(_){}
      if(attempt<maxAttempts){
        aiMsg.content=baseContent+'⚠ 连接中断，正在自动重试…';
        updateMsgDom(i);
        await new Promise(function(r){setTimeout(r,800);});
      }
    }
  }

  if(lastErr&&!aborted){
    var partial=aiMsg.content&&aiMsg.content!==baseContent+'⚠ 连接中断，正在自动重试…'?aiMsg.content:baseContent;
    var errInfo='['+(lastErr.name||'Error')+'] '+(lastErr.message||lastErr);
    aiMsg.content=(partial&&partial.trim()?partial+'\n\n':'')
      +'❌ ['+(mem.name||mem.model)+' @ '+ch.name+'] 已重试'+(maxAttempts-1)+'次仍失败：'+errInfo
      +'\n（可点"重说"再试）';
    toast('请求失败');
  }

  extractThink(aiMsg);
  if(!aiMsg.content&&!aiMsg.reasoning)aiMsg.content='(空回复)';

  var ms=Date.now()-t0;
  if(usage){aiMsg.meta={inTok:usage.prompt_tokens||0,outTok:usage.completion_tokens||0,ms:ms,est:false};}
  else{
    var inChars=0;
    payload.forEach(function(p){
      if(typeof p.content==='string')inChars+=p.content.length;
      else(p.content||[]).forEach(function(x){if(x.type==='text')inChars+=x.text.length;});
    });
    aiMsg.meta={inTok:Math.round(inChars/2),outTok:estTokens((aiMsg.content||'')+(aiMsg.reasoning||'')),ms:ms,est:true};
  }
  if(!aiMsg.reasoning)delete aiMsg.reasoning;
  streaming=false;aborter=null;
  sendBtn.textContent='➤';sendBtn.classList.remove('stop');
  await saveMsgs();render();renderMemberBar();
}
function stopChainCheck(){stopChain=false;}
function pushAiMsg(mem){
  msgs.push({role:'assistant',content:'',reasoning:'',model:mem.model,name:mem.name||mem.model,memberId:mem.id,ts:Date.now(),meta:null});
  return msgs.length-1;
}
async function manualSpeak(mem){
  var i=pushAiMsg(mem);
  await saveMsgs();render();
  await runGeneration(i,mem);
}
async function regen(i){
  if(streaming)return;
  var m=msgs[i];var c=getConv();
  var mem=c.members.find(function(x){return x.id===m.memberId;})||c.members[0];
  if(!mem){toast('本对话没有成员，先去设置添加');return;}
  m.content='';m.reasoning='';m.meta=null;m.model=mem.model;m.name=mem.name||mem.model;m.memberId=mem.id;m.ts=Date.now();
  await saveMsgs();render();
  await runGeneration(i,mem);
}

/* ── 发送 ── */
async function send(){
  if(streaming){if(aborter)aborter.abort();return;}
  var c=getConv();
  var text=inputEl.value.trim();
  if(!text&&!pendingAtt.length)return;
  if(!c.members.length){toast('请先在设置「本对话」里添加成员');openPanel();return;}
  var userMsg={role:'user',content:text,images:[],files:[],ts:Date.now()};
  pendingAtt.forEach(function(a){
    if(a.type==='image')userMsg.images.push(a.data);
    else userMsg.files.push({name:a.name,text:a.text});
  });
  pendingAtt=[];renderAttach();
  msgs.push(userMsg);
  inputEl.value='';autoGrow();
  await saveMsgs();render();
  c.updatedAt=Date.now();await saveMeta();
  if(c.mode==='round'){
    for(var mi=0;mi<c.members.length;mi++){
      if(stopChain)break;
      var idx=pushAiMsg(c.members[mi]);
      await saveMsgs();render();
      await runGeneration(idx,c.members[mi]);
    }
    stopChain=false;
  }
}

/* ── 附件 ── */
$('btnAttach').onclick=function(){$('fileInput').click();};
$('fileInput').onchange=async function(e){
  for(var fi=0;fi<e.target.files.length;fi++){
    var file=e.target.files[fi];
    if(file.type.startsWith('image/')){
      if(file.size>4*1024*1024){toast(file.name+' 超过4MB，跳过');continue;}
      var data=await new Promise(function(r){var fr=new FileReader();fr.onload=function(){r(fr.result);};fr.readAsDataURL(file);});
      pendingAtt.push({type:'image',name:file.name,data:data});
    }else{
      if(file.size>1024*1024){toast(file.name+' 超过1MB，跳过');continue;}
      var txt=await new Promise(function(r){var fr=new FileReader();fr.onload=function(){r(fr.result);};fr.readAsText(file);});
      pendingAtt.push({type:'file',name:file.name,text:txt});
    }
  }
  e.target.value='';renderAttach();
};

/* ── 表情包 CRUD ── */
var stickers=[];
function stkLoad(){
  return new Promise(function(res){
    var tx=db.transaction('stickers');var store=tx.objectStore('stickers');var r=store.getAll();
    r.onsuccess=function(){stickers=r.result||[];res();};
    r.onerror=function(){stickers=[];res();};
  });
}
function stkSave(item){
  return new Promise(function(res,rej){
    var r=db.transaction('stickers','readwrite').objectStore('stickers').put(item);
    r.onsuccess=function(){res();};r.onerror=function(){rej(r.error);};
  });
}
function stkDel(id){
  return new Promise(function(res,rej){
    var r=db.transaction('stickers','readwrite').objectStore('stickers').delete(id);
    r.onsuccess=function(){res();};r.onerror=function(){rej(r.error);};
  });
}