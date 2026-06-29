/* ══════════ UI.js - 界面层 ══════════ */

/* ── 初始化 ── */
async function init(){
  await openDB();
  if(navigator.storage&&navigator.storage.persist){navigator.storage.persist().catch(function(){});}
  channels=await kvGet('channels')||[];
  convs=await kvGet('convs')||[];
  activeId=await kvGet('activeId')||null;

  if(!convs.length){
    var oldCfg=null,oldMsgs=null;
    try{oldCfg=JSON.parse(localStorage.getItem('minichat_cfg')||'null');}catch(e){}
    try{oldMsgs=JSON.parse(localStorage.getItem('minichat_msgs')||'null');}catch(e){}
    var ch=null;
    if(oldCfg&&oldCfg.url){
      ch={id:uid(),name:'渠道1',url:oldCfg.url,key:oldCfg.key||'',models:oldCfg.models||[]};
      channels.push(ch);
    }
    var conv={
      id:uid(),name:'对话1',
      system:oldCfg&&oldCfg.system||'',
      ctx:oldCfg?(oldCfg.ctx!=null?oldCfg.ctx:20):20,
      temp:oldCfg?(oldCfg.temp!=null?oldCfg.temp:0.8):0.8,
      mode:'round',
      members:(ch&&oldCfg.model)?[{id:uid(),channelId:ch.id,model:oldCfg.model,name:oldCfg.model}]:[],
      updatedAt:Date.now()
    };
    convs.push(conv);activeId=conv.id;
    if(oldMsgs&&oldMsgs.length){
      var now=Date.now();
      oldMsgs.forEach(function(m){
        if(!m.ts)m.ts=now;
        if(m.role==='assistant'&&!m.name)m.name=m.model||'AI';
        if(m.role==='assistant'&&conv.members.length&&!m.memberId)m.memberId=conv.members[0].id;
      });
      await msgsSet(conv.id,oldMsgs);
    }
    await saveMeta();
    if(oldMsgs||oldCfg)toast('已迁移旧记录到「对话1」✓');
  }
  if(!activeId||!getConv())activeId=convs[0].id;
  msgs=await msgsGet(activeId);
  await stkLoad();
  render();renderMemberBar();updateTitle();
  await renderCharList();
  await renderPersonaList();
  await renderRpList();
}

/* ── 标题 ── */
function updateTitle(){
  var c=getConv();
  $('convTitle').childNodes[0].textContent=c?c.name:'对话';
  $('ctxBadge').textContent=c?(' · 上下文'+c.ctx):'';
}

/* ── 渲染 ── */
function render(){
  var c=getConv();if(!c)return;
  chatEl.innerHTML='';
  var cutIndex=c.ctx>0?Math.max(0,msgs.length-c.ctx):msgs.length;
  msgs.forEach(function(m,i){
    if(i===cutIndex&&i>0){
      var cut=document.createElement('div');
      cut.className='cut-line';
      cut.textContent='⬇ 上下文起点（以下 '+(msgs.length-i)+' 条会被发送）';
      chatEl.appendChild(cut);
    }
    chatEl.appendChild(i===editIdx?buildEditNode(m,i):buildMsgNode(m,i));
  });
  chatEl.scrollTop=chatEl.scrollHeight;
}

function buildMsgNode(m,i){
  var wrap=document.createElement('div');
  wrap.className='msg-wrap '+(m.role==='user'?'user':'ai');
  if(m.role==='assistant'&&(m.name||m.model)){
    var tag=document.createElement('div');
    tag.className='model-tag';tag.textContent=m.name||m.model;
    wrap.appendChild(tag);
  }
  if(m.reasoning){
    var det=document.createElement('details');det.className='think';
    det.innerHTML='<summary>💭 思考过程 ('+m.reasoning.length+'字)</summary>';
    var body=document.createElement('div');body.className='tbody';body.textContent=m.reasoning;
    det.appendChild(body);wrap.appendChild(det);
  }
  var row=document.createElement('div');
  row.className='msg '+(m.role==='user'?'user':'ai');
  var b=document.createElement('div');b.className='bubble';
  (m.images||[]).forEach(function(src){var img=document.createElement('img');img.className='att';img.src=src;b.appendChild(img);});
  (m.files||[]).forEach(function(f){
    var chip=document.createElement('span');chip.className='filechip';chip.textContent='📄 '+f.name;
    b.appendChild(chip);b.appendChild(document.createElement('br'));
  });
  var txt=document.createElement('span');txt.className='txt';txt.innerHTML=renderMd(m.content||'');
  b.appendChild(txt);
  b.onclick=function(){if(streaming)return;wrap.classList.toggle('show-actions');};
  row.appendChild(b);wrap.appendChild(row);

  var act=document.createElement('div');act.className='actions';
  var bc=document.createElement('button');bc.textContent='📋 复制';
  bc.onclick=function(){
    var t=m.content||'';
    if(navigator.clipboard){navigator.clipboard.writeText(t).then(function(){toast('已复制 ✓');}).catch(function(){toast('复制失败');});}
    else{var ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);toast('已复制 ✓');}
  };
  act.appendChild(bc);
  var be=document.createElement('button');be.textContent='✏️ 编辑';
  be.onclick=function(){if(streaming)return;editIdx=i;render();};
  act.appendChild(be);
  if(m.role==='assistant'){
    var br=document.createElement('button');br.textContent='🔄 重说';
    br.onclick=function(){if(streaming)return;regen(i);};
    act.appendChild(br);
  }
  var bk=document.createElement('button');bk.textContent='↩️ 回溯';
  bk.onclick=async function(){
    if(streaming)return;
    var after=msgs.length-i-1;
    if(after<=0){toast('后面没有消息了');return;}
    if(!confirm('删除这条之后的 '+after+' 条消息？'))return;
    msgs.splice(i+1);await saveMsgs();render();toast('已回溯 ✓');
  };
  act.appendChild(bk);
  var bd=document.createElement('button');bd.className='warn';bd.textContent='🗑 删除';
  bd.onclick=async function(){if(streaming)return;msgs.splice(i,1);await saveMsgs();render();};
  act.appendChild(bd);
  wrap.appendChild(act);

  var meta=document.createElement('div');meta.className='meta-line';
  var parts=[fmtTime(m.ts)];
  if(m.role==='assistant'&&m.meta){
    var pre=m.meta.est?'~':'';
    parts.push('↑'+pre+(m.meta.inTok||0)+' tok','↓'+pre+(m.meta.outTok||0)+' tok',((m.meta.ms||0)/1000).toFixed(1)+'s');
  }
  meta.textContent=parts.filter(Boolean).join(' · ');
  wrap.appendChild(meta);
  return wrap;
}

function buildEditNode(m,i){
  var wrap=document.createElement('div');
  wrap.className='msg-wrap '+(m.role==='user'?'user':'ai');
  var box=document.createElement('div');box.className='edit-box';
  var ta=document.createElement('textarea');ta.value=m.content||'';
  ta.style.minHeight='80px';
  ta.style.maxHeight='50vh';
  setTimeout(function(){ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,window.innerHeight*0.5)+'px';},10);
  ta.addEventListener('input',function(){ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,window.innerHeight*0.5)+'px';});
  var btns=document.createElement('div');btns.className='edit-btns';
  var cancel=document.createElement('button');cancel.className='edit-cancel';cancel.textContent='取消';
  cancel.onclick=function(){editIdx=null;render();};
  var save=document.createElement('button');save.className='edit-save';save.textContent='保存';
  save.onclick=async function(){m.content=ta.value;editIdx=null;await saveMsgs();render();toast('已保存 ✓');};
  btns.appendChild(cancel);btns.appendChild(save);
  if(m.role==='user'){
    var resend=document.createElement('button');resend.className='edit-save';resend.textContent='保存并重发';
    resend.onclick=async function(){
      if(streaming)return;
      m.content=ta.value;m.ts=Date.now();editIdx=null;
      msgs.splice(i+1);
      await saveMsgs();render();
      var c=getConv();
      if(c.mode==='round'){
        for(var mi=0;mi<c.members.length;mi++){
          if(stopChain)break;
          var idx=pushAiMsg(c.members[mi]);
          await saveMsgs();render();
          await runGeneration(idx,c.members[mi]);
        }
        stopChain=false;
      }
    };
    btns.appendChild(resend);
  }
  box.appendChild(ta);box.appendChild(btns);wrap.appendChild(box);
  setTimeout(function(){ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);},50);
  return wrap;
}

function updateMsgDom(i){
  var wraps=chatEl.querySelectorAll('.msg-wrap');
  var wrap=wraps[i];if(!wrap)return;
  var m=msgs[i];
  var det=wrap.querySelector('details.think');
  if(m.reasoning&&!det){
    det=document.createElement('details');det.className='think';det.open=true;
    det.innerHTML='<summary>💭 思考中…</summary><div class="tbody"></div>';
    wrap.insertBefore(det,wrap.querySelector('.msg'));
  }
  if(det&&m.reasoning){
    det.querySelector('.tbody').textContent=m.reasoning;
    det.querySelector('summary').textContent=m.content?'💭 思考过程 ('+m.reasoning.length+'字)':'💭 思考中…';
    if(m.content)det.open=false;
  }
  var txt=wrap.querySelector('.bubble .txt');
  if(txt)txt.textContent=m.content;
  chatEl.scrollTop=chatEl.scrollHeight;
}

/* ── 成员条 ── */
function renderMemberBar(){
  var c=getConv();var bar=$('memberBar');bar.innerHTML='';
  if(!c||!c.members.length)return;
  c.members.forEach(function(mem){
    var chip=document.createElement('div');
    chip.className='chip'+(streaming?' busy':'');
    chip.innerHTML='<span class="dot"></span>';
    chip.appendChild(document.createTextNode(mem.name||mem.model));
    chip.onclick=function(){if(streaming)return;manualSpeak(mem);};
    bar.appendChild(chip);
  });
  var hint=document.createElement('span');
  hint.className='chip-hint';
  hint.textContent=c.mode==='pick'?'👆点名模式':'🔁轮流模式';
  bar.appendChild(hint);
}

