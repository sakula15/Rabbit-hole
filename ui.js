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
  render();renderMemberBar();updateTitle();
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
        var wraps=chatEl.querySelectorAll('.msg-wrap');
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
    }
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
    document.querySelectorAll('.tabs button').forEach(function(b){b.classList.remove('active');});
    document.querySelectorAll('.tab-page').forEach(function(p){p.classList.remove('active');});
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
  var bar=$('attachBar');bar.innerHTML='';
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

/* ── 输入框 ── */
function autoGrow(){inputEl.style.height='auto';inputEl.style.height=Math.min(inputEl.scrollHeight,110)+'px';}
inputEl.addEventListener('input',autoGrow);
sendBtn.onclick=send;

/* ── 启动 ── */
init().catch(function(e){
  document.body.insertAdjacentHTML('beforeend','<div style="padding:20px;color:#c00;font-size:13px;">初始化失败：'+(e.message||e)+'</div>');
});