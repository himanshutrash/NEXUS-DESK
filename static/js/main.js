'use strict';

// ─── STATE ────────────────────────────────────────────────────────────────────
let ME = null, prevPage = null, allCache = [], liveInterval = null, searchTimer = null;

const TIPS = [
  "Be specific — include location, time, and number of people affected. Better detail = faster AI classification.",
  "High priority SLA is 4 hours. If urgent, say it clearly in your complaint text.",
  "Track tickets in real-time. Admin notes and status changes appear instantly in My Tickets.",
  "For safety issues, always include the exact room number, floor, and block for faster dispatch.",
  "The AI uses TF-IDF + Naive Bayes — short clear sentences improve classification accuracy.",
  "Billing complaints should include the invoice date and exact duplicate amount.",
  "You'll get a notification every time your ticket status changes — check the bell icon.",
  "Use Cmd+K (or the search bar in the sidebar) to instantly find any ticket or user.",
];

// ─── PARTICLES ────────────────────────────────────────────────────────────────
(function () {
  const cv = document.getElementById('pc'), ctx = cv.getContext('2d');
  let w, h, pts = [];
  function resize() { w = cv.width = innerWidth; h = cv.height = innerHeight; }
  addEventListener('resize', resize); resize();
  class P {
    constructor() { this.reset(); }
    reset() { this.x = Math.random()*w; this.y = Math.random()*h; this.vx = (Math.random()-.5)*.3; this.vy = (Math.random()-.5)*.3; this.a = Math.random()*.35+.05; this.r = Math.random()*1.4+.4; }
    tick() { this.x+=this.vx; this.y+=this.vy; if(this.x<0||this.x>w||this.y<0||this.y>h) this.reset(); }
    draw() { ctx.beginPath(); ctx.arc(this.x,this.y,this.r,0,Math.PI*2); ctx.fillStyle=`rgba(99,102,241,${this.a})`; ctx.fill(); }
  }
  for(let i=0;i<70;i++) pts.push(new P());
  function frame() {
    ctx.clearRect(0,0,w,h);
    pts.forEach(p=>{p.tick();p.draw();});
    for(let i=0;i<pts.length;i++) for(let j=i+1;j<pts.length;j++) {
      const d=Math.hypot(pts[i].x-pts[j].x,pts[i].y-pts[j].y);
      if(d<110){ctx.beginPath();ctx.moveTo(pts[i].x,pts[i].y);ctx.lineTo(pts[j].x,pts[j].y);ctx.strokeStyle=`rgba(99,102,241,${.055*(1-d/110)})`;ctx.lineWidth=.5;ctx.stroke();}
    }
    requestAnimationFrame(frame);
  }
  frame();
})();

// ─── INIT ────────────────────────────────────────────────────────────────────
addEventListener('DOMContentLoaded', async () => {
  const res = await fetch('/api/me'), d = await res.json();
  if (d.logged_in) { ME = d; showApp(); } else showAuth();
});

// ─── AUTH ────────────────────────────────────────────────────────────────────
function showAuth() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display  = 'none';
}

function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-screen').style.display  = 'flex';
  const av = document.getElementById('sb-avatar');
  av.textContent = ME.name[0].toUpperCase(); av.style.background = ME.avatar_color || '#6366f1';
  setText('sb-name', ME.name); setText('sb-dept', ME.department || '');
  applyTheme(ME.theme || 'dark');
  if (ME.role === 'admin') {
    document.getElementById('nav-user').style.display  = 'none';
    document.getElementById('nav-admin').style.display = 'block';
    document.getElementById('bottom-nav').innerHTML = `
      <button class="bnav-btn active" data-page="admin-dashboard" onclick="navigate('admin-dashboard')"><span class="bnav-icon">◈</span><span class="bnav-lbl">Home</span></button>
      <button class="bnav-btn" data-page="all-complaints" onclick="navigate('all-complaints')"><span class="bnav-icon">◉</span><span class="bnav-lbl">Tickets</span></button>
      <button class="bnav-btn" data-page="live-monitor" onclick="navigate('live-monitor')"><span class="bnav-icon">⚡</span><span class="bnav-lbl">Live</span></button>
      <button class="bnav-btn" data-page="analytics" onclick="navigate('analytics')"><span class="bnav-icon">📊</span><span class="bnav-lbl">Analytics</span></button>
      <button class="bnav-btn" data-page="profile" onclick="navigate('profile')"><span class="bnav-icon">◐</span><span class="bnav-lbl">Profile</span></button>`;
    navigate('admin-dashboard');
  } else {
    document.getElementById('nav-user').style.display  = 'block';
    document.getElementById('nav-admin').style.display = 'none';
    navigate('user-dashboard');
  }
  pollNotifications();
}

function authTab(tab) {
  document.querySelectorAll('.atab').forEach((t,i)=>t.classList.toggle('active',['login','register'][i]===tab));
  document.querySelectorAll('.auth-form').forEach(f=>f.classList.remove('active'));
  document.getElementById('auth-'+tab).classList.add('active');
}

function toggleAdminCode() {
  document.getElementById('admin-code-wrap').style.display = g('r-role')==='admin'?'block':'none';
}

async function doLogin() {
  const err = document.getElementById('l-err'); err.style.display='none';
  try {
    const res = await post('/api/login', { email:g('l-email'), password:g('l-pass') });
    const d = await res.json();
    if (!res.ok) { err.textContent=d.error; err.style.display='block'; return; }
    ME = d; showApp();
  } catch { err.textContent='Connection error — make sure Flask is running (python app.py)'; err.style.display='block'; }
}