/* ── 对话抽屉 ── */
function renderConvList(){
  var list=$('convList');list.innerHTML='';
  convs.slice().sort(function(a,b){return(b.updatedAt||0)-(a.updatedAt||0);}).forEach(function(c){
    var item=document.createElement('div');
    item.className='conv-item'+(c.id===activeId?' active':'');
    var info=document.createElement('div');info.className='cinfo';
    info.innerHTML='<div class="cname"></div><div class="cmeta"></div>';
    info.querySelector('.cname').textContent=c.name;
    info.querySelector('.cmeta').textContent=c.members.map(function(m){return m.name||m.model;}).join('、')||'无成员';
    info.onclick=function(){switchConv(c.id);};
    var del=document.createElement('button');del.className='cdel';del.textContent='🗑';
    del.onclick=async function(e){
      e.stopPropagation();
      if(!confirm('删除对话「'+c.name+'」及其全部消息？'))return;
      await msgsDel(c.id);
      convs=convs.filter(function(x){return x.id!==c.id;});
      if(!convs.length){
        var nc={id:uid(),name:'对话1',system:'',ctx:20,temp:0.8,mode:'round',members:[],updatedAt:Date.now()};
        convs.push(nc);
      }
      if(activeId===c.id){activeId=convs[0].id;msgs=await msgsGet(activeId);}
      await saveMeta();renderConvList();render();renderMemberBar();updateTitle();
    };
    item.appendChild(info);item.appendChild(del);
    list.appendChild(item);
  });
}
async function switchConv(id){
  if(streaming){toast('生成中，请先停止');return;}
  activeId=id;msgs=await msgsGet(id);editIdx=null;
  document.getElementById('input').value='';
  await kvSet('activeId',id);
  closeDrawer();render();renderMemberBar();updateTitle();
}
$('btnNewConv').onclick=async function(){
  var c={id:uid(),name:'对话'+(convs.length+1),system:'',ctx:20,temp:0.8,mode:'round',
    members:[],updatedAt:Date.now()};
  convs.push(c);await saveMeta();
  await switchConv(c.id);
  toast('已创建，请到设置 ⚙️ 添加成员');
};
function openDrawer(){renderConvList();$('drawer').classList.add('open');$('maskConv').classList.add('open');}
function closeDrawer(){$('drawer').classList.remove('open');$('maskConv').classList.remove('open');}
$('btnConvs').onclick=openDrawer;
$('maskConv').onclick=closeDrawer;

/* ── 右侧工具栏 ── */
var currentTool=null;
function openToolbar(){
  $('toolbar').classList.add('open');$('maskTool').classList.add('open');
  if(currentTool)showTool(null);
}
function closeToolbar(){$('toolbar').classList.remove('open');$('maskTool').classList.remove('open');}
function showTool(name){
  document.querySelectorAll('.tb-page').forEach(function(p){p.classList.remove('active');});
  if(name){
    currentTool=name;
    $('tool-'+name).classList.add('active');
    $('tbBack').classList.add('show');
    $('tbTitle').textContent={search:'搜索',emoji:'表情',backup:'备份'}[name]||'工具箱';
  }else{
    currentTool=null;
    $('tool-grid').classList.add('active');
    $('tbBack').classList.remove('show');
    $('tbTitle').textContent='工具箱';
  }
}
$('maskTool').onclick=closeToolbar;
$('tbBack').onclick=function(){showTool(null);};
$('btnToolbar').onclick=openToolbar;
document.querySelectorAll('.tb-cell').forEach(function(cell){
  cell.onclick=function(){showTool(cell.dataset.tool);};
});

