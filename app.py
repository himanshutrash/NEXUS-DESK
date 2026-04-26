from flask import Flask, render_template, request, jsonify, session
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timedelta
from functools import wraps
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.naive_bayes import MultinomialNB
import random, json

app = Flask(__name__)
app.secret_key = 'nexus_v4_ultra_2024_xK9mP3vQr8sT'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///nexus.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# ─── MODELS ──────────────────────────────────────────────────────────────────

class User(db.Model):
    id           = db.Column(db.Integer, primary_key=True)
    name         = db.Column(db.String(100), nullable=False)
    email        = db.Column(db.String(120), unique=True, nullable=False)
    password     = db.Column(db.String(200), nullable=False)
    role         = db.Column(db.String(20), default='user')
    department   = db.Column(db.String(100), default='General')
    phone        = db.Column(db.String(20), default='')
    bio          = db.Column(db.Text, default='')
    avatar_color = db.Column(db.String(20), default='#6366f1')
    theme        = db.Column(db.String(10), default='dark')
    created      = db.Column(db.DateTime, default=datetime.utcnow)
    last_login   = db.Column(db.DateTime, default=datetime.utcnow)
    is_active    = db.Column(db.Boolean, default=True)
    complaints   = db.relationship('Complaint', backref='author', lazy=True, foreign_keys='Complaint.user_id')
    notifications= db.relationship('Notification', backref='user', lazy=True)
    comments     = db.relationship('Comment', backref='author', lazy=True)

    def to_dict(self):
        resolved = sum(1 for c in self.complaints if c.status == 'Resolved')
        avg_time = 0
        closed = [c for c in self.complaints if c.status == 'Resolved' and c.updated]
        if closed:
            avg_time = sum((c.updated - c.created).total_seconds() / 3600 for c in closed) / len(closed)
        return {
            'id': self.id, 'name': self.name, 'email': self.email,
            'role': self.role, 'department': self.department,
            'phone': self.phone, 'bio': self.bio,
            'avatar_color': self.avatar_color, 'theme': self.theme,
            'created': self.created.strftime('%d %b %Y'),
            'last_login': self.last_login.strftime('%d %b %Y, %H:%M') if self.last_login else '-',
            'is_active': self.is_active,
            'complaint_count': len(self.complaints),
            'resolved_count': resolved,
            'avg_resolution_hours': round(avg_time, 1)
        }

class Complaint(db.Model):
    id          = db.Column(db.Integer, primary_key=True)
    ticket_id   = db.Column(db.String(20), unique=True)
    text        = db.Column(db.Text, nullable=False)
    category    = db.Column(db.String(50))
    priority    = db.Column(db.String(20))
    status      = db.Column(db.String(20), default='Pending')
    tags        = db.Column(db.String(200), default='')
    user_id     = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    assigned_to = db.Column(db.String(100), default='Unassigned')
    admin_note  = db.Column(db.Text, default='')
    views       = db.Column(db.Integer, default=0)
    created     = db.Column(db.DateTime, default=datetime.utcnow)
    updated     = db.Column(db.DateTime, default=datetime.utcnow)
    comments    = db.relationship('Comment', backref='complaint', lazy=True, cascade='all,delete')

    def sla_hours(self):
        return {'High': 4, 'Medium': 24, 'Low': 72}.get(self.priority, 24)

    def sla_status(self):
        if self.status in ('Resolved', 'Rejected'): return 'met'
        elapsed = (datetime.utcnow() - self.created).total_seconds() / 3600
        if elapsed > self.sla_hours(): return 'breached'
        if elapsed > self.sla_hours() * 0.75: return 'warning'
        return 'ok'

    def sla_remaining(self):
        if self.status in ('Resolved', 'Rejected'): return 0
        elapsed = (datetime.utcnow() - self.created).total_seconds() / 3600
        return max(0, round(self.sla_hours() - elapsed, 1))

    def to_dict(self):
        return {
            'id': self.id, 'ticket_id': self.ticket_id, 'text': self.text,
            'category': self.category, 'priority': self.priority, 'status': self.status,
            'tags': self.tags.split(',') if self.tags else [],
            'user_name': self.author.name if self.author else 'Anonymous',
            'user_email': self.author.email if self.author else '-',
            'user_dept': self.author.department if self.author else '-',
            'admin_note': self.admin_note or '',
            'assigned_to': self.assigned_to,
            'views': self.views,
            'sla_status': self.sla_status(),
            'sla_remaining': self.sla_remaining(),
            'sla_hours': self.sla_hours(),
            'comment_count': len(self.comments),
            'created': self.created.strftime('%d %b %Y, %H:%M'),
            'updated': self.updated.strftime('%d %b %Y, %H:%M'),
            'created_ts': self.created.strftime('%Y-%m-%dT%H:%M'),
            'created_day': self.created.strftime('%a'),
            'created_hour': self.created.hour,
        }