async function doRegister() {
  const err=document.getElementById('r-err'), ok=document.getElementById('r-ok');
  err.style.display=ok.style.display='none';
  try {
    const res = await post('/api/register', { name:g('r-name'),email:g('r-email'),password:g('r-pass'),role:g('r-role'),department:g('r-dept'),phone:g('r-phone'),admin_code:g('r-code') });
    const d = await res.json();
    if (!res.ok) { err.textContent=d.error; err.style.display='block'; return; }
    ok.textContent='Account created! Switching to sign in...'; ok.style.display='block';
    setTimeout(()=>authTab('login'),2000);
  } catch { err.textContent='Connection error.'; err.style.display='block'; }
}

async function doLogout() { await post('/api/logout',{}); ME=null; showAuth(); }

// ─── NAVIGATION ───────────────────────────────────────────────────────────────
function navigate(page) {
  prevPage = document.querySelector('.page.active')?.id?.replace('page-','') || null;
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const el = document.getElementById('page-'+page);
  if (el) el.classList.add('active');
  document.querySelectorAll('.nav-btn,.bnav-btn').forEach(b=>b.classList.toggle('active', b.dataset.page===page));
  closeSidebar();
  if (liveInterval && page!=='live-monitor') { clearInterval(liveInterval); liveInterval=null; }
  const loaders = {
    'user-dashboard': loadUserDashboard,
    'my-complaints':  loadMyComplaints,
    'admin-dashboard':loadAdminDashboard,
    'all-complaints': loadAllComplaints,
    'live-monitor':   startLiveMonitor,
    'analytics':      loadAnalytics,
    'leaderboard':    loadLeaderboard,
    'user-management':loadUsers,
    'notifications':  loadNotifications,
    'profile':        loadProfile,
  };
  if (loaders[page]) loaders[page]();
}

function goBack() { if (prevPage) navigate(prevPage); }

// ─── SIDEBAR MOBILE ───────────────────────────────────────────────────────────
function toggleSidebar() {
  const sb=document.getElementById('sidebar'), hb=document.getElementById('hamburger'), ov=document.getElementById('sidebar-overlay');
  sb.classList.toggle('mobile-open'); hb.classList.toggle('open'); ov.classList.toggle('show');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('hamburger').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('show');
}

// ─── THEME ────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = theme==='dark'?'☀ Light Mode':'🌙 Dark Mode';
  document.getElementById('theme-dark-btn')?.classList.toggle('active', theme==='dark');
  document.getElementById('theme-light-btn')?.classList.toggle('active', theme==='light');
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme')||'dark';
  setTheme(cur==='dark'?'light':'dark');
}

async function setTheme(theme) {
  applyTheme(theme);
  if (ME) { await post('/api/profile',{theme}); ME.theme=theme; }
}

// ─── SEARCH ───────────────────────────────────────────────────────────────────
function openSearch() {
  document.getElementById('search-modal').style.display='flex';
  setTimeout(()=>document.getElementById('sm-input')?.focus(),50);
}
function closeSearch() { document.getElementById('search-modal').style.display='none'; document.getElementById('sm-input').value=''; document.getElementById('sm-results').innerHTML=''; }

function doSearch(q) {
  clearTimeout(searchTimer);
  if (!q || q.length<2) { document.getElementById('sm-results').innerHTML=''; return; }
  searchTimer = setTimeout(async ()=>{
    const res = await fetch('/api/search?q='+encodeURIComponent(q));
    const d = await res.json();
    const el = document.getElementById('sm-results');
    if (!d.results.length) { el.innerHTML='<div class="sm-empty">No results found for "'+escHtml(q)+'"</div>'; return; }
    el.innerHTML = d.results.map(r => {
      if (r.type==='ticket') return `<div class="sm-result" onclick="closeSearch();viewDetail(${r.id})">
        <div class="sm-result-icon" style="background:rgba(99,102,241,0.15)">📋</div>
        <div><p class="sm-result-title">${r.title}</p><p class="sm-result-sub">${escHtml(r.sub)} · <span class="tag-badge tag-${r.category}" style="font-size:10px;padding:1px 7px">${r.category}</span></p></div>
      </div>`;
      return `<div class="sm-result" onclick="closeSearch();navigate('user-management')">
        <div class="sm-result-icon" style="background:rgba(16,185,129,0.15)">👤</div>
        <div><p class="sm-result-title">${escHtml(r.title)}</p><p class="sm-result-sub">${escHtml(r.sub)} · ${escHtml(r.dept)}</p></div>
      </div>`;
    }).join('');
  }, 280);
}

document.addEventListener('keydown', e=>{
  if ((e.metaKey||e.ctrlKey) && e.key==='k') { e.preventDefault(); openSearch(); }
  if (e.key==='Escape') { closeSearch(); closeModal(); }
  if (e.key==='Enter' && document.getElementById('auth-login')?.classList.contains('active') && document.getElementById('auth-screen')?.style.display!=='none') doLogin();
});