/* ── 聊天记录搜索 ── */
var searchTimer=null;
$('searchInput').addEventListener('input',function(){
  clearTimeout(searchTimer);
  var q=this.value.trim();
  if(!q){$('searchResults').innerHTML='<div class="tb-empty">输入关键词开始搜索</div>';return;}
  searchTimer=setTimeout(function(){doSearch(q);},300);
});
function doSearch(q){
  var box=$('searchResults');
  var lower=q.toLowerCase();
  var hits=[];
  msgs.forEach(function(m,i){
    if(!m.content)return;
    var idx=m.content.toLowerCase().indexOf(lower);
    if(idx===-1)return;
    hits.push({i:i,m:m,idx:idx});
  });
  if(!hits.length){box.innerHTML='<div class="tb-empty">没有找到「'+q+'」</div>';return;}
  box.innerHTML='';
  hits.forEach(function(h){
    var div=document.createElement('div');div.className='tb-result';
    var name=document.createElement('div');name.className='tb-r-name';
    name.textContent=(h.m.role==='user'?'👤 你':'✦ '+(h.m.name||h.m.model||'AI'))+' · '+fmtTime(h.m.ts);
    var text=document.createElement('div');text.className='tb-r-text';
    var start=Math.max(0,h.idx-20);
    var end=Math.min(h.m.content.length,h.idx+q.length+40);
    var snippet=(start>0?'…':'')+h.m.content.slice(start,end)+(end<h.m.content.length?'…':'');
    var esc=snippet.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    var re=new RegExp('('+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi');
    text.innerHTML=esc.replace(re,'<mark>$1</mark>');
    div.appendChild(name);div.appendChild(text);
    div.onclick=function(){
      closeToolbar();
      setTimeout(function(){
        var container=rpMode?document.getElementById('rpMessages'):chatEl;
        var wraps=container.querySelectorAll('.msg-wrap');
        var target=wraps[h.i];
        if(!target)return;
        target.scrollIntoView({behavior:'smooth',block:'center'});
        target.style.transition='background .3s';
        target.style.background='#fce4ec';
        setTimeout(function(){target.style.background='';},1500);
      },300);
    };
    box.appendChild(div);
  });
  box.insertAdjacentHTML('afterbegin','<div class="tb-empty" style="padding:10px;font-size:11px;">找到 '+hits.length+' 条结果</div>');
}

/* ══════════ 导入导出 ══════════ */
function downloadFile(name,content,type){
  var blob=new Blob([content],{type:type||'text/plain;charset=utf-8'});
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=name;a.click();URL.revokeObjectURL(a.href);
}
$('expTxt').onclick=function(){
  var c=getConv();if(!c)return;
  var lines=[];
  lines.push('# '+c.name);
  lines.push('# 导出时间：'+new Date().toLocaleString());
  lines.push('# 消息数：'+msgs.length);
  lines.push('');
  msgs.forEach(function(m){
    var time=m.ts?new Date(m.ts).toLocaleString():'';
    var who=m.role==='user'?'👤 你':'✦ '+(m.name||m.model||'AI');
    lines.push('['+time+'] '+who);
    if(m.content)lines.push(m.content);
    if(m.images&&m.images.length)lines.push('[图片 x'+m.images.length+']');
    if(m.files&&m.files.length)m.files.forEach(function(f){lines.push('[文件: '+f.name+']');});
    lines.push('');
  });
  var fname=c.name.replace(/[^\w\u4e00-\u9fff]/g,'_')+'_'+new Date().toISOString().slice(0,10)+'.txt';
  downloadFile(fname,lines.join('\n'));
  toast('已导出 TXT ✓');
};
$('expJsonl').onclick=function(){
  var c=getConv();if(!c)return;
  var lines=msgs.map(function(m){return JSON.stringify(m);});
  var fname=c.name.replace(/[^\w\u4e00-\u9fff]/g,'_')+'_'+new Date().toISOString().slice(0,10)+'.jsonl';
  downloadFile(fname,lines.join('\n'),'application/jsonl');
  toast('已导出 JSONL ✓');
};
$('expFull').onclick=async function(){
  var backup={
    version:1,
    exportedAt:new Date().toISOString(),
    channels:channels,
    convs:[]
  };
  for(var i=0;i<convs.length;i++){
    var c=convs[i];
    var m=await msgsGet(c.id);
    backup.convs.push({meta:c,messages:m});
  }
  var fname='RabbitHole_backup_'+new Date().toISOString().slice(0,10)+'.json';
  downloadFile(fname,JSON.stringify(backup,null,2),'application/json');
  toast('完整备份已导出 ✓');
};
var impMode=null;
$('impJsonl').onclick=function(){impMode='jsonl';$('impFile').accept='.jsonl';$('impFile').click();};
$('impFull').onclick=function(){impMode='full';$('impFile').accept='.json';$('impFile').click();};
$('impFile').onchange=async function(e){
  var file=e.target.files[0];if(!file)return;
  e.target.value='';
  try{
    var text=await new Promise(function(r){var fr=new FileReader();fr.onload=function(){r(fr.result);};fr.readAsText(file);});
    if(impMode==='jsonl'){
      var lines=text.trim().split('\n').filter(Boolean);
      var imported=[];
      lines.forEach(function(line){
        try{
          var m=JSON.parse(line);
          if(m.role){imported.push(m);}
          else if(m.mes!==undefined){
            var converted={
              role:m.is_user?'user':'assistant',
              content:m.mes||'',
              name:m.name||'',
              ts:m.send_date?new Date(m.send_date).getTime():Date.now()
            };
            if(!m.is_system&&converted.content)imported.push(converted);
          }
        }catch(e){}
      });
      if(!imported.length){toast('没有找到有效消息');return;}
      var fname=file.name.replace(/\.[^.]+$/,'');
      if(!confirm('将 '+imported.length+' 条消息导入为新对话「'+fname+'」？'))return;
      var now=Date.now();
      imported.forEach(function(m){if(!m.ts)m.ts=now;});
      var newConv={id:uid(),name:fname,system:'',ctx:20,temp:0.8,mode:'round',members:[],updatedAt:now};
      convs.push(newConv);
      await msgsSet(newConv.id,imported);
      activeId=newConv.id;
      msgs=imported;
      await saveMeta();
      render();renderMemberBar();updateTitle();
      closeToolbar();
      toast('已导入 '+imported.length+' 条消息到新对话「'+fname+'」 ✓');
    }else if(impMode==='full'){
      var backup=JSON.parse(text);
      if(!backup.version||!backup.convs){toast('不是有效的备份文件');return;}
      if(!confirm('恢复备份将覆盖当前所有数据！\n包含 '+backup.convs.length+' 个对话、'+(backup.channels||[]).length+' 个渠道\n确定继续？'))return;
      channels=backup.channels||[];
      convs=[];
      for(var i=0;i<backup.convs.length;i++){
        var item=backup.convs[i];
        convs.push(item.meta);
        await msgsSet(item.meta.id,item.messages||[]);
      }
      if(!convs.length)convs.push({id:uid(),name:'对话1',system:'',ctx:20,temp:0.8,mode:'round',members:[],updatedAt:Date.now()});
      activeId=convs[0].id;
      msgs=await msgsGet(activeId);
      await saveMeta();
      render();renderMemberBar();updateTitle();
      closeToolbar();
      toast('备份恢复成功 ✓ （'+backup.convs.length+' 个对话）');
    }
  }catch(err){
    toast('导入失败：'+(err.message||err));
  }
};

/* ── 设置面板 ── */
document.querySelectorAll('.tabs button').forEach(function(btn){
  btn.onclick=function(){
    if(!btn.dataset.tab&&!btn.dataset.rptab)return;
    if(btn.dataset.rptab){
      document.querySelectorAll('#rpSettingsPanel .tabs button').forEach(function(b){b.classList.remove('active');});
      document.querySelectorAll('#rpSettingsPanel .tab-page').forEach(function(p){p.classList.remove('active');});
      btn.classList.add('active');
      $('rptab-'+btn.dataset.rptab).classList.add('active');
      if(btn.dataset.rptab==='channel')renderRpChannelList();
      if(btn.dataset.rptab==='general')updateRpStorageBox();
      return;
    }
    document.querySelectorAll('#panel .tabs button').forEach(function(b){b.classList.remove('active');});
    document.querySelectorAll('#panel .tab-page').forEach(function(p){p.classList.remove('active');});
    btn.classList.add('active');
    $('tab-'+btn.dataset.tab).classList.add('active');
    if(btn.dataset.tab==='general')updateStorageBox();
  };
});
function openPanel(){
  var c=getConv();
  $('setConvName').value=c.name;
  $('setSystem').value=c.system;
  $('setCtx').value=c.ctx;$('ctxVal').textContent=c.ctx;
  $('setTemp').value=c.temp;$('tempVal').textContent=c.temp;
  draftMembers=c.members.map(function(m){return Object.assign({},m);});
  setModeBtns(c.mode);
  renderMemberEditor();renderChannelSelect();renderChannelList();
  $('panel').classList.add('open');$('mask').classList.add('open');
}
function closePanel(){$('panel').classList.remove('open');$('mask').classList.remove('open');}
$('btnSettings').onclick=openPanel;
$('mask').onclick=closePanel;
$('setCtx').oninput=function(e){$('ctxVal').textContent=e.target.value;};
$('setTemp').oninput=function(e){$('tempVal').textContent=e.target.value;};
var draftMode='round';
function setModeBtns(mode){
  draftMode=mode;
  $('modeRound').classList.toggle('on',mode==='round');
  $('modePick').classList.toggle('on',mode==='pick');
}
$('modeRound').onclick=function(){setModeBtns('round');};
$('modePick').onclick=function(){setModeBtns('pick');};

function renderMemberEditor(){
  var box=$('memberList');box.innerHTML='';
  draftMembers.forEach(function(m,i){
    var item=document.createElement('div');item.className='member-item';
    var name=document.createElement('input');name.className='mname';name.value=m.name||m.model;
    name.onchange=function(){m.name=name.value.trim()||m.model;};
    var model=document.createElement('span');model.className='mmodel';
    var ch=getChannel(m.channelId);
    model.textContent=(ch?ch.name:'⚠渠道丢失')+'/'+m.model;
    var up=document.createElement('button');up.textContent='↑';
    up.onclick=function(){if(i>0){var tmp=draftMembers[i-1];draftMembers[i-1]=draftMembers[i];draftMembers[i]=tmp;renderMemberEditor();}};
    var down=document.createElement('button');down.textContent='↓';
    down.onclick=function(){if(i<draftMembers.length-1){var tmp=draftMembers[i+1];draftMembers[i+1]=draftMembers[i];draftMembers[i]=tmp;renderMemberEditor();}};
    var rm=document.createElement('button');rm.textContent='✕';
    rm.onclick=function(){draftMembers.splice(i,1);renderMemberEditor();};
    item.appendChild(name);item.appendChild(model);item.appendChild(up);item.appendChild(down);item.appendChild(rm);
    box.appendChild(item);
  });
}
function renderChannelSelect(){
  var sel=$('addMemberChannel');sel.innerHTML='';
  channels.forEach(function(ch){
    var o=document.createElement('option');o.value=ch.id;o.textContent=ch.name;
    sel.appendChild(o);
  });
  sel.onchange=fillModelDatalist;
  fillModelDatalist();
}
function fillModelDatalist(){
  var ch=getChannel($('addMemberChannel').value);
  var dl=$('modelList');dl.innerHTML='';
  if(ch&&ch.models)ch.models.forEach(function(id){var o=document.createElement('option');o.value=id;dl.appendChild(o);});
}
$('btnAddMember').onclick=function(){
  if(draftMembers.length>=3){toast('最多3个成员');return;}
  var chId=$('addMemberChannel').value;
  var model=$('addMemberModel').value.trim();
  if(!chId){toast('请先在「渠道」tab添加渠道');return;}
  if(!model){toast('请填模型名');return;}
  draftMembers.push({id:uid(),channelId:chId,model:model,name:model});
  $('addMemberModel').value='';
  renderMemberEditor();
};
$('btnSaveConv').onclick=async function(){
  var c=getConv();
  c.name=$('setConvName').value.trim()||c.name;
  c.system=$('setSystem').value;
  c.ctx=parseInt($('setCtx').value)||0;
  c.temp=parseFloat($('setTemp').value)||0.8;
  c.mode=draftMode;
  c.members=draftMembers;
  c.updatedAt=Date.now();
  await saveMeta();
  closePanel();render();renderMemberBar();updateTitle();
  toast('已保存 ✓');
};
$('btnDelConv').onclick=async function(){
  var c=getConv();
  if(!confirm('删除对话「'+c.name+'」及其全部消息？'))return;
  await msgsDel(c.id);
  convs=convs.filter(function(x){return x.id!==c.id;});
  if(!convs.length)convs.push({id:uid(),name:'对话1',system:'',ctx:20,temp:0.8,mode:'round',members:[],updatedAt:Date.now()});
  activeId=convs[0].id;msgs=await msgsGet(activeId);
  await saveMeta();closePanel();render();renderMemberBar();updateTitle();
};

/* ── 渠道管理 ── */
function renderChannelList(){
  var box=$('channelList');box.innerHTML='';
  channels.forEach(function(ch,i){
    var card=document.createElement('div');card.className='channel-card';
    card.innerHTML=
      '<div class="field"><label>渠道名称</label><input type="text" data-f="name"></div>'+
      '<div class="field"><label>API 地址</label><input type="text" data-f="url" placeholder="https://api.example.com/v1"></div>'+
      '<div class="field"><label>API Key</label><input type="password" data-f="key"></div>'+
      '<div class="ch-btns"><button data-a="fetch">🔄 拉取模型</button><button data-a="del" class="warn">删除渠道</button></div>'+
      '<div class="ch-status"></div>';
    card.querySelector('[data-f=name]').value=ch.name;
    card.querySelector('[data-f=url]').value=ch.url;
    card.querySelector('[data-f=key]').value=ch.key;
    card.querySelector('.ch-status').textContent=ch.models&&ch.models.length?('已缓存 '+ch.models.length+' 个模型'):'';
    card.querySelectorAll('[data-f]').forEach(function(inp){
      inp.onchange=function(){ch[inp.dataset.f]=inp.value.trim();};
    });
    card.querySelector('[data-a=fetch]').onclick=async function(){
      var st=card.querySelector('.ch-status');
      ch.name=card.querySelector('[data-f=name]').value.trim();
      ch.url=card.querySelector('[data-f=url]').value.trim();
      ch.key=card.querySelector('[data-f=key]').value.trim();
      if(!ch.url||!ch.key){st.textContent='❌ 先填地址和Key';return;}
      st.textContent='拉取中…';
      try{
        var res=await fetch(ch.url.replace(/\/+$/,'')+'/models',{headers:{'Authorization':'Bearer '+ch.key}});
        if(!res.ok)throw new Error('HTTP '+res.status);
        var j=await res.json();
        var ids=(j.data||[]).map(function(m){return m.id;}).filter(Boolean).sort();
        if(!ids.length)throw new Error('返回列表为空');
        ch.models=ids;await saveMeta();
        st.textContent='✓ 拉取到 '+ids.length+' 个模型';
        fillModelDatalist();
      }catch(e){st.textContent='❌ '+(e.message||e);}
    };
    card.querySelector('[data-a=del]').onclick=async function(){
      var used=convs.some(function(c){return c.members.some(function(m){return m.channelId===ch.id;});});
      if(used&&!confirm('有对话的成员正在使用此渠道，删除后这些成员将无法发言。继续？'))return;
      channels.splice(i,1);await saveMeta();
      renderChannelList();renderChannelSelect();
    };
    box.appendChild(card);
  });
}
$('btnNewChannel').onclick=function(){
  channels.push({id:uid(),name:'渠道'+(channels.length+1),url:'',key:'',models:[]});
  renderChannelList();renderChannelSelect();
};
$('btnSaveChannels').onclick=async function(){
  await saveMeta();
  renderChannelSelect();
  toast('渠道已保存 ✓');
};

/* ── 通用tab ── */
async function updateStorageBox(){
  var box=$('storageBox');
  try{
    var est=await navigator.storage.estimate();
    var used=(est.usage/1024/1024).toFixed(1);
    var quota=(est.quota/1024/1024).toFixed(0);
    var persist='';
    if(navigator.storage.persisted)persist=(await navigator.storage.persisted())?'✓ 已申请持久化保护':'未持久化（可点下方按钮申请）';
    box.innerHTML='已用 '+used+' MB / 配额约 '+quota+' MB<br>'+persist+'<br>对话数：'+convs.length+' · 渠道数：'+channels.length+((window.__xwDebug&&window.__xwDebug.length)?('<br><br>📋 断流日志：<br>'+window.__xwDebug.join('<br>')):'');
  }catch(e){box.textContent='当前环境不支持存储查询';}
}
$('btnPersist').onclick=async function(){
  var btn=$('btnPersist');
  btn.textContent='⏳ 申请中…';
  try{
    if(!navigator.storage||!navigator.storage.persist){
      toast('❌ 此浏览器不支持持久化API');
      btn.textContent='🔒 申请持久化保护';
      return;
    }
    var ok=await navigator.storage.persist();
    if(ok){
      toast('✓ 申请成功，数据已受保护');
    }else{
      toast('⚠ 浏览器拒绝了申请，但数据依然正常保存');
    }
    btn.textContent='🔒 申请持久化保护';
  }catch(e){
    toast('❌ 申请出错：'+(e.message||e));
    btn.textContent='🔒 申请持久化保护';
  }
};
$('btnClearChat').onclick=async function(){
  if(!confirm('清空当前对话的所有消息？'))return;
  msgs=[];await saveMsgs();render();closePanel();toast('已清空');
};

/*RP面板 - 渠道tab */
function renderRpChannelList(){
  var box=$('rpChannelList');box.innerHTML='';
  channels.forEach(function(ch,i){
    var card=document.createElement('div');card.className='channel-card';
    card.innerHTML=
      '<div class="field"><label>渠道名称</label><input type="text" data-f="name"></div>'+
      '<div class="field"><label>API地址</label><input type="text" data-f="url" placeholder="https://api.example.com/v1"></div>'+
      '<div class="field"><label>API Key</label><input type="password" data-f="key"></div>'+
      '<div class="ch-btns"><button data-a="fetch">🔄 拉取模型</button><button data-a="del" class="warn">删除渠道</button></div>'+
      '<div class="ch-status"></div>';
    card.querySelector('[data-f=name]').value=ch.name;
    card.querySelector('[data-f=url]').value=ch.url;
    card.querySelector('[data-f=key]').value=ch.key;
    card.querySelector('.ch-status').textContent=ch.models&&ch.models.length?('已缓存 '+ch.models.length+' 个模型'):'';
    card.querySelectorAll('[data-f]').forEach(function(inp){
      inp.onchange=function(){ch[inp.dataset.f]=inp.value.trim();};
    });
    card.querySelector('[data-a=fetch]').onclick=async function(){
      var st=card.querySelector('.ch-status');
      ch.name=card.querySelector('[data-f=name]').value.trim();
      ch.url=card.querySelector('[data-f=url]').value.trim();
      ch.key=card.querySelector('[data-f=key]').value.trim();
      if(!ch.url||!ch.key){st.textContent='❌ 先填地址和Key';return;}
      st.textContent='拉取中…';
      try{
        var res=await fetch(ch.url.replace(/\/+$/,'')+'/models',{headers:{'Authorization':'Bearer '+ch.key}});
        if(!res.ok)throw new Error('HTTP '+res.status);
        var j=await res.json();
        var ids=(j.data||[]).map(function(m){return m.id;}).filter(Boolean).sort();
        if(!ids.length)throw new Error('返回列表为空');
        ch.models=ids;await saveMeta();
        st.textContent='✓拉取到 '+ids.length+' 个模型';
      }catch(e){st.textContent='❌ '+(e.message||e);}
    };
    card.querySelector('[data-a=del]').onclick=async function(){
      if(!confirm('删除此渠道？'))return;
      channels.splice(i,1);await saveMeta();
      renderRpChannelList();
    };
    box.appendChild(card);
  });
}

$('btnRpNewChannel').onclick=function(){
  channels.push({id:uid(),name:'渠道'+(channels.length+1),url:'',key:'',models:[]});
  renderRpChannelList();
};

$('btnRpSaveChannels').onclick=async function(){
  await saveMeta();
  toast('渠道已保存 ✓');
};

/* RP面板 - 通用tab */
async function updateRpStorageBox(){
  var box=$('rpStorageBox');
  try{
    var est=await navigator.storage.estimate();
    var used=(est.usage/1024/1024).toFixed(1);
    var quota=(est.quota/1024/1024).toFixed(0);
    var persist='';
    if(navigator.storage.persisted)persist=(await navigator.storage.persisted())?'✓ 已持久化':'未持久化';
    box.innerHTML='已用 '+used+' MB /配额约 '+quota+' MB<br>'+persist;
  }catch(e){box.textContent='不支持存储查询';}
}

$('btnRpPersist').onclick=async function(){
  try{
    var ok=await navigator.storage.persist();
    toast(ok?'✓ 持久化成功':'⚠ 浏览器拒绝了申请');
  }catch(e){toast('❌ 申请出错');}
};

/* RP面板 - 清空对话 */
$('btnRpClearChat').onclick=async function(){
  if(!confirm('清空当前对话的所有消息？'))return;
  rpMsgs=[];
  await msgsSet(activeRpConvId,rpMsgs);
  var convs=await rpConvGetAll();
  var conv=convs.find(function(c){return c.id===activeRpConvId;});
  if(conv)renderRpMessages(conv);
  document.getElementById('maskRpSettings').style.display='none';
  document.getElementById('rpSettingsPanel').classList.remove('open');
  toast('已清空');
};

/* RP工具栏按钮 */
document.getElementById('rpBtnToolbar').onclick=function(){openToolbar();};

/* RP表情包按钮 */
document.getElementById('rpBtnSticker').onclick=function(){
  stickerOpen=!stickerOpen;
  var popup=$('rpStickerPopup');
  var grid=$('rpStickerGrid');
  if(stickerOpen){
    grid.innerHTML='';
    if(!stickers.length){
      grid.innerHTML='<div class="stk-empty">还没有表情包 😺</div>';
    }else{
      var lastCat='';
      stickers.forEach(function(s){
        if(s.cat!==lastCat){
          lastCat=s.cat;
          var label=document.createElement('div');
          label.style.cssText='grid-column:1/-1;font-size:11px;color:#b89a8c;padding:4px 02px;';
          label.textContent=s.cat;
          grid.appendChild(label);
        }var cell=document.createElement('div');cell.className='stk-item';
        var img=document.createElement('img');img.src=s.url;img.alt=s.name;img.title=s.name;
        cell.appendChild(img);
        cell.onclick=function(){
          document.getElementById('rpInput').value+='[表情:'+s.name+']';
          popup.classList.remove('open');
          stickerOpen=false;
        };
        grid.appendChild(cell);
      });
    }popup.classList.add('open');
  }else{
    popup.classList.remove('open');
  }
};

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
function renderAttach(){
  var bar=rpMode?$('rpAttachBar'):$('attachBar');
  bar.innerHTML='';
  bar.classList.toggle('has',pendingAtt.length>0);
  pendingAtt.forEach(function(a,i){
    var chip=document.createElement('div');chip.className='att-chip';
    if(a.type==='image'){var img=document.createElement('img');img.src=a.data;chip.appendChild(img);}
    else{var n=document.createElement('div');n.className='fname';n.textContent='📄 '+a.name;chip.appendChild(n);}
    var rm=document.createElement('button');rm.className='rm';rm.textContent='×';
    rm.onclick=function(){pendingAtt.splice(i,1);renderAttach();};
    chip.appendChild(rm);bar.appendChild(chip);
  });
}

/* RP附件按钮 */
document.getElementById('rpBtnAttach').onclick=function(){
  document.getElementById('rpFileInput').click();
};

document.getElementById('rpFileInput').onchange=async function(e){
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
  e.target.value='';
  renderAttach();
};

/* ── 输入框 ── */
function autoGrow(){inputEl.style.height='auto';inputEl.style.height=Math.min(inputEl.scrollHeight,110)+'px';}
inputEl.addEventListener('input',autoGrow);
sendBtn.onclick=send;

/* ══ 表情包弹窗（输入栏上方） ══ */
var stickerOpen=false;
$('btnSticker').onclick=function(){
  stickerOpen=!stickerOpen;
  if(stickerOpen){renderStickerPopup();$('stickerPopup').classList.add('open');}
  else{$('stickerPopup').classList.remove('open');}
};
function renderStickerPopup(){
  var grid=$('stickerGrid');grid.innerHTML='';
  if(!stickers.length){
    grid.innerHTML='<div class="stk-empty">还没有表情包，去工具栏添加吧 😺</div>';
    return;
  }
  /* 按分类排序：卖萌撒娇→抽象恶搞→其他 */
  var order={'卖萌撒娇':0,'抽象恶搞':1,'其他':2};
  var sorted=stickers.slice().sort(function(a,b){return (order[a.cat]||2)-(order[b.cat]||2);});
  var lastCat='';
  sorted.forEach(function(s){
    if(s.cat!==lastCat){
      lastCat=s.cat;
      var label=document.createElement('div');
      label.style.cssText='grid-column:1/-1;font-size:11px;color:#b89a8c;padding:4px 0 2px;';
      label.textContent=s.cat;
      grid.appendChild(label);
    }
    var cell=document.createElement('div');cell.className='stk-item';
    var img=document.createElement('img');img.src=s.url;img.alt=s.name;img.title=s.name;
    cell.appendChild(img);
    cell.onclick=function(){
      inputEl.value+='[表情:'+s.name+']';
      autoGrow();
      $('stickerPopup').classList.remove('open');
      stickerOpen=false;
    };
    grid.appendChild(cell);
  });
}

/* ══ 表情包管理页（工具栏） ══ */
var stkTempUrl='';
$('btnStkFile').onclick=function(){$('stkFileInput').click();};
$('stkFileInput').onchange=function(e){
  var file=e.target.files[0];if(!file)return;
  if(file.size>2*1024*1024){toast('图片超过2MB');return;}
  var fr=new FileReader();
  fr.onload=function(){
    stkTempUrl=fr.result;
    $('stkPreview').innerHTML='<img src="'+stkTempUrl+'">';
    $('stkUrl').value='';
  };
  fr.readAsDataURL(file);
  e.target.value='';
};
$('stkUrl').addEventListener('input',function(){
  if(this.value.trim()){
    stkTempUrl=this.value.trim();
    $('stkPreview').innerHTML='<img src="'+stkTempUrl+'" onerror="this.parentNode.innerHTML=\'预览失败\'">';
  }else{
    stkTempUrl='';$('stkPreview').innerHTML='';
  }
});
$('btnStkAdd').onclick=async function(){
  var name=$('stkName').value.trim();
  var desc=$('stkDesc').value.trim();
  var url=$('stkUrl').value.trim()||stkTempUrl;
  var cat=$('stkCat').value;
  if(!name){toast('名字不能为空');return;}
  if(!url){toast('请粘贴图床URL或选择本地图片');return;}
  if(stickers.find(function(s){return s.name===name;})){toast('名字重复了');return;}
  var item={id:uid(),name:name,desc:desc,url:url,cat:cat};
  stickers.push(item);
  await stkSave(item);
  $('stkName').value='';$('stkDesc').value='';$('stkUrl').value='';
  stkTempUrl='';$('stkPreview').innerHTML='';
  renderStkMgr();
  toast('已添加「'+name+'」');
};
function renderStkMgr(){
  var box=$('stkMgrList');box.innerHTML='';
  if(!stickers.length){box.innerHTML='<div class="tb-empty">还没有表情包</div>';return;}
  var order={'卖萌撒娇':0,'抽象恶搞':1,'其他':2};
  var sorted=stickers.slice().sort(function(a,b){return (order[a.cat]||2)-(order[b.cat]||2);});
  sorted.forEach(function(s){
    var card=document.createElement('div');card.className='stk-mgr-card';
    var img=document.createElement('img');img.src=s.url;
    var info=document.createElement('div');info.className='stk-mgr-info';
    var nm=document.createElement('div');nm.className='stk-mgr-name';nm.textContent=s.name;
    var ds=document.createElement('div');ds.className='stk-mgr-desc';ds.textContent=s.desc||'(无描述)';
    var ct=document.createElement('div');ct.className='stk-mgr-cat';ct.textContent=s.cat||'其他';
    info.appendChild(nm);info.appendChild(ds);info.appendChild(ct);
    var del=document.createElement('button');del.className='stk-mgr-del';del.textContent='×';
    del.onclick=async function(){
      stickers=stickers.filter(function(x){return x.id!==s.id;});
      await stkDel(s.id);renderStkMgr();toast('已删除「'+s.name+'」');
    };
    card.appendChild(img);card.appendChild(info);card.appendChild(del);
    box.appendChild(card);
  });
}
/* 打开工具栏表情页时刷新管理列表 */
var origShowTool=showTool;
showTool=function(name){
  origShowTool(name);
  if(name==='emoji')renderStkMgr();
};

/* ══════════ 底部Tab切换 ══════════ */
document.querySelectorAll('.bottom-tabs button').forEach(function(btn){
  btn.onclick=function(){
    document.querySelectorAll('.bottom-tabs button').forEach(function(b){b.classList.remove('active');});
    document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
    btn.classList.add('active');
    document.getElementById('page-'+btn.dataset.page).classList.add('active');
  };
});

/* ══════════ 角色管理 ══════════ */
var editingCharId=null;

async function renderCharList(){
  var list=await charGetAll();
  var el=document.getElementById('charList');
  if(!list.length){el.innerHTML='<div class="char-empty">还没有角色，点下面＋ 创建一个吧</div>';return;}
  el.innerHTML='';
  list.sort(function(a,b){return(b.updatedAt||0)-(a.updatedAt||0);});
  list.forEach(function(ch){
    var card=document.createElement('div');
    card.className='char-card';
    card.innerHTML='<div class="char-avatar">'+(ch.avatar||'🎭')+'</div>'+'<div class="char-info"><h3>'+ch.name+'</h3>'
      +'<p>'+(ch.description||ch.system||'（无人设）').slice(0,80)+'</p></div>';
    card.onclick=function(){openCharEditor(ch);};
    el.appendChild(card);
  });
}

function openCharEditor(ch){
  editingCharId=ch?ch.id:null;
  document.getElementById('charEditorTitle').textContent=ch?'编辑角色':'新建角色';
  document.getElementById('charName').value=ch?ch.name:'';
  document.getElementById('charAvatar').value=ch?ch.avatar||'🎭':'🎭';
  document.getElementById('charSystem').value=ch?ch.description||ch.system||'':'';
  document.getElementById('btnCharDel').style.display=ch?'':'none';
  document.getElementById('maskChar').style.display='block';
  var gList=[];
  if(ch){
    if(ch.first_mes)gList.push(ch.first_mes);
    if(ch.alternate_greetings)gList=gList.concat(ch.alternate_greetings);
    if(!gList.length&&ch.greetings)gList=ch.greetings;
  }
  renderGreetings(gList);
  document.getElementById('charEditor').classList.add('open');
}

function closeCharEditor(){
  document.getElementById('maskChar').style.display='none';
  document.getElementById('charEditor').classList.remove('open');
  editingCharId=null;
}

document.getElementById('btnNewChar').onclick=function(){openCharEditor(null);};
document.getElementById('maskChar').onclick=closeCharEditor;
document.getElementById('btnCharCancel').onclick=closeCharEditor;
document.getElementById('btnCharSave').onclick=async function(){
  var name=document.getElementById('charName').value.trim();
  if(!name){toast('名字不能为空');return;}
  var gs=collectGreetings();
  var item={
    id:editingCharId||uid(),
    name:name,
    avatar:document.getElementById('charAvatar').value.trim()||'🎭',
    description:document.getElementById('charSystem').value.trim(),
    first_mes:gs[0]||'',
    alternate_greetings:gs.slice(1),
    updatedAt:Date.now()
  };
  if(!editingCharId)item.createdAt=Date.now();
  await charSave(item);
  closeCharEditor();
  await renderCharList();
  toast('角色已保存');
};

document.getElementById('btnCharDel').onclick=async function(){
  if(!editingCharId)return;
  if(!confirm('确定删除这个角色？'))return;
  await charDel(editingCharId);
  closeCharEditor();
  await renderCharList();
  toast('角色已删除');
};

function renderGreetings(list){
  var el=document.getElementById('charGreetings');
  el.innerHTML='';
  if(!list.length)list=[''];
  list.forEach(function(text,i){
    var row=document.createElement('div');
    row.className='greeting-item';
    var ta=document.createElement('textarea');
    ta.value=text;
    ta.placeholder='开场白 #'+(i+1)+'（角色的第一句话）';
    ta.rows=3;
    var del=document.createElement('button');
    del.className='greeting-del';
    del.textContent='✕';
    del.onclick=function(){
      row.remove();
      var items=document.querySelectorAll('#charGreetings .greeting-item');
      if(!items.length)renderGreetings(['']);
    };
    row.appendChild(ta);
    row.appendChild(del);
    el.appendChild(row);
  });
}

function collectGreetings(){
  var result=[];
  document.querySelectorAll('#charGreetings .greeting-item textarea').forEach(function(ta){
    var v=ta.value.trim();
    if(v)result.push(v);
  });
  return result;
}

document.getElementById('btnAddGreeting').onclick=function(){
  var el=document.getElementById('charGreetings');
  var count=el.querySelectorAll('.greeting-item').length;
  var row=document.createElement('div');
  row.className='greeting-item';
  var ta=document.createElement('textarea');
  ta.placeholder='开场白 #'+(count+1)+'（角色的第一句话）';
  ta.rows=3;
  var del=document.createElement('button');
  del.className='greeting-del';
  del.textContent='✕';
  del.onclick=function(){
    row.remove();
    var items=document.querySelectorAll('#charGreetings .greeting-item');
    if(!items.length)renderGreetings(['']);
  };
  row.appendChild(ta);
  row.appendChild(del);
  el.appendChild(row);
};

/*══ tavo角色卡导入 ══ */
document.getElementById('btnImportChar').onclick=function(){
  document.getElementById('charImportFile').click();
};

document.getElementById('charImportFile').onchange=async function(e){
  var file=e.target.files[0];
  if(!file)return;
  try{
    var text=await file.text();
    var json=JSON.parse(text);
    var d=json.data||json;
    var name=d.name||file.name.replace('.json','');
    var gs=[];
    if(d.first_mes)gs.push(d.first_mes);
    if(d.alternate_greetings&&Array.isArray(d.alternate_greetings)){
      d.alternate_greetings.forEach(function(g){if(g)gs.push(g);});
    }
    var item={
      id:uid(),
      name:name,
      avatar:'🎭',
      description:d.description||d.system||'',
      first_mes:gs[0]||'',
      alternate_greetings:gs.slice(1),
      updatedAt:Date.now()
    };
    await charSave(item);
    await renderCharList();
    toast('角色「'+name+'」导入成功');
  }catch(err){
    toast('导入失败：'+err.message);
  }
  e.target.value='';
};

/* ══════════ 用户人设管理 ══════════ */
var editingPersonaId=null;

async function renderPersonaList(){
  var list=await personaGetAll();
  var el=document.getElementById('personaList');
  if(!list.length){el.innerHTML='<div class="char-empty">还没有人设，点下面＋ 创建一个吧</div>';return;}
  el.innerHTML='';
  list.sort(function(a,b){return(b.updatedAt||0)-(a.updatedAt||0);});
  list.forEach(function(p){
    var card=document.createElement('div');
    card.className='char-card';
    var displayName=p.label?p.label+'<span style="font-size:11px;color:var(--sub);margin-left:6px;">→ '+p.name+'</span>':p.name;
    card.innerHTML='<div class="char-avatar">'+(p.avatar||'👤')+'</div><div class="char-info"><h3>'+displayName+'</h3>'+'<p>'+(p.content||'(无内容)').slice(0,80)+'</p></div>';
    card.onclick=function(){openPersonaEditor(p);};
    el.appendChild(card);
  });
}

function openPersonaEditor(p){
  editingPersonaId=p?p.id:null;
  document.getElementById('personaEditorTitle').textContent=p?'编辑人设':'新建人设';
  document.getElementById('personaName').value=p?p.name:'';
  document.getElementById('personaLabel').value=p?p.label||'':'';
  document.getElementById('personaAvatar').value=p?p.avatar||'👤':'👤';
  document.getElementById('personaContent').value=p?p.content||'':'';
  document.getElementById('btnPersonaDel').style.display=p?'':'none';
  document.getElementById('maskPersona').style.display='block';
  document.getElementById('personaEditor').classList.add('open');
}

function closePersonaEditor(){
  document.getElementById('maskPersona').style.display='none';
  document.getElementById('personaEditor').classList.remove('open');
  editingPersonaId=null;
}

document.getElementById('btnNewPersona').onclick=function(){openPersonaEditor(null);};
document.getElementById('maskPersona').onclick=closePersonaEditor;
document.getElementById('btnPersonaCancel').onclick=closePersonaEditor;

document.getElementById('btnPersonaSave').onclick=async function(){
  var name=document.getElementById('personaName').value.trim();
  if(!name){toast('角色名称不能为空');return;}
  var item={
    id:editingPersonaId||uid(),
    name:name,
    label:document.getElementById('personaLabel').value.trim(),
    avatar:document.getElementById('personaAvatar').value.trim()||'👤',
    content:document.getElementById('personaContent').value.trim(),
    updatedAt:Date.now()
  };
  if(!editingPersonaId)item.createdAt=Date.now();
  await personaSave(item);
  closePersonaEditor();
  await renderPersonaList();
  toast('人设已保存');
};

document.getElementById('btnPersonaDel').onclick=async function(){
  if(!editingPersonaId)return;
  if(!confirm('确定删除这套人设？'))return;
  await personaDel(editingPersonaId);
  closePersonaEditor();
  await renderPersonaList();
  toast('人设已删除');
};

/* ══════════ 角色聊天列表 ══════════ */

async function renderRpList(){
  var convs=await rpConvGetAll();
  var chars=await charGetAll();
  var el=document.getElementById('rpList');
  if(!convs.length&&!chars.length){
    el.innerHTML='<div class="rp-empty">还没有角色对话<br>先去角色管理创建角色吧</div>';
    return;
  }
  if(!convs.length){
    el.innerHTML='<div class="rp-empty">还没有对话，点下面＋ 开始吧</div>';
    return;
  }
  el.innerHTML='';
  var groups={};
  convs.sort(function(a,b){return(b.updatedAt||0)-(a.updatedAt||0);});
  convs.forEach(function(c){
    var cid=c.charId||'_none';
    if(!groups[cid])groups[cid]=[];
    groups[cid].push(c);
  });
  chars.forEach(function(ch){
    if(!groups[ch.id])return;
    var group=document.createElement('div');
    group.className='rp-group open';
    var header=document.createElement('div');
    header.className='rp-group-header';
    header.innerHTML='<span class="rp-group-arrow">▶</span>'+'<span>'+(ch.avatar||'🎭')+'</span>'
      +'<span>'+ch.name+'</span>'
      +'<span style="font-size:11px;color:var(--sub);font-weight:400;">'+groups[ch.id].length+'个对话</span>';
    header.onclick=function(){group.classList.toggle('open');};
    var body=document.createElement('div');
    body.className='rp-group-body';
    groups[ch.id].forEach(function(c){
      var card=document.createElement('div');
      card.className='rp-conv-card';
      card.innerHTML='<div class="rp-conv-info"><h4>'+(c.name||'未命名对话')+'</h4>'
        +'<p>'+(c.lastMsg||'还没有消息')+'</p></div>'
        +'<span class="rp-conv-time">'+(c.updatedAt?fmtTime(c.updatedAt):'')+'</span>';
      card.onclick=function(){openRpChat(c.id);};
      body.appendChild(card);
    });
    group.appendChild(header);
    group.appendChild(body);
    el.appendChild(group);
    delete groups[ch.id];
  });
}

document.getElementById('btnNewRp').onclick=async function(){
  var chars=await charGetAll();
  var personas=await personaGetAll();
  var sel=document.getElementById('rpSelChar');
  sel.innerHTML='';
  if(!chars.length){toast('请先去角色管理创建角色');return;}
  chars.forEach(function(ch){
    var opt=document.createElement('option');
    opt.value=ch.id;opt.textContent=(ch.avatar||'🎭')+' '+ch.name;
    sel.appendChild(opt);
  });
  var pSel=document.getElementById('rpSelPersona');
  pSel.innerHTML='<option value="">(不使用人设)</option>';
  personas.forEach(function(p){
    var opt=document.createElement('option');
    opt.value=p.id;opt.textContent=(p.avatar||'👤')+' '+(p.label||p.name);
    pSel.appendChild(opt);
  });
  sel.onchange=function(){updateGreetingSelect(chars);};
  updateGreetingSelect(chars);document.getElementById('rpConvName').value='';
  document.getElementById('maskNewRp').style.display='block';
  document.getElementById('newRpPanel').classList.add('open');
};

function updateGreetingSelect(chars){
  var charId=document.getElementById('rpSelChar').value;
  var ch=chars.find(function(c){return c.id===charId;});
  var field=document.getElementById('rpGreetingField');
  var gSel=document.getElementById('rpSelGreeting');
  var gList=[];
  if(ch){
    if(ch.first_mes)gList.push(ch.first_mes);
    if(ch.alternate_greetings)gList=gList.concat(ch.alternate_greetings);
    if(!gList.length&&ch.greetings)gList=ch.greetings;}
  if(gList.length){
    field.style.display='';
    gSel.innerHTML='<option value="-1">(不使用开场白)</option>';
    gList.forEach(function(g,i){
      var opt=document.createElement('option');
      opt.value=i;opt.textContent='#'+(i+1)+'：'+g.slice(0,30)+(g.length>30?'…':'');
      gSel.appendChild(opt);
    });
  }else{
    field.style.display='none';
    gSel.innerHTML='';
  }
}

function closeNewRpPanel(){
  document.getElementById('maskNewRp').style.display='none';
  document.getElementById('newRpPanel').classList.remove('open');
}

document.getElementById('maskNewRp').onclick=closeNewRpPanel;
document.getElementById('btnNewRpCancel').onclick=closeNewRpPanel;

document.getElementById('btnNewRpCreate').onclick=async function(){
  var charId=document.getElementById('rpSelChar').value;
  var personaId=document.getElementById('rpSelPersona').value||null;
  var chars=await charGetAll();
  var ch=chars.find(function(c){return c.id===charId;});
  if(!ch){toast('请选择角色');return;}
  var p=null;
  if(personaId){
    var personas=await personaGetAll();
    p=personas.find(function(x){return x.id===personaId;});
  }
  var greetIdx=parseInt(document.getElementById('rpSelGreeting').value);
  var gList=[];
  if(ch.first_mes)gList.push(ch.first_mes);
  if(ch.alternate_greetings)gList=gList.concat(ch.alternate_greetings);
  if(!gList.length&&ch.greetings)gList=ch.greetings;
  var greeting=(greetIdx>=0&&gList[greetIdx])?gList[greetIdx]:null;
  var convName=document.getElementById('rpConvName').value.trim()||ch.name+' 对话';
  var conv={
    id:uid(),
    charId:charId,
    personaId:personaId,
    name:convName,
    charName:ch.name,
    charAvatar:ch.avatar||'🎭',
    userName:p?p.name:'用户',
    userAvatar:p?(p.avatar||'👤'):'👤',
    scenario:'',
    channelId:'',
    model:'',
    ctx:20,
    temp:0.8,
    topP:0.95,
    stream:true,
    lastMsg:greeting?greeting.slice(0,50):'',
    createdAt:Date.now(),
    updatedAt:Date.now()
  };
  await rpConvSave(conv);
  if(greeting){
    await msgsSet(conv.id,[{role:'assistant',content:greeting,ts:Date.now()}]);
  }
  closeNewRpPanel();
  await renderRpList();
  toast('对话已创建');
};

/* ══════════RP聊天窗口 ══════════ */
var activeRpConvId=null;
var rpMsgs=[];

async function openRpChat(convId){
  activeRpConvId=convId;
  var convs=await rpConvGetAll();
  var conv=convs.find(function(c){return c.id===convId;});
  if(!conv){toast('对话不存在');return;}
  document.getElementById('rpChatTitle').textContent=conv.name||'对话';
  rpMsgs=await msgsGet(convId);
  document.getElementById('rpInput').style.height='auto';
  renderRpMessages(conv);
  document.querySelector('#page-rp > .topbar').style.display='none';
  document.querySelector('#page-rp > .rp-list').style.display='none';
  document.querySelector('#page-rp > .char-add-bar').style.display='none';
  document.querySelector('.bottom-tabs').style.display='none';
  rpMode=true;
  document.getElementById('rpChatView').classList.add('open');
}

function closeRpChat(){
  document.getElementById('rpChatView').classList.remove('open');
  document.querySelector('#page-rp > .topbar').style.display='';
  document.querySelector('#page-rp > .rp-list').style.display='';
  document.querySelector('#page-rp > .char-add-bar').style.display='';
  document.querySelector('.bottom-tabs').style.display='';
  rpMode=false;
  activeRpConvId=null;
  rpMsgs=[];
  renderRpList();
}

document.getElementById('rpBack').onclick=closeRpChat;

function renderRpMessages(conv){
  var el=document.getElementById('rpMessages');
  el.innerHTML='';
  if(!rpMsgs.length){
    el.innerHTML='<div class="rp-empty">发送第一条消息开始对话</div>';
    return;
  }
  rpMsgs.forEach(function(m,i){
    var wrap=document.createElement('div');
    wrap.className='msg-wrap '+(m.role==='user'?'user':'ai');
    if(m.role==='assistant'){
      if(conv.charName){
        var tag=document.createElement('div');
        tag.className='model-tag';
        tag.textContent=(conv.charAvatar||'🎭')+' '+conv.charName;
        wrap.appendChild(tag);
      }
      if(m.reasoning){
        var det=document.createElement('details');det.className='think';
        det.innerHTML='<summary>💭 思考过程 ('+m.reasoning.length+'字)</summary>';
        var tbody=document.createElement('div');tbody.className='tbody';
        tbody.textContent=m.reasoning;
        det.appendChild(tbody);wrap.appendChild(det);
      }
      var row=document.createElement('div');
      row.className='msg ai';
      var txt=document.createElement('span');txt.className='txt';
      txt.innerHTML=renderMd(m.content||'');
      row.appendChild(txt);
      row.onclick=function(){if(streaming)return;wrap.classList.toggle('show-actions');};
      wrap.appendChild(row);
    }else{
      var row=document.createElement('div');
      row.className='msg user';
      var uTag=document.createElement('div');
      uTag.className='model-tag';
      uTag.style.textAlign='right';
      uTag.textContent=(conv.userAvatar||'👤')+' '+(conv.userName||'用户');
      wrap.appendChild(uTag);
      var b=document.createElement('div');b.className='bubble';
      if(m.images&&m.images.length){
        m.images.forEach(function(src){
          var img=document.createElement('img');img.className='att';img.src=src;
          b.appendChild(img);
        });
      }
      var txt=document.createElement('span');txt.className='txt';
      txt.innerHTML=renderMd(m.content||'');
      b.appendChild(txt);
      b.onclick=function(){if(streaming)return;wrap.classList.toggle('show-actions');};
      row.appendChild(b);wrap.appendChild(row);
    }
    var act=document.createElement('div');act.className='actions';
    var bc=document.createElement('button');bc.textContent='📋 复制';
    bc.onclick=function(){
      var t=m.content||'';
      if(navigator.clipboard){navigator.clipboard.writeText(t).then(function(){toast('已复制 ✓');}).catch(function(){toast('复制失败');});}
      else{var ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);toast('已复制 ✓');}
    };
    act.appendChild(bc);
    var be=document.createElement('button');be.textContent='✏️ 编辑';
    (function(idx){
      be.onclick=function(){
        if(streaming)return;
        rpStartEdit(idx,conv);
      };
    })(i);
    act.appendChild(be);
    if(m.role==='assistant'){
      var br=document.createElement('button');br.textContent='🔄 重说';
      (function(idx){
        br.onclick=async function(){
          if(streaming)return;
          rpMsgs[idx].content='';rpMsgs[idx].reasoning='';
          rpMsgs[idx].meta=null;rpMsgs[idx].ts=Date.now();
          await msgsSet(conv.id,rpMsgs);renderRpMessages(conv);
          await rpRunGeneration(idx,conv);
        };
      })(i);
      act.appendChild(br);
    }
    var bk=document.createElement('button');bk.textContent='↩️ 回溯';
    (function(idx){
      bk.onclick=async function(){
        if(streaming)return;
        var after=rpMsgs.length-idx-1;
        if(after<=0){toast('后面没有消息了');return;}
        if(!confirm('删除这条之后的 '+after+' 条消息？'))return;
        rpMsgs.splice(idx+1);
        await msgsSet(conv.id,rpMsgs);
        conv.lastMsg=(rpMsgs[rpMsgs.length-1]&&rpMsgs[rpMsgs.length-1].content||'').slice(0,50);
        conv.updatedAt=Date.now();
        await rpConvSave(conv);
        renderRpMessages(conv);
        toast('已回溯 ✓');
      };
    })(i);
    act.appendChild(bk);
    var bd=document.createElement('button');bd.className='warn';bd.textContent='🗑 删除';
    (function(idx){
      bd.onclick=async function(){
        if(streaming)return;
        rpMsgs.splice(idx,1);
        await msgsSet(conv.id,rpMsgs);
        renderRpMessages(conv);
        toast('已删除');
      };
    })(i);
    act.appendChild(bd);
    wrap.appendChild(act);
    var meta=document.createElement('div');meta.className='meta-line';
    var parts=[fmtTime(m.ts)];
    if(m.role==='assistant'&&m.meta){
      var pre=m.meta.est?'~':'';
      parts.push('↑'+pre+(m.meta.inTok||0)+' tok','↓'+pre+(m.meta.outTok||0)+' tok',((m.meta.ms||0)/1000).toFixed(1)+'s');
    }
    meta.textContent=parts.filter(Boolean).join(' · ');
    wrap.appendChild(meta);
    el.appendChild(wrap);
  });el.scrollTop=el.scrollHeight;
}