class Comment(db.Model):
    id          = db.Column(db.Integer, primary_key=True)
    complaint_id= db.Column(db.Integer, db.ForeignKey('complaint.id'))
    user_id     = db.Column(db.Integer, db.ForeignKey('user.id'))
    text        = db.Column(db.Text, nullable=False)
    is_admin    = db.Column(db.Boolean, default=False)
    created     = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        diff = datetime.utcnow() - self.created
        ago = 'just now' if diff.seconds < 60 else f'{diff.seconds//60}m ago' if diff.seconds < 3600 else f'{diff.seconds//3600}h ago' if diff.days == 0 else f'{diff.days}d ago'
        return {
            'id': self.id, 'text': self.text,
            'user_name': self.author.name if self.author else 'System',
            'avatar_color': self.author.avatar_color if self.author else '#6366f1',
            'is_admin': self.is_admin,
            'created': self.created.strftime('%d %b %Y, %H:%M'), 'ago': ago
        }

class Notification(db.Model):
    id       = db.Column(db.Integer, primary_key=True)
    user_id  = db.Column(db.Integer, db.ForeignKey('user.id'))
    title    = db.Column(db.String(200))
    message  = db.Column(db.Text)
    type     = db.Column(db.String(30), default='info')
    is_read  = db.Column(db.Boolean, default=False)
    created  = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        diff = datetime.utcnow() - self.created
        ago = 'just now' if diff.seconds < 60 else f'{diff.seconds//60}m ago' if diff.seconds < 3600 else f'{diff.seconds//3600}h ago' if diff.days == 0 else f'{diff.days}d ago'
        return {'id': self.id, 'title': self.title, 'message': self.message,
                'type': self.type, 'is_read': self.is_read,
                'created': self.created.strftime('%d %b %Y, %H:%M'), 'ago': ago}

# ─── ML ──────────────────────────────────────────────────────────────────────