// ─── USER DASHBOARD ───────────────────────────────────────────────────────────
async function loadUserDashboard() {
  setText('uw-name', ME.name.split(' ')[0]);
  setText('ai-tip', TIPS[Math.floor(Math.random()*TIPS.length)]);
  const res = await fetch('/api/my-complaints'), data = await res.json();
  setText('um-total', data.length);
  setText('um-pending',  data.filter(c=>c.status==='Pending').length);
  setText('um-progress', data.filter(c=>c.status==='In Progress').length);
  setText('um-resolved', data.filter(c=>c.status==='Resolved').length);
  // recent
  const recent = data.slice(0,4);
  document.getElementById('ud-recent').innerHTML = recent.length
    ? recent.map(c=>`<div class="ticket-card pri-${c.priority}" style="margin-bottom:10px;cursor:pointer" onclick="viewDetail(${c.id})">
        <div class="ticket-top"><div class="ticket-badges"><span class="tag-badge tag-${c.category}">${c.category}</span><span class="tag-badge tag-${c.status.replace(' ','.')}">${c.status}</span></div><span class="ticket-id">${c.ticket_id}</span></div>
        <p class="ticket-text" style="margin-bottom:0;font-size:13px">${trunc(c.text,80)}</p>
      </div>`).join('')
    : '<p style="color:var(--t3);font-size:13px;padding:16px 0">No tickets yet. <button class="btn-primary" style="padding:6px 14px;font-size:12px;margin-left:8px" onclick="navigate(\'submit\')">Submit one →</button></p>';
  // category bars
  const cats=['Technical','Safety','Maintenance','Billing','HR'];
  const cc=['#3b82f6','#ef4444','#f59e0b','#8b5cf6','#ec4899'];
  const counts=cats.map(c=>data.filter(d=>d.category===c).length);
  const mx=Math.max(...counts,1);
  document.getElementById('ud-cats').innerHTML=cats.map((c,i)=>`
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <span style="font-size:12px;color:var(--t2);width:90px;flex-shrink:0">${c}</span>
      <div style="flex:1;height:6px;background:rgba(255,255,255,0.05);border-radius:3px;overflow:hidden"><div style="width:${counts[i]/mx*100}%;height:100%;background:${cc[i]};border-radius:3px;transition:width 1s ease-out"></div></div>
      <span style="font-size:12px;color:var(--t3);width:16px;text-align:right">${counts[i]}</span>
    </div>`).join('');
}

// ─── SUBMIT ───────────────────────────────────────────────────────────────────
let pendingAI = null;
const SLA_MAP = {'High':'4 hours','Medium':'24 hours','Low':'72 hours'};

async function classifyNow() {
  const text = g('complaint-text');
  if (!text) return toast('Please describe your complaint first.','warn');
  const box=document.getElementById('ai-result'), thinking=document.getElementById('ai-thinking'), output=document.getElementById('ai-output');
  box.style.display='block'; thinking.style.display='flex'; output.style.display='none';
  try {
    const res=await post('/api/classify',{text}); const d=await res.json();
    pendingAI={text,category:d.category,priority:d.priority};
    const ce=document.getElementById('ai-cat'), pe=document.getElementById('ai-pri'), se=document.getElementById('ai-sla');
    ce.textContent=d.category; ce.className='tag-badge tag-'+d.category;
    pe.textContent=d.priority+' Priority'; pe.className='tag-badge tag-'+d.priority;
    se.textContent='SLA: '+(SLA_MAP[d.priority]||'24h'); se.className='tag-badge tag-info';
    thinking.style.display='none'; output.style.display='block';
  } catch {
    thinking.style.display='none'; output.innerHTML='<p style="color:#fca5a5;font-size:13px">Classification error — is Flask running?</p>'; output.style.display='block';
  }
}

async function submitComplaint() {
  if (!pendingAI) return;
  const res=await post('/api/submit',{text:pendingAI.text});
  if (res.ok) {
    clearForm(); toast('Ticket submitted successfully! ✓','success'); navigate('my-complaints');
  }
}

function clearForm() { document.getElementById('complaint-text').value=''; document.getElementById('ai-result').style.display='none'; pendingAI=null; }
function loadSample(text) { document.getElementById('complaint-text').value=text; document.getElementById('ai-result').style.display='none'; pendingAI=null; }

// ─── MY COMPLAINTS ────────────────────────────────────────────────────────────
async function loadMyComplaints() {
  const list=document.getElementById('my-complaints-list');
  list.innerHTML=loadingHTML();
  const st=g('mf-status')||'all', ca=g('mf-cat')||'all';
  const res=await fetch(`/api/my-complaints?status=${st}&category=${ca}`);
  const data=await res.json();
  if (!data.length) { list.innerHTML=emptyState('No tickets match your filters.'); return; }
  list.innerHTML=data.map(c=>ticketCard(c,false)).join('');
}

function ticketCard(c, isAdmin) {
  const slaEl = c.status!=='Resolved'&&c.status!=='Rejected'
    ? `<span class="sla-${c.sla_status}">${c.sla_status==='breached'?'⚠ SLA Breached':c.sla_status==='warning'?'⏳ SLA Warning':'✓ SLA OK'} ${c.sla_remaining>0?'('+c.sla_remaining+'h)':''}</span>` : '';
  const tagsEl = c.tags&&c.tags.length ? c.tags.filter(Boolean).map(t=>`<span class="tktag">${escHtml(t)}</span>`).join('') : '';
  const adminActions = isAdmin ? `
    <button class="btn-view" onclick="viewDetail(${c.id})">View</button>
    <button class="btn-update" onclick="openModal(${c.id},'${c.ticket_id}','${c.status}',\`${escAttr(c.admin_note)}\`,'${c.assigned_to}','${(c.tags||[]).join(',')}')">Update</button>
    ${c.status!=='Resolved'?`<button class="btn-del" onclick="delTicket(${c.id},event)">Delete</button>`:'<span style="font-size:11px;color:var(--green);padding:4px 10px">🔒 Locked</span>'}
  ` : `<button class="btn-view" onclick="viewDetail(${c.id})">View Detail</button>`;
  return `<div class="ticket-card pri-${c.priority} ${c.sla_status==='breached'?'sla-breached-card':''}">
    <div class="ticket-top">
      <div class="ticket-badges">
        <span class="tag-badge tag-${c.category}">${c.category}</span>
        <span class="tag-badge tag-${c.priority}">${c.priority}</span>
        <span class="tag-badge tag-${c.status.replace(' ','.')}">${c.status}</span>
        ${slaEl}
      </div>
      <span class="ticket-id">${c.ticket_id}</span>
    </div>
    <p class="ticket-text">${trunc(c.text,160)}</p>
    ${tagsEl?`<div style="margin-bottom:10px">${tagsEl}</div>`:''}
    ${c.admin_note?`<div style="padding:9px 13px;background:rgba(16,185,129,0.07);border:1px solid rgba(16,185,129,0.2);border-radius:8px;font-size:13px;color:#6ee7b7;margin-bottom:10px"><strong>Admin:</strong> ${escHtml(c.admin_note)}</div>`:''}
    <div class="ticket-meta">
      <div class="tml">
        ${isAdmin?`<span class="tmi">👤 ${escHtml(c.user_name)}</span><span class="tmi">🏢 ${escHtml(c.user_dept)}</span>`:''}
        <span class="tmi">📅 ${c.created}</span>
        ${c.assigned_to&&c.assigned_to!=='Unassigned'?`<span class="tmi">⚙ ${escHtml(c.assigned_to)}</span>`:''}
        ${isAdmin?`<span class="tmi">👁 ${c.views}</span>`:''}
        ${c.comment_count>0?`<span class="tmi">💬 ${c.comment_count}</span>`:''}
      </div>
    </div>
    <div class="ticket-actions">${adminActions}</div>
  </div>`;
}