document.getElementById('rpInput').oninput=function(){
  this.style.height='auto';
  this.style.height=Math.min(this.scrollHeight,110)+'px';
};

function rpStartEdit(idx,conv){
  var el=document.getElementById('rpMessages');
  var wraps=el.querySelectorAll('.msg-wrap');
  var wrap=wraps[idx];if(!wrap)return;
  wrap.innerHTML='';
  var box=document.createElement('div');box.className='edit-box';
  var ta=document.createElement('textarea');
  ta.value=rpMsgs[idx].content||'';
  ta.style.minHeight='80px';
  ta.style.maxHeight='50vh';
  setTimeout(function(){
    ta.style.height='auto';
    ta.style.height=Math.min(ta.scrollHeight,window.innerHeight*0.5)+'px';
  },10);
  ta.addEventListener('input',function(){
    ta.style.height='auto';
    ta.style.height=Math.min(ta.scrollHeight,window.innerHeight*0.5)+'px';
  });
  var btns=document.createElement('div');btns.className='edit-btns';
  var cancel=document.createElement('button');cancel.className='edit-cancel';
  cancel.textContent='取消';
  cancel.onclick=function(){renderRpMessages(conv);};
  var save=document.createElement('button');save.className='edit-save';
  save.textContent='保存';
  save.onclick=async function(){
    rpMsgs[idx].content=ta.value;
    await msgsSet(conv.id,rpMsgs);
    renderRpMessages(conv);
    toast('已保存 ✓');
  };
  btns.appendChild(cancel);btns.appendChild(save);
  if(rpMsgs[idx].role==='user'){
    var resend=document.createElement('button');resend.className='edit-save';
    resend.textContent='保存并重新生成';
    resend.onclick=async function(){
    if(streaming)return;
    rpMsgs[idx].content=ta.value;rpMsgs[idx].ts=Date.now();
    rpMsgs.splice(idx+1);
    rpMsgs.push({role:'assistant',content:'',reasoning:'',ts:Date.now()});
    await msgsSet(conv.id,rpMsgs);
    renderRpMessages(conv);
    await rpRunGeneration(rpMsgs.length-1,conv);
  };
    btns.appendChild(resend);
  }
  box.appendChild(ta);box.appendChild(btns);wrap.appendChild(box);
  setTimeout(function(){ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);},50);
}

