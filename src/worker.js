const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
});

const encoder = new TextEncoder();
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const hex = (bytes) => [...bytes].map(b => b.toString(16).padStart(2,'0')).join('');
const randomId = () => crypto.randomUUID().replaceAll('-','');

async function hashPassword(password, saltHex) {
  const salt = new Uint8Array(saltHex.match(/.{1,2}/g).map(x => parseInt(x,16)));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name:'PBKDF2', salt, iterations:100000, hash:'SHA-256' }, key, 256);
  return hex(new Uint8Array(bits));
}

function newSalt() {
  const arr = new Uint8Array(16); crypto.getRandomValues(arr); return hex(arr);
}

function cookie(name, value, opts = {}) {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.secure !== false) parts.push('Secure');
  return parts.join('; ');
}

async function getUser(req, env) {
  const raw = req.headers.get('cookie') || '';
  const token = raw.split(';').map(x=>x.trim()).find(x=>x.startsWith('ocupar_session='))?.split('=')[1];
  if (!token) return null;
  const row = await env.DB.prepare(`SELECT u.id,u.name,u.email,u.role,u.active,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?`).bind(token).first();
  if (!row || !row.active || new Date(row.expires_at) < new Date()) return null;
  return { ...row, token };
}

async function parseBody(req) {
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('application/json')) return await req.json();
  if (ct.includes('form')) return Object.fromEntries((await req.formData()).entries());
  return {};
}

function requireAdmin(user) { return user && user.role === 'admin'; }
const validEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||''));
const allowedUploadTypes = new Set(['application/pdf','image/jpeg','image/png','image/webp']);