// ─── DETAIL ───────────────────────────────────────────────────────────────────
async function viewDetail(id) {
  prevPage = document.querySelector('.page.active')?.id?.replace('page-','') || null;
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-detail').classList.add('active');
  document.getElementById('detail-grid').innerHTML=loadingHTML();
  const res=await fetch(`/api/complaint/${id}`); const c=await res.json();
  setText('detail-tid', c.ticket_id);
  const sc={Pending:'var(--t3)',Resolved:'var(--green)','In Progress':'var(--blue)',Rejected:'var(--red)'}[c.status]||'var(--t2)';
  const commentsHTML=c.comments&&c.comments.length
    ? c.comments.map(cm=>`<div class="comment-item">
        <div class="comment-avatar" style="background:${cm.avatar_color}">${cm.user_name[0]}</div>
        <div class="comment-body">
          <div class="comment-header"><span class="comment-name">${escHtml(cm.user_name)}</span>${cm.is_admin?'<span class="comment-admin-badge">ADMIN</span>':''}<span class="comment-time">${cm.ago}</span></div>
          <p class="comment-text">${escHtml(cm.text)}</p>
        </div>
      </div>`).join('')
    : '<p style="color:var(--t3);font-size:13px;padding:12px 0">No replies yet.</p>';
  document.getElementById('detail-grid').innerHTML=`
    <div>
      <div class="glass-card p24" style="margin-bottom:16px">
        <p class="cl">Complaint</p>
        <div class="detail-text-box">${escHtml(c.text)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <span class="tag-badge tag-${c.category}">${c.category}</span>
          <span class="tag-badge tag-${c.priority}">${c.priority} Priority</span>
          <span class="tag-badge tag-${c.status.replace(' ','.')}">${c.status}</span>
          ${c.sla_status!=='met'?`<span class="sla-${c.sla_status}">${c.sla_status==='breached'?'⚠ SLA Breached':c.sla_status==='warning'?'⏳ SLA Warning':'✓ SLA OK'}</span>`:''}
          ${(c.tags||[]).filter(Boolean).map(t=>`<span class="tktag">${escHtml(t)}</span>`).join('')}
        </div>
      </div>
      ${c.admin_note?`<div class="glass-card p20" style="margin-bottom:16px"><p class="cl">Admin Response</p><div style="padding:14px;background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.2);border-radius:10px"><p style="font-size:14px;color:#6ee7b7;line-height:1.7">${escHtml(c.admin_note)}</p></div></div>`:''}
      <div class="glass-card p20">
        <p class="cl">Thread / Comments (${c.comment_count})</p>
        <div class="comment-thread">${commentsHTML}</div>
        <div class="comment-input-row" style="margin-top:14px">
          <textarea id="comment-text-${id}" placeholder="Write a reply..." style="min-height:60px;flex:1"></textarea>
          <button class="btn-primary" style="flex-shrink:0;height:60px" onclick="postComment(${id})">Send</button>
        </div>
      </div>
    </div>
    <div>
      <div class="glass-card p24" style="margin-bottom:16px">
        <p class="cl">Ticket Info</p>
        <div>
          ${infoRow('Ticket ID',`<code>${c.ticket_id}</code>`)}
          ${infoRow('Submitted By',escHtml(c.user_name)+' ('+escHtml(c.user_dept)+')')}
          ${infoRow('Email',escHtml(c.user_email))}
          ${infoRow('Category',c.category)}
          ${infoRow('Priority',c.priority)}
          ${infoRow('Status',`<span style="color:${sc};font-weight:700">${c.status}</span>`)}
          ${infoRow('Assigned',escHtml(c.assigned_to))}
          ${infoRow('SLA Deadline',c.sla_hours+'h from creation')}
          ${infoRow('SLA Remaining',c.sla_remaining>0?c.sla_remaining+'h':'—')}
          ${infoRow('Views',c.views)}
          ${infoRow('Created',c.created)}
          ${infoRow('Updated',c.updated)}
        </div>
      </div>
      <div class="glass-card p24">
        <p class="cl">Timeline</p>
        <div class="timeline">
          <div class="tl-item"><div class="tl-dot" style="background:rgba(99,102,241,0.25);border:2px solid var(--accent)">📋</div><div><p class="tl-action">Ticket Created</p><p class="tl-time">${c.created}</p></div></div>
          ${c.status==='In Progress'||c.status==='Resolved'||c.status==='Rejected'?`<div class="tl-item"><div class="tl-dot" style="background:rgba(59,130,246,0.25);border:2px solid var(--blue)">⚙</div><div><p class="tl-action">Taken In Progress</p><p class="tl-time">${c.updated}</p></div></div>`:''}
          ${c.status==='Resolved'?`<div class="tl-item"><div class="tl-dot" style="background:rgba(16,185,129,0.25);border:2px solid var(--green)">✅</div><div><p class="tl-action">Resolved</p><p class="tl-time">${c.updated}</p></div></div>`:''}
          ${c.status==='Rejected'?`<div class="tl-item"><div class="tl-dot" style="background:rgba(239,68,68,0.25);border:2px solid var(--red)">❌</div><div><p class="tl-action">Rejected</p><p class="tl-time">${c.updated}</p></div></div>`:''}
        </div>
      </div>
    </div>`;
}