/* ══════════ RP发消息核心 ══════════ */

async function buildRpPayload(conv,upToIndex){
  var sys='';
  var chars=await charGetAll();
  var ch=chars.find(function(c){return c.id===conv.charId;});
  var charName=ch?ch.name:'角色';
  var charDesc=ch?(ch.description||ch.system||''):'';
  var userName='用户';
  var personaContent='';
  if(conv.personaId){
    var personas=await personaGetAll();
    var p=personas.find(function(x){return x.id===conv.personaId;});
    if(p){
      userName=p.name||'用户';
      personaContent=p.content||'';
    }
  }
  sys+='请使用中文进行思考。\n\n';
  sys+='1. 请静下心来代入角色思考，你作为'+charName+'是个什么样的存在？TA的人际关系网和人生轨迹是什么样的？TA会如何与人相处交流？\n';
  sys+='2. 你作为'+charName+'与'+userName+'目前是什么关系？感情需要培养，不必太过心急，你在乎的是快速推到下一个剧情点还是'+userName+'感受？\n';
  sys+='3. 与'+charName+'有关的人现在在做什么？你还记得TA们吗？TA们会怎么与'+charName+'和'+userName+'互动交流？\n';
  sys+='4. 哪些是你作为'+charName+'可以知道的并自然提起的？哪些是属于'+userName+'自己你不应该知道并提及的？自然交流中认知边界非常重要，并非所有事你都必须知道\n';
  sys+='5. 以'+charName+'的身份自然地回应'+userName+'，用行动和对话推进，不要复述'+userName+'说过的内容';if(charDesc){
    sys+='\n\n【关于你——'+charName+'】\n'+charDesc;
  }
  if(personaContent){
    sys+='\n\n【关于对方——'+userName+'】\n'+personaContent;
  }
  if(conv.scenario){
    sys+='\n\n【当前情景】\n'+conv.scenario;
  }
  if(stickers.length){
    var cats={};
    stickers.forEach(function(s){
      var c=s.cat||'其他';
      if(!cats[c])cats[c]=[];
      cats[c].push(s.name+(s.desc?'('+s.desc+')':''));
    });
    var stkText='\n\n【表情包】当且仅当'+charName+'在剧情中正在使用手机、电脑等通讯工具发送消息时，可以从以下表情包中选择合适的使用，其他场景下不要使用。用[表情:名字]+换行符发送。';
    Object.keys(cats).forEach(function(cat){
      stkText+='\n['+cat+'] 可用：'+cats[cat].join('|');
    });
    sys+=stkText;
  }
  var out=[];
  if(sys)out.push({role:'system',content:sys});
  var hist=rpMsgs.slice(0,upToIndex);
  var slice=conv.ctx>0?hist.slice(-conv.ctx):hist.slice(-1);
  slice.forEach(function(m){
    if(m.images&&m.images.length){
      var parts=[];
      if(m.content)parts.push({type:'text',text:m.content});
      m.images.forEach(function(src){parts.push({type:'image_url',image_url:{url:src}});});
      out.push({role:m.role,content:parts});
    }else{
      out.push({role:m.role,content:m.content||''});
    }
  });
  return out;
}