async function api(req, env, url) {
  const p = url.pathname;
  if (p === '/api/health') return json({ ok:true, app:env.APP_NAME || 'Método Ocupar' });

  if (p === '/api/setup/status' && req.method === 'GET') {
    const row = await env.DB.prepare(`SELECT COUNT(*) qty FROM users WHERE role='admin'`).first();
    return json({ configured: Number(row?.qty || 0) > 0 });
  }

  if (p === '/api/setup/admin' && req.method === 'POST') {
    const key = req.headers.get('x-setup-key');
    if (!env.ADMIN_SETUP_KEY || key !== env.ADMIN_SETUP_KEY) return json({ error:'Chave de configuração inválida.' }, 403);
    const count = await env.DB.prepare(`SELECT COUNT(*) qty FROM users WHERE role='admin'`).first();
    if (Number(count?.qty || 0) > 0) return json({ error:'Administrador já configurado.' }, 409);
    const b = await req.json();
    if (!b.name || !validEmail(b.email) || !b.password || b.password.length < 10) return json({ error:'Informe nome, e-mail e senha com pelo menos 8 caracteres.' }, 400);
    const salt = newSalt(); const hash = await hashPassword(b.password, salt);
    await env.DB.prepare(`INSERT INTO users(name,email,password_hash,password_salt,role) VALUES(?,?,?,?, 'admin')`).bind(b.name,b.email.toLowerCase().trim(),hash,salt).run();
    return json({ ok:true });
  }

  // Recuperação controlada: requer chave separada e temporária configurada como Secret.
  // Após usar, exclua ADMIN_RECOVERY_KEY no Dashboard; nenhuma senha é incluída no código.
  if (p === '/api/admin/recover' && req.method === 'POST') {
    const supplied = req.headers.get('x-recovery-key');
    if (!env.ADMIN_RECOVERY_KEY || !supplied || supplied !== env.ADMIN_RECOVERY_KEY)
      return json({error:'Recuperação não autorizada.'},403);
    const b = await req.json();
    const email = String(b.email || '').trim().toLowerCase();
    if (!validEmail(email) || typeof b.password !== 'string' || b.password.length < 10 || b.password.length > 128)
      return json({error:'Informe e-mail válido e senha entre 10 e 128 caracteres.'},400);
    const admin = await env.DB.prepare("SELECT id FROM users WHERE role='admin' AND active=1 ORDER BY id LIMIT 1").first();
    if (!admin) return json({error:'Nenhum administrador ativo cadastrado.'},404);
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email=? AND id<>?').bind(email,admin.id).first();
    if (existing) return json({error:'E-mail já pertence a outro usuário.'},409);
    const salt = newSalt(); const hash = await hashPassword(b.password,salt);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET email=?, password_hash=?, password_salt=? WHERE id=? AND role='admin'").bind(email,hash,salt,admin.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(admin.id)
    ]);
    return json({ok:true, message:'Credenciais atualizadas. Remova ADMIN_RECOVERY_KEY dos Secrets.'});
  }

  if (p === '/api/auth/login' && req.method === 'POST') {
    const b = await req.json();
    const u = await env.DB.prepare(`SELECT * FROM users WHERE email=? AND active=1`).bind(String(b.email||'').toLowerCase().trim()).first();
    if (!u) return json({ error:'E-mail ou senha inválidos.' }, 401);
    const hash = await hashPassword(String(b.password||''), u.password_salt);
    if (hash !== u.password_hash) return json({ error:'E-mail ou senha inválidos.' }, 401);
    const sid = randomId();
    const expires = new Date(Date.now()+1000*60*60*24*14).toISOString();
    await env.DB.prepare(`INSERT INTO sessions(id,user_id,expires_at) VALUES(?,?,?)`).bind(sid,u.id,expires).run();
    return json({ ok:true, user:{id:u.id,name:u.name,email:u.email,role:u.role} }, 200, { 'set-cookie': cookie('ocupar_session',sid,{maxAge:1209600}) });
  }

  if (p === '/api/auth/logout' && req.method === 'POST') {
    const user = await getUser(req, env); if (user) await env.DB.prepare(`DELETE FROM sessions WHERE id=?`).bind(user.token).run();
    return json({ ok:true }, 200, { 'set-cookie': cookie('ocupar_session','',{maxAge:0}) });
  }

  if (p === '/api/auth/me' && req.method === 'GET') {
    const user = await getUser(req, env); if (!user) return json({ user:null }, 401); return json({ user });
  }

  if (p === '/api/leads' && req.method === 'POST') {
    const b = await req.json();
    if (!b.name) return json({error:'Informe seu nome.'},400);
    await env.DB.prepare(`INSERT INTO leads(name,email,phone,interest) VALUES(?,?,?,?)`).bind(b.name,b.email||null,b.phone||null,b.interest||null).run();
    return json({ok:true});
  }

  if (p === '/api/branding' && req.method === 'GET') {
    const r=await env.DB.prepare("SELECT key,value FROM app_settings").all();return json(Object.fromEntries(r.results.map(x=>[x.key,x.value])));
  }
  if (p === '/api/branding/photo' && req.method === 'GET') {
    const obj=await env.FILES.get('branding/ocleiah-hero');if(!obj)return new Response('Foto não cadastrada',{status:404});
    const headers=new Headers();obj.writeHttpMetadata(headers);headers.set('Cache-Control','public, max-age=300');return new Response(obj.body,{headers});
  }
  const questionnairePublic=p.match(/^\/api\/questionnaires\/([a-f0-9]{32})$/);
  if(questionnairePublic && req.method==='GET'){
    const q=await env.DB.prepare('SELECT q.id,q.title,q.questions_json,q.status,c.id client_id,c.goal FROM questionnaires q JOIN clients c ON c.id=q.client_id WHERE q.token=?').bind(questionnairePublic[1]).first();
    if(!q||q.status!=='pendente')return json({error:'Questionário indisponível.'},404);
    return json({title:q.title,questions:JSON.parse(q.questions_json),goal:q.goal});
  }
  if(questionnairePublic && req.method==='POST'){
    const q=await env.DB.prepare('SELECT * FROM questionnaires WHERE token=?').bind(questionnairePublic[1]).first();
    if(!q||q.status!=='pendente')return json({error:'Questionário indisponível ou respondido.'},404);
    const b=await req.json();const qs=JSON.parse(q.questions_json);if(!b.answers||typeof b.answers!=='object'||qs.some(x=>typeof b.answers[x.id]!=='string'||!b.answers[x.id].trim()||b.answers[x.id].length>2500))return json({error:'Responda todas as perguntas (até 2500 caracteres cada).'},400);
    await env.DB.prepare("UPDATE questionnaires SET answers_json=?,status='respondido',responded_at=CURRENT_TIMESTAMP WHERE id=? AND status='pendente'").bind(JSON.stringify(Object.fromEntries(qs.map(x=>[x.id,b.answers[x.id]]))),q.id).run();return json({ok:true});
  }
  const user = await getUser(req, env);
  if (!user) return json({error:'Não autenticado.'},401);

  if(p==='/api/branding'&&req.method==='PUT'){
    if(!requireAdmin(user))return json({error:'Acesso restrito.'},403);
    const b=await req.json();for(const key of ['primary','accent','hero_title','hero_subtitle']){
      if(b[key]===undefined)continue;const val=String(b[key]).slice(0,250);
      if(['primary','accent'].includes(key)&&!/^#[0-9a-fA-F]{6}$/.test(val))return json({error:'Cor hexadecimal inválida.'},400);
      await env.DB.prepare('INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,val).run();
    }return json({ok:true});
  }
  if(p==='/api/branding/photo'&&req.method==='POST'){
    if(!requireAdmin(user))return json({error:'Acesso restrito.'},403);
    const form=await req.formData(),file=form.get('file');if(!(file instanceof File)||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)return json({error:'Envie JPG, PNG ou WebP de até 5 MB.'},400);
    await env.FILES.put('branding/ocleiah-hero',file.stream(),{httpMetadata:{contentType:file.type}});return json({ok:true});
  }
  if(p==='/api/questionnaires'&&req.method==='POST'){
    if(!requireAdmin(user))return json({error:'Acesso restrito.'},403);
    const b=await req.json();const c=await env.DB.prepare('SELECT id FROM clients WHERE id=?').bind(Number(b.client_id)).first();if(!c)return json({error:'Cliente inválido.'},404);
    const questions=[{id:'q1',text:'Qual é seu principal objetivo profissional nos próximos 12 meses?'},{id:'q2',text:'Quais competências e pontos fortes você reconhece em si?'},{id:'q3',text:'Quais situações no trabalho mais desafiam você?'},{id:'q4',text:'Como costuma reagir a conflitos ou feedbacks difíceis?'},{id:'q5',text:'Como você toma decisões sob pressão?'},{id:'q6',text:'O que gostaria de desenvolver em comunicação e liderança?'},{id:'q7',text:'Que ações já tentou e quais resultados obteve?'},{id:'q8',text:'Qual seria um primeiro passo realista para avançar?'}];
    const token=randomId();await env.DB.prepare('INSERT INTO questionnaires(client_id,token,title,questions_json) VALUES(?,?,?,?)').bind(c.id,token,'Diagnóstico de desenvolvimento profissional',JSON.stringify(questions)).run();return json({ok:true,token,url:new URL('/?questionario='+token,req.url).toString()});
  }
  const qlist=p.match(/^\/api\/clients\/(\d+)\/questionnaires$/);
  if(qlist&&req.method==='GET'){
    if(!requireAdmin(user))return json({error:'Acesso restrito.'},403);
    const rows=await env.DB.prepare('SELECT * FROM questionnaires WHERE client_id=? ORDER BY id DESC').bind(Number(qlist[1])).all();return json(rows.results);
  }
  const qreview=p.match(/^\/api\/questionnaires\/(\d+)\/(analyze|review)$/);
  if(qreview&&req.method==='POST'){
    if(!requireAdmin(user))return json({error:'Acesso restrito.'},403);
    const q=await env.DB.prepare('SELECT * FROM questionnaires WHERE id=?').bind(Number(qreview[1])).first();if(!q||!q.answers_json)return json({error:'Questionário ainda não respondido.'},400);
    const b=await req.json();
    if(qreview[2]==='review'){
      if(!['aprovado','revisao'].includes(b.status)||!String(b.review||'').trim())return json({error:'Informe parecer e situação.'},400);
      await env.DB.prepare('UPDATE questionnaires SET review=?,status=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?').bind(String(b.review).slice(0,12000),b.status,q.id).run();
      if(b.status==='aprovado')await env.DB.prepare('INSERT INTO assessments(client_id,title,category,summary) VALUES(?,?,?,?)').bind(q.client_id,'Devolutiva de desenvolvimento profissional','Questionário revisado',String(b.review).slice(0,12000)).run();
      return json({ok:true});
    }
    if(!env.GEMINI_API_KEY)return json({error:'Configure o Secret GEMINI_API_KEY no Cloudflare para ativar a análise de IA.'},503);
    const questions=JSON.parse(q.questions_json),answers=JSON.parse(q.answers_json);
    const material=questions.map(x=>x.text+'\nResposta: '+String(answers[x.id]||'')).join('\n\n');
    const prompt='Você auxilia uma mentora de desenvolvimento profissional. Resuma SOMENTE evidências das respostas, separe forças percebidas, desafios, perguntas para aprofundar e 3 ações práticas. Não diagnostique personalidade, saúde mental ou condições clínicas. Não invente fatos. Use linguagem cautelosa e termine com: Análise preliminar sujeita à revisão da especialista.\n\n'+material;
    const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.25,maxOutputTokens:1400}})});
    const data=await response.json();if(!response.ok)return json({error:'Falha ao consultar Gemini: '+String(data.error?.message||response.status).slice(0,200)},502);
    const analysis=(data.candidates?.[0]?.content?.parts||[]).map(x=>x.text||'').join('\n');if(!analysis)return json({error:'A IA não retornou uma análise.'},502);
    await env.DB.prepare("UPDATE questionnaires SET ai_analysis=?,status='analisado' WHERE id=?").bind(analysis,q.id).run();return json({ok:true,analysis});
  }
  if (p === '/api/dashboard' && req.method === 'GET') {
    if (user.role === 'admin') {
      const [clients,leads,appt,plans] = await Promise.all([
        env.DB.prepare(`SELECT COUNT(*) qty FROM clients WHERE status='ativo'`).first(),
        env.DB.prepare(`SELECT COUNT(*) qty FROM leads WHERE status IN ('novo','contato','agendado')`).first(),
        env.DB.prepare(`SELECT COUNT(*) qty FROM appointments WHERE status='agendado' AND starts_at>=datetime('now')`).first(),
        env.DB.prepare(`SELECT COUNT(*) qty FROM development_plans WHERE status='em_andamento'`).first()
      ]);
      const upcoming = await env.DB.prepare(`SELECT a.*,u.name client_name FROM appointments a JOIN clients c ON c.id=a.client_id LEFT JOIN users u ON u.id=c.user_id WHERE a.status='agendado' ORDER BY a.starts_at LIMIT 5`).all();
      return json({ metrics:{clients:clients.qty,leads:leads.qty,appointments:appt.qty,plans:plans.qty}, upcoming:upcoming.results });
    }
    const c = await env.DB.prepare(`SELECT c.* FROM clients c WHERE c.user_id=?`).bind(user.id).first();
    if (!c) return json({metrics:{}, upcoming:[]});
    const [assess,plans,appt] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) qty FROM assessments WHERE client_id=?`).bind(c.id).first(),
      env.DB.prepare(`SELECT COUNT(*) qty FROM development_plans WHERE client_id=? AND status='em_andamento'`).bind(c.id).first(),
      env.DB.prepare(`SELECT COUNT(*) qty FROM appointments WHERE client_id=? AND status='agendado' AND starts_at>=datetime('now')`).bind(c.id).first()
    ]);
    const upcoming = await env.DB.prepare(`SELECT * FROM appointments WHERE client_id=? AND status='agendado' ORDER BY starts_at LIMIT 5`).bind(c.id).all();
    return json({metrics:{assessments:assess.qty,plans:plans.qty,appointments:appt.qty}, upcoming:upcoming.results});
  }

  if (p === '/api/clients' && req.method === 'GET') {
    if (!requireAdmin(user)) return json({error:'Acesso restrito.'},403);
    const rows = await env.DB.prepare(`SELECT c.*,u.name,u.email FROM clients c LEFT JOIN users u ON u.id=c.user_id ORDER BY c.id DESC`).all();
    return json(rows.results);
  }

  if (p === '/api/clients' && req.method === 'POST') {
    if (!requireAdmin(user)) return json({error:'Acesso restrito.'},403);
    const b = await req.json();
    if (!b.name || !validEmail(b.email) || !b.password || String(b.password).length < 10) return json({error:'Informe nome, e-mail válido e senha de pelo menos 10 caracteres.'},400);
    const salt = newSalt(); const hash = await hashPassword(b.password,salt);
    try {
      const ur = await env.DB.prepare(`INSERT INTO users(name,email,password_hash,password_salt,role) VALUES(?,?,?,?, 'client')`).bind(b.name,b.email.toLowerCase().trim(),hash,salt).run();
      const uid = ur.meta.last_row_id;
      await env.DB.prepare(`INSERT INTO clients(user_id,phone,profession,company,position,goal,status,notes) VALUES(?,?,?,?,?,?,?,?)`).bind(uid,b.phone||null,b.profession||null,b.company||null,b.position||null,b.goal||null,b.status||'ativo',b.notes||null).run();
      return json({ok:true});
    } catch(e) { return json({error:'Não foi possível cadastrar. Verifique se o e-mail já existe.'},400); }
  }

  const clientMatch = p.match(/^\/api\/clients\/(\d+)$/);
  if (clientMatch && req.method === 'GET') {
    const id = Number(clientMatch[1]);
    if (user.role !== 'admin') {
      const own = await env.DB.prepare(`SELECT id FROM clients WHERE user_id=?`).bind(user.id).first();
      if (!own || own.id !== id) return json({error:'Acesso restrito.'},403);
    }
    const client = await env.DB.prepare(`SELECT c.*,u.name,u.email FROM clients c LEFT JOIN users u ON u.id=c.user_id WHERE c.id=?`).bind(id).first();
    if (!client) return json({error:'Cliente não encontrado.'},404);
    const [assessments,plans,appointments,journals,documents] = await Promise.all([
      env.DB.prepare(`SELECT * FROM assessments WHERE client_id=? ORDER BY id DESC`).bind(id).all(),
      env.DB.prepare(`SELECT * FROM development_plans WHERE client_id=? ORDER BY id DESC`).bind(id).all(),
      env.DB.prepare(`SELECT * FROM appointments WHERE client_id=? ORDER BY starts_at DESC`).bind(id).all(),
      env.DB.prepare(`SELECT * FROM journals WHERE client_id=? ORDER BY id DESC LIMIT 20`).bind(id).all(),
      env.DB.prepare(`SELECT id,name,mime_type,size_bytes,created_at FROM documents WHERE client_id=? ORDER BY id DESC`).bind(id).all()
    ]);
    return json({client,assessments:assessments.results,plans:plans.results,appointments:appointments.results,journals:journals.results,documents:documents.results});
  }

  if (p === '/api/assessments' && req.method === 'POST') {
    if (!requireAdmin(user)) return json({error:'Acesso restrito.'},403);
    const b=await req.json();
    await env.DB.prepare(`INSERT INTO assessments(client_id,title,category,scores_json,summary,strengths,development_points) VALUES(?,?,?,?,?,?,?)`).bind(b.client_id,b.title||'Avaliação comportamental',b.category||'Perfil comportamental',JSON.stringify(b.scores||{}),b.summary||null,b.strengths||null,b.development_points||null).run();
    return json({ok:true});
  }

  if (p === '/api/plans' && req.method === 'POST') {
    if (!requireAdmin(user)) return json({error:'Acesso restrito.'},403);
    const b=await req.json();
    await env.DB.prepare(`INSERT INTO development_plans(client_id,title,objective,target_date,progress) VALUES(?,?,?,?,?)`).bind(b.client_id,b.title,b.objective,b.target_date||null,Number(b.progress||0)).run();
    return json({ok:true});
  }

  if (p === '/api/appointments' && req.method === 'POST') {
    if (!requireAdmin(user)) return json({error:'Acesso restrito.'},403);
    const b=await req.json();
    await env.DB.prepare(`INSERT INTO appointments(client_id,starts_at,duration_minutes,notes) VALUES(?,?,?,?)`).bind(b.client_id,b.starts_at,Number(b.duration_minutes||60),b.notes||null).run();
    return json({ok:true});
  }

  if (p === '/api/journal' && req.method === 'POST') {
    const b=await req.json();
    let cid=b.client_id;
    if (user.role !== 'admin') {
      const c=await env.DB.prepare(`SELECT id FROM clients WHERE user_id=?`).bind(user.id).first(); cid=c?.id;
    }
    if (!cid) return json({error:'Cliente não localizado.'},400);
    await env.DB.prepare(`INSERT INTO journals(client_id,mood,situation,impact,next_step) VALUES(?,?,?,?,?)`).bind(cid,b.mood||null,b.situation,b.impact||null,b.next_step||null).run();
    return json({ok:true});
  }

  if (p === '/api/leads' && req.method === 'GET') {
    if (!requireAdmin(user)) return json({error:'Acesso restrito.'},403);
    const rows=await env.DB.prepare(`SELECT * FROM leads ORDER BY id DESC`).all(); return json(rows.results);
  }

  const leadStatus = p.match(/^\/api\/leads\/(\d+)\/status$/);
  if (leadStatus && req.method === 'PUT') {
    if (!requireAdmin(user)) return json({error:'Acesso restrito.'},403);
    const b=await req.json(); await env.DB.prepare(`UPDATE leads SET status=? WHERE id=?`).bind(b.status,Number(leadStatus[1])).run(); return json({ok:true});
  }

  if (p === '/api/documents/upload' && req.method === 'POST') {
    const form=await req.formData(); const file=form.get('file'); let cid=Number(form.get('client_id'));
    if (!(file instanceof File)) return json({error:'Arquivo obrigatório.'},400);
    if (file.size > 10*1024*1024 || !allowedUploadTypes.has(file.type)) return json({error:'Somente PDF ou imagens JPG/PNG/WebP de até 10 MB.'},400);
    if (user.role !== 'admin') { const c=await env.DB.prepare(`SELECT id FROM clients WHERE user_id=?`).bind(user.id).first(); cid=c?.id; }
    if (!cid) return json({error:'Cliente inválido.'},400);
    const key=`clients/${cid}/${Date.now()}-${randomId()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
    await env.FILES.put(key,file.stream(),{httpMetadata:{contentType:file.type||'application/octet-stream'}});
    await env.DB.prepare(`INSERT INTO documents(client_id,name,r2_key,mime_type,size_bytes) VALUES(?,?,?,?,?)`).bind(cid,file.name,key,file.type||null,file.size||null).run();
    return json({ok:true});
  }

  const docMatch=p.match(/^\/api\/documents\/(\d+)$/);
  if (docMatch && req.method==='GET') {
    const d=await env.DB.prepare(`SELECT * FROM documents WHERE id=?`).bind(Number(docMatch[1])).first();
    if(!d) return json({error:'Arquivo não encontrado.'},404);
    if(user.role!=='admin'){const c=await env.DB.prepare(`SELECT id FROM clients WHERE user_id=?`).bind(user.id).first(); if(!c||c.id!==d.client_id)return json({error:'Acesso restrito.'},403);}
    const obj=await env.FILES.get(d.r2_key); if(!obj) return json({error:'Arquivo não encontrado no armazenamento.'},404);
    const headers=new Headers(); obj.writeHttpMetadata(headers); headers.set('content-disposition',`attachment; filename="${d.name.replaceAll('"','')}"`); return new Response(obj.body,{headers});
  }

  return json({error:'Rota não encontrada.'},404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith('/api/') && !['GET','HEAD','OPTIONS'].includes(req.method)) {
        const origin=req.headers.get('origin');
        if (origin && origin !== url.origin) return json({error:'Origem não autorizada.'},403);
      }
      if (url.pathname.startsWith('/api/')) return await api(req, env, url);
      return env.ASSETS.fetch(req);
    } catch (e) {
      console.error(e);
      return json({ error:'Erro interno do servidor.' }, 500);
    }
  }
};