function infoRow(lbl,val){return `<div class="info-row"><span class="info-lbl">${lbl}</span><span class="info-val">${val}</span></div>`;}

async function postComment(cid) {
  const el=document.getElementById('comment-text-'+cid); const text=el.value.trim();
  if (!text) return;
  const res=await post(`/api/complaint/${cid}/comment`,{text});
  if (res.ok) { el.value=''; viewDetail(cid); toast('Reply sent!','success'); }
}

// ─── ADMIN DASHBOARD ──────────────────────────────────────────────────────────
async function loadAdminDashboard() {
  const res=await fetch('/api/stats'); const d=await res.json();
  setText('am-total',d.total); setText('am-pending',d.pending); setText('am-progress',d.progress);
  setText('am-resolved',d.resolved); setText('am-high',d.high); setText('am-sla',d.sla_breached);
  setText('am-avgres',d.avg_resolution_hours||'—'); setText('am-users',d.users);
  // donut
  const pct=d.resolution_rate, circ=2*Math.PI*48;
  setText('donut-pct',pct+'%');
  document.getElementById('donut-arc').setAttribute('stroke-dasharray',`${circ*pct/100} ${circ}`);
  // trend
  const mx=Math.max(...d.trend.map(t=>t.count),1);
  document.getElementById('trend-chart').innerHTML=d.trend.map(t=>`
    <div class="bi"><div class="bf" style="height:${Math.max(t.count/mx*80,4)}px"></div><span class="bl">${t.day}</span></div>`).join('');
  // category
  const cats=Object.entries(d.cat_data); const mxc=Math.max(...cats.map(e=>e[1]),1);
  const cc={'Technical':'#3b82f6','Safety':'#ef4444','Maintenance':'#f59e0b','Billing':'#8b5cf6','HR':'#ec4899'};
  document.getElementById('cat-chart').innerHTML=`<div class="cat-row">`+cats.map(([n,cnt])=>`
    <div class="cat-item"><span class="cat-name">${n}</span><div class="cat-bar-wrap"><div class="cat-bar-fill" style="width:${cnt/mxc*100}%;background:${cc[n]||'#6366f1'}"></div></div><span class="cat-count">${cnt}</span></div>`).join('')+`</div>`;
  // priority rings
  const circ2=2*Math.PI*18;
  const priD=[{l:'High',c:d.high,col:'#ef4444'},{l:'Medium',c:d.total-d.high-Math.floor(d.total*0.25),col:'#f59e0b'},{l:'Low',c:Math.floor(d.total*0.25),col:'#10b981'}];
  document.getElementById('priority-rings').innerHTML=priD.map(p=>{
    const pp=d.total?p.c/d.total:0;
    return `<div class="ring-item"><div class="ring-vis"><svg class="ring-svg" viewBox="0 0 44 44"><circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="5"/><circle cx="22" cy="22" r="18" fill="none" stroke="${p.col}" stroke-width="5" stroke-dasharray="${circ2*pp} ${circ2}" stroke-linecap="round" style="transition:stroke-dasharray 1s ease"/></svg></div><div><p class="ring-lbl" style="color:${p.col}">${p.l}</p><p class="ring-val">${p.c} tickets · ${Math.round(pp*100)}%</p></div></div>`;
  }).join('');
  // activity
  const ar=await fetch('/api/activity'); const acts=await ar.json();
  const pc={High:'var(--red)',Medium:'var(--amber)',Low:'var(--green)'};
  document.getElementById('activity-feed').innerHTML=acts.map(a=>`
    <div class="activity-item"><div class="adot" style="background:${pc[a.priority]||'var(--t3)'}"></div>
    <div class="ainfo"><p class="atitle">${a.ticket} — <span class="tag-badge tag-${a.status.replace(' ','.')}" style="font-size:10px;padding:1px 7px">${a.status}</span></p><p class="asub">${escHtml(a.user)} · ${a.category}</p></div>
    <span class="atime">${a.time}</span></div>`).join('');
}

// ─── ALL COMPLAINTS ────────────────────────────────────────────────────────────
async function loadAllComplaints() {
  const list=document.getElementById('all-complaints-list'); list.innerHTML=loadingHTML();
  const st=g('af-status')||'all', pr=g('af-priority')||'all', ca=g('af-category')||'all', sla=g('af-sla')||'all', q=g('af-search')||'';
  const res=await fetch(`/api/complaints?status=${st}&priority=${pr}&category=${ca}`);
  let data=await res.json(); allCache=data;
  if (q) data=data.filter(c=>c.text.toLowerCase().includes(q.toLowerCase())||c.ticket_id.toLowerCase().includes(q.toLowerCase())||c.user_name.toLowerCase().includes(q.toLowerCase()));
  if (sla!=='all') data=data.filter(c=>c.sla_status===sla);
  if (!data.length) { list.innerHTML=emptyState('No tickets match the current filters.'); return; }
  list.innerHTML=data.map(c=>ticketCard(c,true)).join('');
}