function rpUpdateMsgDom(i,conv){
  var el=document.getElementById('rpMessages');
  var wraps=el.querySelectorAll('.msg-wrap');
  var wrap=wraps[i];if(!wrap)return;
  var m=rpMsgs[i];
  var det=wrap.querySelector('details.think');
  if(m.reasoning&&!det){
    det=document.createElement('details');det.className='think';det.open=true;
    det.innerHTML='<summary>💭 思考中</summary><div class="tbody"></div>';
    var msgDiv=wrap.querySelector('.msg');
    if(msgDiv)wrap.insertBefore(det,msgDiv);}
  if(det&&m.reasoning){
    det.querySelector('.tbody').textContent=m.reasoning;
    det.querySelector('summary').textContent=m.content?'💭 思考过程 ('+m.reasoning.length+'字)':'💭 思考中';
    if(m.content)det.open=false;
  }
  var txt=wrap.querySelector('.msg .txt');
  if(txt)txt.innerHTML=renderMd(m.content||'');
  el.scrollTop=el.scrollHeight;
}

async function rpRunGeneration(i,conv){
  var channel=getChannel(conv.channelId);
  var aiMsg=rpMsgs[i];
  if(!channel||!channel.url||!channel.key){
    aiMsg.content='❌ 渠道配置缺失，请到对话设置里选择渠道和模型';
    await msgsSet(conv.id,rpMsgs);renderRpMessages(conv);return;
  }
  if(!conv.model){
    aiMsg.content='❌ 未选择模型，请到对话设置里填写模型名';
    await msgsSet(conv.id,rpMsgs);renderRpMessages(conv);return;
  }
  streaming=true;
  var rpSendBtn=document.getElementById('rpBtnSend');
  rpSendBtn.textContent='■';rpSendBtn.classList.add('stop');
  var t0=Date.now();var usage=null;
  var payload=await buildRpPayload(conv,i);
  var baseContent=aiMsg.content||'',baseReasoning=aiMsg.reasoning||'';
  var maxAttempts=2;
  var attempt=0,lastErr=null,aborted=false;
  var useStream=conv.stream!==false;
  while(attempt<maxAttempts){
    attempt++;
    aiMsg.content=baseContent;aiMsg.reasoning=baseReasoning;
    lastErr=null;aborter=new AbortController();
    try{
      var bodyObj={
        model:conv.model,messages:payload,
        temperature:conv.temp||0.8,top_p:conv.topP||0.95,
        stream:useStream
      };
      if(useStream)bodyObj.stream_options={include_usage:true};
      var res=await fetch(channel.url.replace(/\/+$/,'')+'/chat/completions',{
        method:'POST',signal:aborter.signal,
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+channel.key},
        body:JSON.stringify(bodyObj)
      });
      if(!res.ok){
        var errText=await res.text().catch(function(){return '';});
        throw new Error('HTTP '+res.status+' '+errText.slice(0,200));
      }
      if(!useStream){
        var json=await res.json();
        if(json.usage)usage=json.usage;
        var choice=json.choices&&json.choices[0];
        if(choice&&choice.message){
          aiMsg.content=choice.message.content||'';
          aiMsg.reasoning=choice.message.reasoning_content||choice.message.reasoning||'';
        }
        break;
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
              rpUpdateMsgDom(i,conv);
            }
          }catch(e){}
        }
      }
      break;
    }catch(e){
      if(e.name==='AbortError'){
        aiMsg.content+='\n[已手动停止]';aborted=true;break;
      }
      lastErr=e;
      try{
        window.__xwDebug=window.__xwDebug||[];
        window.__xwDebug.push('['+new Date().toLocaleTimeString()+'] RP第'+attempt+'次 '+(Date.now()-t0)+'ms后断 | '+(e.name||'?')+': '+(e.message||e));
      }catch(_){}
      if(attempt<maxAttempts){
        aiMsg.content=baseContent+'⚠ 连接中断，正在自动重试…';
        rpUpdateMsgDom(i,conv);
        await new Promise(function(r){setTimeout(r,800);});
      }
    }
  }
  if(lastErr&&!aborted){
    var partial=aiMsg.content&&aiMsg.content!==baseContent+'⚠ 连接中断，正在自动重试…'?aiMsg.content:baseContent;
    var errInfo='['+(lastErr.name||'Error')+'] '+(lastErr.message||lastErr);
    aiMsg.content=(partial&&partial.trim()?partial+'\n\n':'')+'❌ 已重试'+(maxAttempts-1)+'次仍失败：'+errInfo+'\n（可点"重说"再试）';
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
  conv.lastMsg=(aiMsg.content||'').slice(0,50);
  conv.updatedAt=Date.now();
  await rpConvSave(conv);
  streaming=false;aborter=null;
  rpSendBtn.textContent='➤';rpSendBtn.classList.remove('stop');
  await msgsSet(conv.id,rpMsgs);renderRpMessages(conv);
}