TRAIN = [
    ("Server is down no one can login","Technical","High"),
    ("Website not loading since morning","Technical","High"),
    ("Database connection error in system","Technical","High"),
    ("Application crashes when opening","Technical","High"),
    ("Cannot access shared network drive","Technical","High"),
    ("Internet connection dropping frequently","Technical","Medium"),
    ("Computer very slow and freezing","Technical","Medium"),
    ("Software update failed error code","Technical","Medium"),
    ("Password reset link not working","Technical","Medium"),
    ("VPN drops every few minutes","Technical","Medium"),
    ("Printer not connecting to laptop","Technical","Low"),
    ("Email not syncing on mobile","Technical","Low"),
    ("Gas leak smell near cafeteria","Safety","High"),
    ("Fire alarm not working floor","Safety","High"),
    ("Electrical sparks from socket","Safety","High"),
    ("Wet floor staircase no warning sign","Safety","High"),
    ("Emergency exit door blocked","Safety","High"),
    ("Chemical spill lab not cleaned","Safety","High"),
    ("Smoke smell from electrical panel","Safety","High"),
    ("Broken glass hallway floor","Safety","Medium"),
    ("Security camera not working entrance","Safety","Medium"),
    ("Air conditioning not cooling properly","Maintenance","Medium"),
    ("Elevator out of order days","Maintenance","High"),
    ("Water leaking from ceiling office","Maintenance","High"),
    ("Lights flickering meeting room","Maintenance","Medium"),
    ("Generator not working power cut","Maintenance","High"),
    ("Roof leaking during rain","Maintenance","High"),
    ("Broken chair conference room","Maintenance","Low"),
    ("Washroom tap leaking water","Maintenance","Low"),
    ("Paint peeling off walls","Maintenance","Low"),
    ("Charged twice on last invoice","Billing","High"),
    ("Invoice shows wrong amount","Billing","High"),
    ("Payment deducted not reflected","Billing","High"),
    ("Refund not processed after days","Billing","Medium"),
    ("Subscription renewed without notice","Billing","Medium"),
    ("Discount not applied to order","Billing","Low"),
    ("Staff member rude unprofessional","HR","High"),
    ("Harassment complaint against colleague","HR","High"),
    ("Overtime pay not received","HR","Medium"),
    ("Leave application rejected no reason","HR","Medium"),
    ("Workplace discrimination complaint","HR","High"),
    ("Training cancelled without notice","HR","Low"),
]
_texts=[d[0] for d in TRAIN]; _cats=[d[1] for d in TRAIN]; _pris=[d[2] for d in TRAIN]
_vec=TfidfVectorizer(stop_words='english',ngram_range=(1,2)); _X=_vec.fit_transform(_texts)
_cm=MultinomialNB(); _cm.fit(_X,_cats); _pm=MultinomialNB(); _pm.fit(_X,_pris)
def predict(text):
    xv=_vec.transform([text]); return _cm.predict(xv)[0], _pm.predict(xv)[0]

# ─── HELPERS ─────────────────────────────────────────────────────────────────

def make_ticket(): return 'TKT-'+str(random.randint(10000,99999))
def push_notif(uid,title,msg,ntype='info'):
    db.session.add(Notification(user_id=uid,title=title,message=msg,type=ntype))

def login_required(f):
    @wraps(f)
    def d(*a,**kw):
        if 'uid' not in session: return jsonify({'error':'Not authenticated'}),401
        return f(*a,**kw)
    return d

def admin_required(f):
    @wraps(f)
    def d(*a,**kw):
        if 'uid' not in session: return jsonify({'error':'Not authenticated'}),401
        if session.get('role')!='admin': return jsonify({'error':'Admin only'}),403
        return f(*a,**kw)
    return d

# ─── ROUTES ──────────────────────────────────────────────────────────────────

@app.route('/')
def index(): return render_template('index.html')

@app.route('/api/me')
def me():
    if 'uid' not in session: return jsonify({'logged_in':False})
    u=User.query.get(session['uid'])
    if not u: return jsonify({'logged_in':False})
    return jsonify({**u.to_dict(),'logged_in':True})

@app.route('/api/register',methods=['POST'])
def register():
    d=request.get_json()
    name=d.get('name','').strip(); email=d.get('email','').strip().lower()
    pwd=d.get('password',''); role=d.get('role','user')
    dept=d.get('department','General'); phone=d.get('phone','')
    COLORS=['#6366f1','#8b5cf6','#ec4899','#14b8a6','#f59e0b','#ef4444','#3b82f6','#10b981']
    if not name or not email or not pwd: return jsonify({'error':'All fields required'}),400
    if len(pwd)<6: return jsonify({'error':'Password must be 6+ characters'}),400
    if User.query.filter_by(email=email).first(): return jsonify({'error':'Email already registered'}),400
    if role=='admin' and d.get('admin_code')!='ADMIN2024': return jsonify({'error':'Invalid admin code'}),403
    u=User(name=name,email=email,password=generate_password_hash(pwd),role=role,
           department=dept,phone=phone,avatar_color=random.choice(COLORS))
    db.session.add(u); db.session.flush()
    push_notif(u.id,'Welcome to NexusDesk! 🎉',f'Hello {name}, your account is ready. Start by submitting your first complaint.','success')
    db.session.commit()
    return jsonify({'ok':True,'role':role}),201