async function delTicket(id,e) {
  e.stopPropagation();
  if (!confirm('Delete this ticket permanently?')) return;
  const res=await fetch(`/api/complaints/${id}/delete`,{method:'DELETE'}); const d=await res.json();
  if (!res.ok) { toast(d.error,'error'); return; }
  toast('Ticket deleted.','success'); loadAllComplaints();
}

function exportCSV() {
  if (!allCache.length) return toast('No data to export.','warn');
  const h=['ID','Ticket','Text','Category','Priority','Status','User','Dept','Assigned','SLA','Created'];
  const rows=allCache.map(c=>[c.id,c.ticket_id,`"${c.text.replace(/"/g,'""')}"`,c.category,c.priority,c.status,c.user_name,c.user_dept,c.assigned_to,c.sla_status,c.created]);
  const csv=[h,...rows].map(r=>r.join(',')).join('\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download='nexusdesk_export.csv'; a.click();
  toast('CSV exported!','success');
}

// ─── MODAL ────────────────────────────────────────────────────────────────────
function openModal(id,tid,status,note,assigned,tags) {
  document.getElementById('modal-cid').value=id;
  setText('modal-tid',tid);
  document.getElementById('modal-status').value=status;
  document.getElementById('modal-note').value=note.replace(/`/g,"'");
  document.getElementById('modal-assigned').value=assigned==='Unassigned'?'':assigned;
  document.getElementById('modal-tags').value=tags||'';
  document.getElementById('modal-overlay').style.display='flex';
}
function closeModal() { document.getElementById('modal-overlay').style.display='none'; }

async function saveUpdate() {
  const id=document.getElementById('modal-cid').value;
  const tags=g('modal-tags').split(',').map(t=>t.trim()).filter(Boolean);
  const res=await post(`/api/complaints/${id}/update`,{status:g('modal-status'),note:g('modal-note'),assigned_to:g('modal-assigned')||'Unassigned',tags});
  if (res.ok) { closeModal(); toast('Ticket updated! ✓','success'); loadAllComplaints(); }
}

// ─── LIVE MONITOR ─────────────────────────────────────────────────────────────
function startLiveMonitor() { loadLive(); if (liveInterval) clearInterval(liveInterval); liveInterval=setInterval(loadLive,10000); }

async function loadLive() {
  const res=await fetch('/api/live'), data=await res.json();
  const pending=data.filter(c=>c.status==='Pending').length;
  const progress=data.filter(c=>c.status==='In Progress').length;
  const high=data.filter(c=>c.priority==='High').length;
  const breached=data.filter(c=>c.sla_status==='breached').length;
  document.getElementById('live-stats').innerHTML=`
    <div class="glass-card p20" style="text-align:center"><p style="font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:var(--t)">${data.length}</p><p style="font-size:12px;color:var(--t3)">Open Tickets</p></div>
    <div class="glass-card p20" style="text-align:center"><p style="font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:var(--amber)">${pending}</p><p style="font-size:12px;color:var(--t3)">Pending</p></div>
    <div class="glass-card p20" style="text-align:center"><p style="font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:var(--blue)">${progress}</p><p style="font-size:12px;color:var(--t3)">In Progress</p></div>
    <div class="glass-card p20" style="text-align:center"><p style="font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:var(--red)">${breached}</p><p style="font-size:12px;color:var(--t3)">SLA Breached</p></div>`;
  if (!data.length) { document.getElementById('live-list').innerHTML=emptyState('No open tickets right now. 🎉 All clear!'); return; }
  document.getElementById('live-list').innerHTML=data.map(c=>`
    <div class="ticket-card pri-${c.priority} ${c.sla_status==='breached'?'sla-breached-card':''}" onclick="viewDetail(${c.id})">
      <div class="ticket-top">
        <div class="ticket-badges">
          <span class="tag-badge tag-${c.category}">${c.category}</span>
          <span class="tag-badge tag-${c.priority}">${c.priority}</span>
          <span class="tag-badge tag-${c.status.replace(' ','.')}">${c.status}</span>
          <span class="sla-${c.sla_status}">${c.sla_status==='breached'?'⚠ SLA Breached':c.sla_status==='warning'?'⏳ '+c.sla_remaining+'h left':'✓ '+c.sla_remaining+'h left'}</span>
        </div>
        <span class="ticket-id">${c.ticket_id}</span>
      </div>
      <p class="ticket-text" style="margin-bottom:8px">${trunc(c.text,130)}</p>
      <div class="tml"><span class="tmi">👤 ${escHtml(c.user_name)}</span><span class="tmi">🏢 ${escHtml(c.user_dept)}</span><span class="tmi">📅 ${c.created}</span></div>
    </div>`).join('');
}

// ─── ANALYTICS ────────────────────────────────────────────────────────────────
async function loadAnalytics() {
  const res=await fetch('/api/analytics'); const d=await res.json();
  // HEATMAP
  const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const hours=Array.from({length:24},(_,i)=>i);
  const allVals=days.flatMap(day=>hours.map(h=>d.heatmap[day]?.[h]||0));
  const maxV=Math.max(...allVals,1);
  const hlabels=hours.filter(h=>h%3===0).map(h=>`<div class="hm-hl" style="flex:3;min-width:0">${h}:00</div>`).join('');
  const grid=days.map(day=>{
    const cells=hours.map(h=>{
      const v=d.heatmap[day]?.[h]||0; const op=v/maxV;
      return `<div class="hm-cell" style="flex:1;min-width:0;height:20px;background:rgba(99,102,241,${op*0.85+0.04});border-radius:3px" title="${day} ${h}:00 — ${v} complaints"></div>`;
    }).join('');
    return `<div class="hm-row"><span class="hm-day-label">${day}</span>${cells}</div>`;
  }).join('');
  document.getElementById('heatmap-grid').innerHTML=`<div class="hm-hour-labels">${hlabels}</div>${grid}`;
  // SLA compliance
  const slaCC=['#3b82f6','#ef4444','#f59e0b','#8b5cf6','#ec4899'];
  document.getElementById('sla-chart').innerHTML=Object.entries(d.sla_comp).map(([cat,info],i)=>`
    <div class="sla-item">
      <span class="sla-cat">${cat}</span>
      <div class="sla-bar"><div class="sla-fill" style="width:${info.rate}%;background:${slaCC[i]||'#6366f1'}"></div></div>
      <span class="sla-pct">${info.rate}%</span>
    </div>`).join('');
  // Dept chart
  const depts=Object.entries(d.dept_data);
  const mxd=Math.max(...depts.map(e=>e[1].total),1);
  document.getElementById('dept-chart').innerHTML=depts.map(([dept,info])=>`
    <div style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;margin-bottom:5px"><span style="font-size:13px;color:var(--t2)">${escHtml(dept)}</span><span style="font-size:12px;color:var(--t3)">${info.resolved}/${info.total} resolved</span></div>
      <div style="height:7px;background:rgba(255,255,255,0.05);border-radius:4px;overflow:hidden">
        <div style="width:${info.total/mxd*100}%;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:4px"></div>
      </div>
    </div>`).join('');
  // Weekly trend
  const catKeys=['Technical','Safety','Maintenance','Billing','HR'];
  const catColors=['#3b82f6','#ef4444','#f59e0b','#8b5cf6','#ec4899'];
  const maxW=Math.max(...d.weekly.flatMap(w=>catKeys.map(k=>w[k]||0)),1);
  document.getElementById('weekly-chart').innerHTML=d.weekly.map(w=>`
    <div class="wk-group">
      <div class="wk-bars">${catKeys.map((k,i)=>`<div class="wk-bar" style="height:${Math.max((w[k]||0)/maxW*72,2)}px;background:${catColors[i]}" title="${k}: ${w[k]||0}"></div>`).join('')}</div>
      <span class="wk-label">${w.week}</span>
    </div>`).join('');
}

// ─── LEADERBOARD ──────────────────────────────────────────────────────────────
async function loadLeaderboard() {
  const res=await fetch('/api/leaderboard'); const d=await res.json();
  const medals=['🥇','🥈','🥉'];
  // User ranking
  document.getElementById('user-lb').innerHTML=d.users.map((u,i)=>`
    <div class="lb-item">
      <span class="lb-rank ${i===0?'medal-1':i===1?'medal-2':i===2?'medal-3':''}">${i<3?medals[i]:i+1}</span>
      <div class="lb-av" style="background:${u.avatar_color}">${u.name[0]}</div>
      <div class="lb-info"><p class="lb-name">${escHtml(u.name)}</p><p class="lb-dept">${escHtml(u.department)} · ${u.resolved} resolved · avg ${u.avg_hours}h</p></div>
      <div class="lb-score"><p class="lb-score-val">${Math.round(u.score)}</p><p class="lb-score-lbl">pts</p></div>
    </div>`).join('') || emptyState('No user data yet.');
  // Dept ranking
  const mxr=Math.max(...d.departments.map(dep=>dep.resolved),1);
  document.getElementById('dept-lb').innerHTML=d.departments.map((dep,i)=>`
    <div class="dept-lb-item">
      <span class="lb-rank ${i===0?'medal-1':i===1?'medal-2':i===2?'medal-3':''}">${i<3?medals[i]:i+1}</span>
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:14px;font-weight:600;color:var(--t)">${escHtml(dep.dept)}</span><span style="font-size:12px;color:var(--t3)">${dep.resolved}/${dep.total} resolved</span></div>
        <div class="dept-bar"><div class="dept-fill" style="width:${dep.resolved/mxr*100}%"></div></div>
      </div>
    </div>`).join('') || emptyState('No department data yet.');
}

// ─── USERS ────────────────────────────────────────────────────────────────────
async function loadUsers() {
  const grid=document.getElementById('users-grid'); grid.innerHTML=loadingHTML();
  const res=await fetch('/api/users'); const data=await res.json();
  if (!data.length) { grid.innerHTML=emptyState('No registered users yet.'); return; }
  grid.innerHTML=data.map(u=>`
    <div class="user-card">
      <div class="uc-top"><div class="uc-avatar" style="background:${u.avatar_color}">${u.name[0]}</div><div><p class="uc-name">${escHtml(u.name)}</p><p class="uc-email">${escHtml(u.email)}</p></div></div>
      <div style="font-size:12px;color:var(--t3);margin-bottom:12px">🏢 ${escHtml(u.department)} · 📅 ${u.created}</div>
      <div class="uc-stats">
        <div class="ucs"><p class="ucs-val">${u.complaint_count}</p><p class="ucs-lbl">Tickets</p></div>
        <div class="ucs"><p class="ucs-val" style="color:var(--green)">${u.resolved_count}</p><p class="ucs-lbl">Resolved</p></div>
        <div class="ucs"><p class="ucs-val" style="color:var(--cyan)">${u.avg_resolution_hours}h</p><p class="ucs-lbl">Avg Time</p></div>
        <div class="ucs"><p class="ucs-val">${u.complaint_count?Math.round(u.resolved_count/u.complaint_count*100):0}%</p><p class="ucs-lbl">Rate</p></div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px">
        <span class="${u.is_active?'pill-active':'pill-inactive'}">${u.is_active?'● Active':'● Suspended'}</span>
        <button class="btn-toggle" onclick="toggleUser(${u.id},this)">${u.is_active?'Suspend':'Activate'}</button>
      </div>
      <p style="font-size:11px;color:var(--t3);margin-top:8px">Last login: ${u.last_login}</p>
    </div>`).join('');
}

async function toggleUser(uid) {
  const res=await post(`/api/users/${uid}/toggle`,{});
  if (res.ok) { toast('User status updated.','success'); loadUsers(); }
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
async function loadNotifications() {
  const list=document.getElementById('notif-list'); list.innerHTML=loadingHTML();
  const res=await fetch('/api/notifications'); const data=await res.json();
  if (!data.length) { list.innerHTML=emptyState('No notifications yet.'); return; }
  const icons={info:'💬',success:'✅',warning:'⚠️',alert:'🚨'};
  list.innerHTML=data.map(n=>`
    <div class="notif-item ${n.is_read?'':'unread'}" onclick="readNotif(${n.id},this)">
      <div class="notif-icon ${n.type}">${icons[n.type]||'📋'}</div>
      <div class="notif-body"><p class="notif-title">${escHtml(n.title)}</p><p class="notif-msg">${escHtml(n.message)}</p><p class="notif-time">${n.ago}</p></div>
      ${!n.is_read?'<div class="unread-dot"></div>':''}
    </div>`).join('');
}

async function readNotif(id,el) {
  await post('/api/notifications/read',{id}); el.classList.remove('unread'); el.querySelector('.unread-dot')?.remove(); pollNotifications();
}

async function markAllRead() {
  await post('/api/notifications/read',{id:'all'}); loadNotifications(); pollNotifications();
}

async function pollNotifications() {
  try {
    const res=await fetch('/api/notifications/unread-count'); const d=await res.json();
    ['notif-badge','notif-badge2'].forEach(id=>{
      const el=document.getElementById(id);
      if (!el) return;
      el.style.display=d.count>0?'flex':'none';
      el.textContent=d.count;
    });
  } catch {}
  setTimeout(pollNotifications,15000);
}

// ─── PROFILE ──────────────────────────────────────────────────────────────────
async function loadProfile() {
  const res=await fetch('/api/profile'); const d=await res.json();
  setText('pname',d.name); setText('pemail',d.email);
  setText('ps-total',d.complaint_count); setText('ps-res',d.resolved_count);
  const pav=document.getElementById('pav'); pav.textContent=d.name[0].toUpperCase(); pav.style.background=d.avatar_color||'#6366f1';
  document.getElementById('p-name').value=d.name;
  document.getElementById('p-phone').value=d.phone||'';
  document.getElementById('p-bio').value=d.bio||'';
  const ds=document.getElementById('p-dept');
  for (const o of ds.options) if (o.value===d.department) { o.selected=true; break; }
  applyTheme(d.theme||'dark');
}

async function saveProfile() {
  const msg=document.getElementById('p-msg');
  const res=await post('/api/profile',{name:g('p-name'),department:g('p-dept'),phone:g('p-phone'),bio:g('p-bio'),password:g('p-pass'),theme:document.documentElement.getAttribute('data-theme')});
  const d=await res.json();
  if (res.ok) {
    ME.name=d.name; setText('sb-name',ME.name);
    msg.textContent='Profile saved! ✓'; msg.style.display='block';
    loadProfile(); setTimeout(()=>msg.style.display='none',3000);
  }
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function toast(msg,type='info') {
  const c={success:'rgba(16,185,129,.92)',warn:'rgba(245,158,11,.92)',error:'rgba(239,68,68,.92)',info:'rgba(99,102,241,.92)'};
  const t=document.createElement('div');
  t.style.cssText=`position:fixed;bottom:80px;right:20px;z-index:9999;padding:13px 20px;border-radius:10px;background:${c[type]};color:#fff;font-family:'Space Grotesk',sans-serif;font-size:14px;font-weight:600;box-shadow:0 8px 30px rgba(0,0,0,0.4);animation:slideIn .3s ease;max-width:320px`;
  t.textContent=msg; document.body.appendChild(t);
  setTimeout(()=>t.remove(),3000);
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function g(id){const el=document.getElementById(id);return el?el.value.trim():'';}
function setText(id,val){const el=document.getElementById(id);if(el)el.textContent=val;}
function trunc(s,n){return s&&s.length>n?s.slice(0,n)+'...':s||'';}
function escHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function escAttr(s){return String(s||'').replace(/`/g,"'").replace(/\n/g,' ');}
function post(url,body){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
function loadingHTML(){return `<div style="text-align:center;padding:48px;color:var(--t3)"><div class="nl" style="justify-content:center;margin-bottom:12px"><span></span><span></span><span></span></div><p>Loading...</p></div>`;}
function emptyState(msg){return `<div style="text-align:center;padding:56px 24px;color:var(--t3);background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:var(--radius);font-size:14px">${msg}</div>`;}

// ─── ANIMATION ───────────────────────────────────────────────────────────────
const s=document.createElement('style');
s.textContent=`@keyframes slideIn{from{transform:translateY(20px);opacity:0}to{transform:none;opacity:1}}`;
document.head.appendChild(s);