async function rpSend(){
  if(streaming){if(aborter)aborter.abort();return;}
  if(!activeRpConvId)return;
  var convs=await rpConvGetAll();
  var conv=convs.find(function(c){return c.id===activeRpConvId;});
  if(!conv){toast('对话不存在');return;}
  var rpInputEl=document.getElementById('rpInput');
  var text=rpInputEl.value.trim();
  if(!text)return;
  if(!conv.channelId||!conv.model){toast('请先到⚙️设置里选择渠道和模型');return;}
  var userMsg={role:'user',content:text,images:[],files:[],ts:Date.now()};pendingAtt.forEach(function(a){
    if(a.type==='image')userMsg.images.push(a.data);
    else userMsg.files.push({name:a.name,text:a.text});
  });
  pendingAtt=[];
  rpMsgs.push(userMsg);
  rpInputEl.value='';
  await msgsSet(conv.id,rpMsgs);renderRpMessages(conv);
  rpMsgs.push({role:'assistant',content:'',reasoning:'',ts:Date.now()});
  await msgsSet(conv.id,rpMsgs);renderRpMessages(conv);
  await rpRunGeneration(rpMsgs.length-1,conv);
}

document.getElementById('rpBtnSend').onclick=rpSend;

/* RP设置面板 */
document.getElementById('rpChatSettings').onclick=async function(){
  if(!activeRpConvId)return;
  var convs=await rpConvGetAll();
  var conv=convs.find(function(c){return c.id===activeRpConvId;});
  if(!conv)return;
  var chSel=document.getElementById('rpSetChannel');
  chSel.innerHTML='<option value="">(未选择)</option>';
  channels.forEach(function(ch){
    var opt=document.createElement('option');
    opt.value=ch.id;opt.textContent=ch.name;
    if(ch.id===conv.channelId)opt.selected=true;
    chSel.appendChild(opt);
  });
  chSel.onchange=async function(){
    var chId=this.value;
    var ch=getChannel(chId);
    var dl=document.getElementById('rpModelList');
    dl.innerHTML='';
    if(!ch||!ch.url||!ch.key)return;
    try{
      var res=await fetch(ch.url.replace(/\/+$/,'')+'/models',{
        headers:{'Authorization':'Bearer '+ch.key}
      });
      if(!res.ok)return;
      var j=await res.json();
      var ids=(j.data||[]).map(function(m){return m.id;}).filter(Boolean).sort();
      ids.forEach(function(id){
        var opt=document.createElement('option');opt.value=id;dl.appendChild(opt);
      });
    }catch(e){}
  };
  document.getElementById('rpSetConvName').value=conv.name||'';
  document.getElementById('rpSetModel').value=conv.model||'';
  document.getElementById('rpSetScenario').value=conv.scenario||'';
  document.getElementById('rpSetCtx').value=conv.ctx||20;
  document.getElementById('rpCtxVal').textContent=conv.ctx||20;
  document.getElementById('rpSetTemp').value=conv.temp||0.8;
  document.getElementById('rpTempVal').textContent=conv.temp||0.8;
  document.getElementById('rpSetTopP').value=conv.topP||0.95;
  document.getElementById('rpTopPVal').textContent=conv.topP||0.95;
  document.getElementById('rpStreamOn').classList.toggle('active',conv.stream!==false);
  document.getElementById('rpStreamOff').classList.toggle('active',conv.stream===false);
  document.getElementById('maskRpSettings').style.display='block';
  document.getElementById('rpSettingsPanel').classList.add('open');
  if(conv.channelId)chSel.onchange();
};