@app.route('/api/login',methods=['POST'])
def login():
    d=request.get_json(); email=d.get('email','').strip().lower()
    u=User.query.filter_by(email=email).first()
    if not u or not check_password_hash(u.password,d.get('password','')): return jsonify({'error':'Invalid email or password'}),401
    if not u.is_active: return jsonify({'error':'Account suspended. Contact administrator.'}),403
    u.last_login=datetime.utcnow(); db.session.commit()
    session['uid']=u.id; session['name']=u.name; session['email']=u.email; session['role']=u.role
    return jsonify(u.to_dict())

@app.route('/api/logout',methods=['POST'])
def logout(): session.clear(); return jsonify({'ok':True})

@app.route('/api/profile',methods=['GET','POST'])
@login_required
def profile():
    u=User.query.get(session['uid'])
    if request.method=='GET': return jsonify(u.to_dict())
    d=request.get_json()
    u.name=d.get('name',u.name); u.department=d.get('department',u.department)
    u.phone=d.get('phone',u.phone); u.bio=d.get('bio',u.bio)
    u.theme=d.get('theme',u.theme)
    if d.get('password') and len(d['password'])>=6: u.password=generate_password_hash(d['password'])
    session['name']=u.name; db.session.commit()
    return jsonify({'ok':True,'name':u.name,'theme':u.theme})

@app.route('/api/classify',methods=['POST'])
@login_required
def classify():
    text=request.get_json().get('text','').strip()
    if not text: return jsonify({'error':'Empty'}),400
    cat,pri=predict(text); return jsonify({'category':cat,'priority':pri})

@app.route('/api/submit',methods=['POST'])
@login_required
def submit():
    d=request.get_json(); text=d.get('text','').strip()
    if not text: return jsonify({'error':'Empty'}),400
    cat,pri=predict(text); tid=make_ticket()
    c=Complaint(ticket_id=tid,text=text,category=cat,priority=pri,user_id=session['uid'])
    db.session.add(c); db.session.flush()
    push_notif(session['uid'],'Complaint Received 📋',
               f'Ticket {tid} created. Category: {cat}, Priority: {pri}. SLA: {c.sla_hours()}h.','info')
    db.session.commit(); return jsonify(c.to_dict()),201

@app.route('/api/my-complaints')
@login_required
def my_complaints():
    st=request.args.get('status','all'); ca=request.args.get('category','all')
    q=Complaint.query.filter_by(user_id=session['uid'])
    if st!='all': q=q.filter_by(status=st)
    if ca!='all': q=q.filter_by(category=ca)
    return jsonify([c.to_dict() for c in q.order_by(Complaint.id.desc()).all()])

@app.route('/api/complaint/<int:cid>')
@login_required
def complaint_detail(cid):
    c=Complaint.query.get_or_404(cid)
    if session.get('role')!='admin' and c.user_id!=session['uid']: return jsonify({'error':'Access denied'}),403
    c.views+=1; db.session.commit()
    data=c.to_dict(); data['comments']=[cm.to_dict() for cm in c.comments]
    return jsonify(data)

@app.route('/api/complaint/<int:cid>/comment',methods=['POST'])
@login_required
def add_comment(cid):
    c=Complaint.query.get_or_404(cid)
    if session.get('role')!='admin' and c.user_id!=session['uid']: return jsonify({'error':'Access denied'}),403
    text=request.get_json().get('text','').strip()
    if not text: return jsonify({'error':'Empty comment'}),400
    is_admin=session.get('role')=='admin'
    cm=Comment(complaint_id=cid,user_id=session['uid'],text=text,is_admin=is_admin)
    db.session.add(cm)
    if is_admin and c.user_id and c.user_id!=session['uid']:
        push_notif(c.user_id,'New admin reply 💬',f'Admin replied on ticket {c.ticket_id}.','info')
    elif not is_admin and c.user_id:
        pass
    db.session.commit()
    return jsonify(cm.to_dict()),201

@app.route('/api/complaints')
@admin_required
def all_complaints():
    st=request.args.get('status','all'); pr=request.args.get('priority','all')
    ca=request.args.get('category','all'); tag=request.args.get('tag','')
    q=Complaint.query
    if st!='all': q=q.filter_by(status=st)
    if pr!='all': q=q.filter_by(priority=pr)
    if ca!='all': q=q.filter_by(category=ca)
    cs=q.order_by(Complaint.id.desc()).all()
    if tag: cs=[c for c in cs if tag in (c.tags or '')]
    return jsonify([c.to_dict() for c in cs])

