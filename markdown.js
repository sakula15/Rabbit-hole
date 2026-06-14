/* ══════════ Markdown 渲染 ══════════ */
function renderMd(raw){
  if(!raw)return '';
  var safe=[],ph=function(html){safe.push(html);return '\x01'+(safe.length-1)+'\x01';};
  var t=raw.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  t=t.replace(/```(\w*)\n?([\s\S]*?)```/g,function(_,l,c){return ph('<pre class="md-pre"><code>'+c.trimEnd()+'</code></pre>');});
  t=t.replace(/`([^`\n]+)`/g,function(_,c){return ph('<code class="md-code">'+c+'</code>');});
  t=t.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  t=t.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g,'<em>$1</em>');
  t=t.replace(/~~(.+?)~~/g,'<s>$1</s>');
  t=t.replace(/(^|\n)(\*{3,}|-{3,})/g,'$1'+ph('<hr style="border:none;border-top:1px solid #eee4dc;margin:8px 0">'));
  t=t.replace(/(^|\n)#{3} (.+)/g,'$1<strong style="font-size:13px">$2</strong>');
  t=t.replace(/(^|\n)#{2} (.+)/g,'$1<strong style="font-size:14px">$2</strong>');
  t=t.replace(/(^|\n)# (.+)/g,'$1<strong style="font-size:15px">$2</strong>');
  t=t.replace(/(^|\n)&gt; &gt; (.+)/g,'$1<blockquote class="md-bq"><blockquote class="md-bq">$2</blockquote></blockquote>');
  t=t.replace(/(^|\n)&gt; (.+)/g,'$1<blockquote class="md-bq">$2</blockquote>');
  t=t.replace(/((?:(?:^|\n)\|.+\|[ ]*)+)/g,function(_,block){
    var rows=block.trim().split('\n').filter(function(r){return r.trim();});
    if(rows.length<2)return block;
    var html='<table class="md-tbl">';
    rows.forEach(function(row,ri){
      if(ri===1&&/^\|[\s\-:|]+\|$/.test(row.trim()))return;
      var tag=ri===0?'th':'td';
      var cells=row.replace(/^\||\|$/g,'').split('|');
      html+='<tr>';
      cells.forEach(function(c){html+='<'+tag+'>'+c.trim()+'</'+tag+'>';});
      html+='</tr>';
    });
    html+='</table>';
    return ph(html);
  });
  t=t.replace(/(^|\n)  [*\-] (.+)/g,'$1<li style="margin-left:16px">$2</li>');
  t=t.replace(/(^|\n)[*\-] (.+)/g,'$1<li>$2</li>');
  t=t.replace(/((?:<li>.*<\/li>\n?)+)/g,'<ul class="md-ul">$1</ul>');
  t=t.replace(/(^|\n)(\d+)\. (.+)/g,'$1<li>$2. $3</li>');
  t=t.replace(/https?:\/\/[^\s<\x01]+/g,function(u){return ph('<a class="md-link" href="'+u+'" target="_blank" rel="noopener">'+u+'</a>');});
  t=t.replace(/\x01(\d+)\x01/g,function(_,i){return safe[i];});
  return t;
}