document.getElementById('rpSetCtx').oninput=function(){document.getElementById('rpCtxVal').textContent=this.value;};
document.getElementById('rpSetTemp').oninput=function(){document.getElementById('rpTempVal').textContent=this.value;};
document.getElementById('rpSetTopP').oninput=function(){document.getElementById('rpTopPVal').textContent=this.value;};

document.getElementById('rpStreamOn').onclick=function(){
  this.classList.add('active');document.getElementById('rpStreamOff').classList.remove('active');
};
document.getElementById('rpStreamOff').onclick=function(){
  this.classList.add('active');document.getElementById('rpStreamOn').classList.remove('active');
};

document.getElementById('maskRpSettings').onclick=function(){
  document.getElementById('maskRpSettings').style.display='none';
  document.getElementById('rpSettingsPanel').classList.remove('open');
};

document.getElementById('btnRpSaveSettings').onclick=async function(){
  if(!activeRpConvId)return;
  var convs=await rpConvGetAll();
  var conv=convs.find(function(c){return c.id===activeRpConvId;});
  if(!conv)return;
  conv.name=document.getElementById('rpSetConvName').value.trim()||conv.name;
  conv.channelId=document.getElementById('rpSetChannel').value;
  conv.model=document.getElementById('rpSetModel').value.trim();
  conv.scenario=document.getElementById('rpSetScenario').value.trim();
  conv.ctx=parseInt(document.getElementById('rpSetCtx').value);
  conv.temp=parseFloat(document.getElementById('rpSetTemp').value);
  conv.topP=parseFloat(document.getElementById('rpSetTopP').value);
  conv.stream=document.getElementById('rpStreamOn').classList.contains('active');
  await rpConvSave(conv);
  document.getElementById('maskRpSettings').style.display='none';
  document.getElementById('rpSettingsPanel').classList.remove('open');
  document.getElementById('rpChatTitle').textContent=conv.name;
  toast('设置已保存');
};

document.getElementById('btnRpDelConv').onclick=async function(){
  if(!activeRpConvId)return;
  if(!confirm('确定删除这个对话？'))return;
  await rpConvDel(activeRpConvId);
  await msgsDel(activeRpConvId);
  document.getElementById('maskRpSettings').style.display='none';
  document.getElementById('rpSettingsPanel').classList.remove('open');
  closeRpChat();
  toast('对话已删除');
};

/* ── 启动 ── */
init().catch(function(e){
  document.body.insertAdjacentHTML('beforeend','<div style="padding:20px;color:#c00;font-size:13px;">初始化失败：'+(e.message||e)+'</div>');
});