@app.route('/api/complaints/<int:cid>/update',methods=['POST'])
@admin_required
def update_complaint(cid):
    c=Complaint.query.get_or_404(cid); d=request.get_json()
    old=c.status; new=d.get('status',c.status)
    c.status=new; c.admin_note=d.get('note',c.admin_note)
    c.assigned_to=d.get('assigned_to',c.assigned_to)
    c.tags=','.join(d.get('tags',c.tags.split(',') if c.tags else []))
    c.updated=datetime.utcnow()
    if old!=new and c.user_id:
        emoji={'Pending':'🕐','In Progress':'⚙️','Resolved':'✅','Rejected':'❌'}.get(new,'📋')
        ntype='success' if new=='Resolved' else 'warning' if new=='Rejected' else 'info'
        push_notif(c.user_id,f'{emoji} Ticket {new}',
                   f'Your ticket {c.ticket_id} is now "{new}".'+
                   (f' Note: {c.admin_note}' if c.admin_note else ''),ntype)
    db.session.commit(); return jsonify(c.to_dict())

@app.route('/api/complaints/<int:cid>/delete',methods=['DELETE'])
@admin_required
def delete_complaint(cid):
    c=Complaint.query.get_or_404(cid)
    if c.status=='Resolved': return jsonify({'error':'Resolved complaints cannot be deleted'}),403
    db.session.delete(c); db.session.commit(); return jsonify({'ok':True})

@app.route('/api/stats')
@admin_required
def stats():
    total=Complaint.query.count(); pending=Complaint.query.filter_by(status='Pending').count()
    progress=Complaint.query.filter_by(status='In Progress').count()
    resolved=Complaint.query.filter_by(status='Resolved').count()
    rejected=Complaint.query.filter_by(status='Rejected').count()
    high=Complaint.query.filter_by(priority='High').count()
    users=User.query.filter_by(role='user').count()
    cats=['Technical','Safety','Maintenance','Billing','HR']
    cat_data={c:Complaint.query.filter_by(category=c).count() for c in cats}
    trend=[]
    for i in range(6,-1,-1):
        day=datetime.utcnow()-timedelta(days=i)
        s=day.replace(hour=0,minute=0,second=0,microsecond=0); e=s+timedelta(days=1)
        count=Complaint.query.filter(Complaint.created>=s,Complaint.created<e).count()
        trend.append({'day':day.strftime('%a'),'count':count})
    sla_breached=sum(1 for c in Complaint.query.filter(Complaint.status.in_(['Pending','In Progress'])).all() if c.sla_status()=='breached')
    resolved_cs=[c for c in Complaint.query.filter_by(status='Resolved').all() if c.updated]
    avg_res=0
    if resolved_cs: avg_res=round(sum((c.updated-c.created).total_seconds()/3600 for c in resolved_cs)/len(resolved_cs),1)
    return jsonify({'total':total,'pending':pending,'progress':progress,'resolved':resolved,
                    'rejected':rejected,'high':high,'users':users,'cat_data':cat_data,'trend':trend,
                    'resolution_rate':round(resolved/total*100) if total else 0,
                    'sla_breached':sla_breached,'avg_resolution_hours':avg_res})

@app.route('/api/analytics')
@admin_required
def analytics():
    # Heatmap: complaints per hour per day-of-week
    days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
    heatmap={d:{h:0 for h in range(24)} for d in days}
    for c in Complaint.query.all():
        dow=c.created.strftime('%a')
        if dow in heatmap: heatmap[dow][c.created.hour]+=1
    # Category trend per week
    weekly=[]
    for i in range(7,-1,-1):
        s=(datetime.utcnow()-timedelta(weeks=i)).replace(hour=0,minute=0,second=0,microsecond=0)
        e=s+timedelta(weeks=1)
        week_data={'week':s.strftime('%d %b')}
        for cat in ['Technical','Safety','Maintenance','Billing','HR']:
            week_data[cat]=Complaint.query.filter(Complaint.created>=s,Complaint.created<e,Complaint.category==cat).count()
        weekly.append(week_data)
    # SLA compliance per category
    sla_comp={}
    for cat in ['Technical','Safety','Maintenance','Billing','HR']:
        all_c=Complaint.query.filter_by(category=cat).all()
        if not all_c: sla_comp[cat]={'rate':0,'total':0}; continue
        met=sum(1 for c in all_c if c.sla_status()!='breached')
        sla_comp[cat]={'rate':round(met/len(all_c)*100),'total':len(all_c)}
    # Dept breakdown
    dept_data={}
    for u in User.query.filter_by(role='user').all():
        dept=u.department
        if dept not in dept_data: dept_data[dept]={'total':0,'resolved':0}
        dept_data[dept]['total']+=len(u.complaints)
        dept_data[dept]['resolved']+=sum(1 for c in u.complaints if c.status=='Resolved')
    return jsonify({'heatmap':heatmap,'weekly':weekly,'sla_comp':sla_comp,'dept_data':dept_data})

@app.route('/api/live')
@admin_required
def live_tickets():
    open_cs=Complaint.query.filter(Complaint.status.in_(['Pending','In Progress'])).order_by(Complaint.created.desc()).all()
    return jsonify([c.to_dict() for c in open_cs])

@app.route('/api/leaderboard')
@admin_required
def leaderboard():
    users=User.query.filter_by(role='user').all()
    board=[]
    for u in users:
        resolved=[c for c in u.complaints if c.status=='Resolved']
        times=[((c.updated-c.created).total_seconds()/3600) for c in resolved if c.updated]
        avg=round(sum(times)/len(times),1) if times else 0
        board.append({'id':u.id,'name':u.name,'department':u.department,
                      'avatar_color':u.avatar_color,
                      'total':len(u.complaints),'resolved':len(resolved),
                      'avg_hours':avg,
                      'score':len(resolved)*10 + (100-min(avg,100)) if resolved else 0})
    # Dept leaderboard
    depts={}
    for u in users:
        d=u.department
        if d not in depts: depts[d]={'dept':d,'total':0,'resolved':0,'users':0}
        depts[d]['total']+=len(u.complaints)
        depts[d]['resolved']+=sum(1 for c in u.complaints if c.status=='Resolved')
        depts[d]['users']+=1
    dept_list=sorted(depts.values(),key=lambda x:x['resolved'],reverse=True)
    board.sort(key=lambda x:x['score'],reverse=True)
    return jsonify({'users':board[:20],'departments':dept_list})

@app.route('/api/search')
@login_required
def search():
    q=request.args.get('q','').strip()
    if not q or len(q)<2: return jsonify({'results':[]})
    results=[]
    if session.get('role')=='admin':
        cs=Complaint.query.filter(Complaint.text.contains(q)|Complaint.ticket_id.contains(q)).limit(8).all()
        for c in cs:
            results.append({'type':'ticket','id':c.id,'title':c.ticket_id,'sub':c.text[:60],'category':c.category,'priority':c.priority,'status':c.status})
        us=User.query.filter(User.name.contains(q)|User.email.contains(q)).limit(4).all()
        for u in us:
            results.append({'type':'user','id':u.id,'title':u.name,'sub':u.email,'dept':u.department})
    else:
        cs=Complaint.query.filter_by(user_id=session['uid']).filter(Complaint.text.contains(q)|Complaint.ticket_id.contains(q)).limit(8).all()
        for c in cs:
            results.append({'type':'ticket','id':c.id,'title':c.ticket_id,'sub':c.text[:60],'category':c.category,'priority':c.priority,'status':c.status})
    return jsonify({'results':results})

@app.route('/api/notifications')
@login_required
def notifications():
    ns=Notification.query.filter_by(user_id=session['uid']).order_by(Notification.id.desc()).limit(50).all()
    return jsonify([n.to_dict() for n in ns])

@app.route('/api/notifications/read',methods=['POST'])
@login_required
def mark_read():
    nid=request.get_json().get('id')
    if nid=='all': Notification.query.filter_by(user_id=session['uid'],is_read=False).update({'is_read':True})
    else:
        n=Notification.query.get(nid)
        if n and n.user_id==session['uid']: n.is_read=True
    db.session.commit(); return jsonify({'ok':True})

@app.route('/api/notifications/unread-count')
@login_required
def unread_count():
    return jsonify({'count':Notification.query.filter_by(user_id=session['uid'],is_read=False).count()})

@app.route('/api/users')
@admin_required
def get_users():
    us=User.query.filter_by(role='user').order_by(User.id.desc()).all()
    return jsonify([u.to_dict() for u in us])

@app.route('/api/users/<int:uid>/toggle',methods=['POST'])
@admin_required
def toggle_user(uid):
    u=User.query.get_or_404(uid); u.is_active=not u.is_active; db.session.commit()
    return jsonify({'ok':True,'is_active':u.is_active})

@app.route('/api/activity')
@admin_required
def activity():
    recent=Complaint.query.order_by(Complaint.updated.desc()).limit(12).all()
    result=[]
    for c in recent:
        diff=datetime.utcnow()-c.updated
        ago='just now' if diff.seconds<60 else f'{diff.seconds//60}m ago' if diff.seconds<3600 else f'{diff.seconds//3600}h ago' if diff.days==0 else f'{diff.days}d ago'
        result.append({'ticket':c.ticket_id,'user':c.author.name if c.author else '?','status':c.status,'time':ago,'priority':c.priority,'category':c.category})
    return jsonify(result)

# ─── SEED ────────────────────────────────────────────────────────────────────

if __name__=='__main__':
    with app.app_context():
        db.create_all()
        if not User.query.filter_by(email='admin@nexus.com').first():
            db.session.add(User(name='System Administrator',email='admin@nexus.com',
                password=generate_password_hash('admin123'),role='admin',
                department='IT Administration',avatar_color='#6366f1'))
        seed_users=[
            ('Rahul Sharma','rahul@nexus.com','Engineering','#8b5cf6'),
            ('Priya Singh','priya@nexus.com','Operations','#14b8a6'),
            ('Amit Kumar','amit@nexus.com','Finance','#f59e0b'),
            ('Sneha Patel','sneha@nexus.com','Marketing','#ec4899'),
        ]
        for name,email,dept,color in seed_users:
            if not User.query.filter_by(email=email).first():
                u=User(name=name,email=email,password=generate_password_hash('user123'),role='user',department=dept,avatar_color=color)
                db.session.add(u); db.session.flush()
                samples=[
                    ("Server down, all employees cannot access emails or shared drives.","Technical","High","Pending","",random.randint(1,7),'urgent,escalated'),
                    ("AC not working in room 203 for a week. Temperature unbearable.","Maintenance","Medium","In Progress","Technician assigned. Will fix by Friday.",random.randint(2,10),'recurring'),
                    ("Gas leak near cafeteria. Staff feeling dizzy.","Safety","High","Resolved","Issue resolved. Area ventilated and inspected.",random.randint(5,20),''),
                    ("Charged twice on last invoice. Need urgent refund.","Billing","High","Pending","",random.randint(1,5),'vip'),
                    ("Lights flickering in meeting room 4.","Maintenance","Low","Resolved","Faulty bulb replaced.",random.randint(10,30),''),
                    ("VPN drops every few minutes, cannot work remotely.","Technical","Medium","In Progress","Network team investigating.",random.randint(3,8),'recurring'),
                    ("Harassment complaint against colleague in my department.","HR","High","Pending","",random.randint(1,3),'sensitive'),
                ]
                for text,cat,pri,stat,note,days_ago,tags in samples:
                    tid=make_ticket()
                    c=Complaint(ticket_id=tid,text=text,category=cat,priority=pri,status=stat,
                                admin_note=note,user_id=u.id,tags=tags,
                                created=datetime.utcnow()-timedelta(days=days_ago),
                                updated=datetime.utcnow()-timedelta(days=max(0,days_ago-1)))
                    db.session.add(c)
                push_notif(u.id,'Welcome to NexusDesk! 🎉',f'Hello {name}, your account is ready.','success')
        db.session.commit()
    app.run(debug=True)
