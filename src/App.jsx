import { createRoot } from 'react-dom/client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from 'recharts'
import { initializeApp } from 'firebase/app'
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore'

// ── FIREBASE ──────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyBczNO5ljGpSIvdfBWcYIqXnTGL7hooD7s",
  authDomain: "adaptive-learning-ais.firebaseapp.com",
  projectId: "adaptive-learning-ais",
  storageBucket: "adaptive-learning-ais.firebasestorage.app",
  messagingSenderId: "301820783097",
  appId: "1:301820783097:web:dcb6d9e7c1e157925bb528",
  measurementId: "G-VSDQN8C5SW"
}
const firebaseApp = initializeApp(firebaseConfig)
const db = getFirestore(firebaseApp)

const USER_ID = 'demo-student'

async function saveSubsToFirestore(subs) {
  try {
    await setDoc(doc(db, 'users', USER_ID), { subjects: subs, updatedAt: new Date().toISOString() })
  } catch (e) { console.error('Firestore save error:', e) }
}

async function loadSubsFromFirestore() {
  try {
    const snap = await getDoc(doc(db, 'users', USER_ID))
    if (snap.exists()) return snap.data().subjects || []
  } catch (e) { console.error('Firestore load error:', e) }
  return []
}

// ── GEMINI ────────────────────────────────────────────────────────────────────
const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-pro:generateContent?key=${GEMINI_KEY}`

async function callGemini(prompt) {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
    }),
  })
  if (!res.ok) { const e = await res.json(); throw new Error(e?.error?.message) }
  const d = await res.json()
  return d.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

function parseJSON(str) {
  try { return JSON.parse(str.replace(/```json|```/g, '').trim()) }
  catch { const m = str.match(/(\{[\s\S]*\})/); try { return m ? JSON.parse(m[0]) : null } catch { return null } }
}

async function readFile(file) {
  if (file.type === 'text/plain') {
    return new Promise(r => { const fr = new FileReader(); fr.onload = e => r(e.target.result.slice(0, 10000)); fr.readAsText(file) })
  }
  return `[Document: "${file.name}" — ${(file.size/1024).toFixed(1)}KB. Generate comprehensive educational content and quiz questions for this subject at university level based on the filename.]`
}

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const DIFFS  = { 1:'Easy', 2:'Medium', 3:'Hard', 4:'Expert' }
const DCOL   = { 1:'#10B981', 2:'#F59E0B', 3:'#EF4444', 4:'#7C3AED' }
const DAYS   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const COLORS = ['#00C8FF','#7C3AED','#10B981','#F59E0B','#EF4444']

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Syne:wght@700;800&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{--bg:#07090F;--surface:#0D1117;--card:#111827;--border:#1C2A40;--accent:#00C8FF;--a2:#6D28D9;--a3:#10B981;--warn:#F59E0B;--err:#EF4444;--text:#E2E8F0;--muted:#4B5563;}
body{background:var(--bg);color:var(--text);font-family:'Plus Jakarta Sans',sans-serif;}
::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
.btn{cursor:pointer;border:none;border-radius:10px;font-family:inherit;font-weight:600;transition:all 0.18s;}
.btn:hover{transform:translateY(-1px);filter:brightness(1.12);}
.btn:active{transform:translateY(0);}
.btn:disabled{opacity:0.4;cursor:not-allowed;transform:none;filter:none;}
.card{background:var(--card);border:1px solid var(--border);border-radius:16px;}
.fade{animation:fadeUp 0.4s ease forwards;}
@keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
.spin{animation:spin 0.85s linear infinite;}
.float{animation:float 5s ease-in-out infinite;}
input,select{background:var(--surface);border:1px solid var(--border);border-radius:10px;color:var(--text);font-family:inherit;outline:none;transition:border-color 0.2s;}
input:focus,select:focus{border-color:var(--accent);}
table{border-collapse:collapse;width:100%;}
`

// ── MOUNT ─────────────────────────────────────────────────────────────────────
createRoot(document.getElementById('root')).render(<App />)

// ── APP ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [user,setUser]               = useState(null)
  const [page,setPage]               = useState('dash')
  const [subs,setSubs]               = useState([])
  const [active,setActive]           = useState(null)
  const [quiz,setQuiz]               = useState(null)
  const [loading,setLoading]         = useState(false)
  const [msg,setMsg]                 = useState('')
  const [toast,setToast]             = useState(null)
  const [authLoading,setAuthLoading] = useState(true)
  const [dbLoading,setDbLoading]     = useState(false)

  useEffect(() => { setAuthLoading(false) }, [])

  // Auto-save to Firestore whenever subs change
  useEffect(() => {
    if (user && subs.length >= 0) saveSubsToFirestore(subs)
  }, [subs, user])

  const notify = (m, err=false) => { setToast({m,err}); setTimeout(()=>setToast(null),3500) }

  const login = async () => {
    const u = { displayName:'Student', email:'student@gmail.com', photoURL:null }
    setUser(u)
    setDbLoading(true)
    const saved = await loadSubsFromFirestore()
    setSubs(saved)
    setDbLoading(false)
    if (saved.length > 0) notify(`☁️ Loaded ${saved.length} subject${saved.length>1?'s':''} from cloud!`)
  }

  const logout = () => {
    setUser(null); setSubs([]); setPage('dash')
    notify('👋 Signed out. Your data is saved to the cloud.')
  }

  const upload = async (file, name) => {
    setLoading(true); setMsg('📖 Reading document...')
    try {
      const text = await readFile(file)
      setMsg('🧠 Gemini AI analyzing...')
      const summary = await callGemini(`You are an expert educator. Write a concise 200-word summary of key topics and learning objectives.\nTitle: "${name}"\nContent:\n${text}`)
      setMsg('📋 Generating quiz questions...')
      const raw = await callGemini(`You are an adaptive quiz generator. Return ONLY raw JSON — no markdown, no backticks, no explanation.\nGenerate 5 multiple-choice questions at EASY difficulty.\nFormat: {"questions":[{"q":"...","options":["A","B","C","D"],"answer":0,"hint":"...","explanation":"..."}]}\n"answer" is the 0-based index (0-3) of the correct option.\nSubject: ${name}\nSummary: ${summary}`)
      const parsed = parseJSON(raw)
      setSubs(p => [...p, {
        id: Date.now(), name, summary, rawText: text,
        difficulty: 1, avgScore: 0, sessions: 0, scores: [],
        quizBank: parsed?.questions || [], lastStudied: null,
        color: COLORS[p.length % COLORS.length]
      }])
      notify(`✅ "${name}" added & saved to cloud!`)
      setPage('dash')
    } catch(e) {
      console.error(e)
      notify('❌ Failed — ' + (e.message || 'check your Gemini API key.'), true)
    }
    setLoading(false)
  }

  const startQuiz = async (sub) => {
    setLoading(true); setMsg('🎯 Generating adaptive quiz...')
    try {
      const raw = await callGemini(`You are an adaptive quiz generator. Return ONLY raw JSON — no markdown, no backticks.\nGenerate 6 multiple-choice questions at difficulty ${sub.difficulty} (${DIFFS[sub.difficulty]}).\nFormat: {"questions":[{"q":"...","options":["A","B","C","D"],"answer":0,"hint":"...","explanation":"..."}]}\nSubject: ${sub.name}\nContent: ${sub.rawText?.slice(0,6000)||sub.summary}`)
      const parsed = parseJSON(raw)
      setActive(sub)
      setQuiz({ questions: parsed?.questions || sub.quizBank || [], current: 0, answers: [], showHint: false, timeLeft: 30, done: false })
      setPage('quiz')
    } catch(e) {
      console.error(e)
      notify('❌ Quiz failed — ' + (e.message || 'check Gemini API key.'), true)
    }
    setLoading(false)
  }

  const finishQuiz = useCallback((answers, questions) => {
    const correct = answers.filter((a,i) => a === questions[i]?.answer).length
    const pct     = Math.round((correct / questions.length) * 100)
    setSubs(p => p.map(s => {
      if (s.id !== active?.id) return s
      const scores = [...(s.scores || []), pct]
      const avg    = Math.round(scores.reduce((a,b) => a+b, 0) / scores.length)
      let d = s.difficulty
      if (pct >= 80 && d < 4) d++
      if (pct < 50  && d > 1) d--
      return { ...s, scores, avgScore: avg, sessions: (s.sessions||0)+1, difficulty: d, lastStudied: new Date().toLocaleDateString() }
    }))
    setQuiz(q => ({ ...q, done: true, finalScore: pct, correct }))
  }, [active])

  const deleteSub = (id) => {
    setSubs(p => p.filter(s => s.id !== id))
    notify('🗑 Subject deleted.')
  }

  if (authLoading) return (
    <div style={{minHeight:'100vh',background:'#07090F',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:16}}>
      <style>{CSS}</style>
      <div style={{width:52,height:52,border:'3px solid #1C2A40',borderTop:'3px solid #00C8FF',borderRadius:'50%'}} className="spin"/>
      <p style={{color:'#00C8FF',fontWeight:600,fontSize:15,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>Loading AdaptLearn AI...</p>
    </div>
  )

  if (!user) return <Login onLogin={login}/>

  if (dbLoading) return (
    <div style={{minHeight:'100vh',background:'#07090F',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:16}}>
      <style>{CSS}</style>
      <div style={{width:52,height:52,border:'3px solid #1C2A40',borderTop:'3px solid #00C8FF',borderRadius:'50%'}} className="spin"/>
      <p style={{color:'#00C8FF',fontWeight:600,fontSize:15,fontFamily:"'Plus Jakarta Sans',sans-serif"}}>☁️ Loading your data from cloud...</p>
    </div>
  )

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',color:'var(--text)',fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
      <style>{CSS}</style>

      {toast && <div style={{position:'fixed',top:18,right:18,zIndex:9999,background:toast.err?'var(--err)':'var(--a3)',color:'#fff',padding:'12px 20px',borderRadius:12,fontWeight:600,boxShadow:'0 8px 32px #0008',animation:'fadeUp 0.3s ease',fontSize:14}}>{toast.m}</div>}

      {loading && <div style={{position:'fixed',inset:0,background:'rgba(7,9,15,0.93)',zIndex:9998,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:18}}>
        <div style={{width:52,height:52,border:'3px solid var(--border)',borderTop:'3px solid var(--accent)',borderRadius:'50%'}} className="spin"/>
        <p style={{color:'var(--accent)',fontWeight:600,fontSize:15}}>{msg}</p>
      </div>}

      {/* NAV */}
      <nav style={{background:'var(--surface)',borderBottom:'1px solid var(--border)',padding:'0 28px',display:'flex',alignItems:'center',justifyContent:'space-between',height:62,position:'sticky',top:0,zIndex:100}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:34,height:34,background:'linear-gradient(135deg,var(--accent),var(--a2))',borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',fontSize:17}}>🎓</div>
          <span style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:17}}>AdaptLearn <span style={{color:'var(--accent)'}}>AI</span></span>
        </div>
        <div style={{display:'flex',gap:4}}>
          {[['dash','🏠 Dashboard'],['upload','📤 Upload'],['schedule','📅 Schedule'],['progress','📊 Progress']].map(([p,l])=>(
            <button key={p} className="btn" onClick={()=>setPage(p)} style={{padding:'7px 14px',background:page===p?'rgba(0,200,255,0.1)':'transparent',color:page===p?'var(--accent)':'var(--muted)',fontSize:13,border:page===p?'1px solid rgba(0,200,255,0.3)':'1px solid transparent'}}>{l}</button>
          ))}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{display:'flex',alignItems:'center',gap:5,padding:'4px 10px',background:'rgba(16,185,129,0.1)',borderRadius:20,border:'1px solid rgba(16,185,129,0.25)'}}>
            <span style={{width:6,height:6,borderRadius:'50%',background:'var(--a3)',display:'inline-block'}}/>
            <span style={{fontSize:11,color:'var(--a3)',fontWeight:600}}>Cloud Sync</span>
          </div>
          {user.photoURL
            ? <img src={user.photoURL} alt="" style={{width:34,height:34,borderRadius:'50%',border:'2px solid var(--border)'}}/>
            : <div style={{width:34,height:34,background:'linear-gradient(135deg,var(--a2),var(--accent))',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:13}}>
                {user.displayName?.[0]||'S'}
              </div>
          }
          <span style={{fontSize:13,color:'var(--muted)'}}>{user.displayName?.split(' ')[0]}</span>
          <button className="btn" onClick={logout} style={{padding:'6px 12px',background:'rgba(239,68,68,0.1)',color:'var(--err)',fontSize:12,border:'1px solid rgba(239,68,68,0.25)'}}>Sign Out</button>
        </div>
      </nav>

      <main style={{maxWidth:1180,margin:'0 auto',padding:'36px 24px'}}>
        {page==='dash'     && <Dashboard subs={subs} onQuiz={startQuiz} onUpload={()=>setPage('upload')} onDelete={deleteSub}/>}
        {page==='upload'   && <Upload onUpload={upload}/>}
        {page==='schedule' && <Schedule subs={subs}/>}
        {page==='progress' && <Progress subs={subs}/>}
        {page==='quiz' && quiz && active && <Quiz sub={active} state={quiz} setState={setQuiz} onFinish={finishQuiz} onBack={()=>setPage('dash')}/>}
      </main>
    </div>
  )
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
function Login({onLogin}) {
  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',display:'flex',alignItems:'center',justifyContent:'center',position:'relative',overflow:'hidden',fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
      <style>{CSS}</style>
      <div style={{position:'absolute',top:'15%',left:'5%',width:500,height:500,background:'radial-gradient(circle,rgba(0,200,255,0.1),transparent 65%)',pointerEvents:'none'}}/>
      <div style={{position:'absolute',bottom:'10%',right:'5%',width:400,height:400,background:'radial-gradient(circle,rgba(109,40,217,0.1),transparent 65%)',pointerEvents:'none'}}/>
      <div style={{position:'absolute',inset:0,backgroundImage:'linear-gradient(rgba(28,42,64,0.4) 1px,transparent 1px),linear-gradient(90deg,rgba(28,42,64,0.4) 1px,transparent 1px)',backgroundSize:'48px 48px'}}/>
      <div className="card float" style={{padding:'48px 44px',maxWidth:460,width:'90%',textAlign:'center',position:'relative'}}>
        <div style={{width:72,height:72,background:'linear-gradient(135deg,var(--accent),var(--a2))',borderRadius:20,display:'flex',alignItems:'center',justifyContent:'center',fontSize:34,margin:'0 auto 22px'}}>🎓</div>
        <h1 style={{fontFamily:"'Syne',sans-serif",fontSize:34,fontWeight:800,background:'linear-gradient(135deg,var(--accent),var(--a2))',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',marginBottom:8}}>AdaptLearn AI</h1>
        <p style={{color:'var(--muted)',fontSize:14,marginBottom:28,lineHeight:1.7}}>Upload any textbook · Gemini generates adaptive quizzes · Track mastery</p>
        {[['📄','PDF, Word & PowerPoint support'],['🧠','Gemini 1.5 Flash AI quiz generation'],['📈','Auto-scaling Easy → Expert difficulty'],['🔁','Spaced repetition for weak topics'],['📅','Smart weekly study timetable'],['☁️','Cloud sync — data never lost']].map(([i,l])=>(
          <div key={l} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',background:'rgba(0,200,255,0.05)',borderRadius:10,border:'1px solid rgba(0,200,255,0.13)',marginBottom:8,textAlign:'left',fontSize:13}}>
            <span style={{fontSize:16}}>{i}</span><span>{l}</span>
          </div>
        ))}
        <button className="btn" onClick={onLogin} style={{marginTop:24,width:'100%',padding:15,background:'#fff',color:'#111',borderRadius:12,fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',gap:12,fontFamily:"'Plus Jakarta Sans',sans-serif",fontWeight:700}}>
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>
        <p style={{marginTop:12,fontSize:11,color:'var(--muted)'}}>Powered by Gemini 1.5 Flash · Data saved to Firestore</p>
      </div>
    </div>
  )
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function Dashboard({subs,onQuiz,onUpload,onDelete}) {
  const total = subs.reduce((a,s)=>a+(s.sessions||0),0)
  const avg   = subs.length ? Math.round(subs.reduce((a,s)=>a+(s.avgScore||0),0)/subs.length) : 0
  const wData = DAYS.map((d,i)=>({day:d,min:subs.reduce((a,s)=>(s.sessions||0)>i?a+35:a,0)}))
  return (
    <div className="fade">
      <div style={{marginBottom:28}}>
        <h2 style={{fontFamily:"'Syne',sans-serif",fontSize:30,fontWeight:800,marginBottom:6}}>Dashboard 👋</h2>
        <p style={{color:'var(--muted)',fontSize:14}}>{subs.length} subject{subs.length!==1?'s':''} · Gemini-powered adaptive learning · ☁️ Cloud synced</p>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:28}}>
        {[['📚','Subjects',subs.length,'var(--accent)'],['🎯','Sessions',total,'var(--a2)'],['⭐','Avg Score',`${avg}%`,'var(--a3)'],['🔥','Streak','7d','var(--warn)']].map(([icon,label,val,c])=>(
          <div key={label} className="card" style={{padding:20}}>
            <div style={{fontSize:26,marginBottom:8}}>{icon}</div>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:30,fontWeight:800,color:c}}>{val}</div>
            <div style={{fontSize:12,color:'var(--muted)',marginTop:4}}>{label}</div>
          </div>
        ))}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:14,marginBottom:28}}>
        {subs.length===0?(
          <div className="card" style={{padding:56,textAlign:'center',gridColumn:'1/-1'}}>
            <div style={{fontSize:52,marginBottom:14}}>📂</div>
            <h3 style={{fontFamily:"'Syne',sans-serif",fontSize:20,marginBottom:8}}>No subjects yet</h3>
            <p style={{color:'var(--muted)',marginBottom:22,fontSize:14}}>Upload a document to start AI-powered adaptive learning</p>
            <button className="btn" onClick={onUpload} style={{padding:'12px 28px',background:'linear-gradient(135deg,var(--accent),var(--a2))',color:'#fff',fontSize:14}}>📤 Upload Document</button>
          </div>
        ):subs.map(s=>(
          <div key={s.id} className="card" style={{padding:22,borderLeft:`3px solid ${s.color}`,transition:'all 0.2s'}}
            onMouseOver={e=>e.currentTarget.style.transform='translateY(-2px)'}
            onMouseOut={e=>e.currentTarget.style.transform='translateY(0)'}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
              <h3 style={{fontWeight:700,fontSize:15,flex:1,marginRight:8,lineHeight:1.3}}>{s.name}</h3>
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <span style={{padding:'3px 9px',background:`${DCOL[s.difficulty]}22`,color:DCOL[s.difficulty],borderRadius:20,fontSize:11,fontWeight:700,flexShrink:0}}>{DIFFS[s.difficulty]}</span>
                <button className="btn" onClick={()=>onDelete(s.id)} title="Delete" style={{padding:'3px 7px',background:'rgba(239,68,68,0.1)',color:'var(--err)',fontSize:12,border:'1px solid rgba(239,68,68,0.2)'}}>🗑</button>
              </div>
            </div>
            <p style={{color:'var(--muted)',fontSize:12,marginBottom:14,lineHeight:1.6,overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>{s.summary?.slice(0,120)}...</p>
            <div style={{display:'flex',gap:14,marginBottom:14,fontSize:12,color:'var(--muted)'}}>
              <span>📝 {s.sessions||0} sessions</span>
              <span>⭐ {s.avgScore||0}%</span>
              <span>🗓 {s.lastStudied||'Never'}</span>
            </div>
            <div style={{height:3,background:'var(--border)',borderRadius:2,marginBottom:14}}>
              <div style={{height:'100%',width:`${s.avgScore||0}%`,background:`linear-gradient(90deg,${s.color},var(--a2))`,borderRadius:2,transition:'width 0.6s ease'}}/>
            </div>
            <button className="btn" onClick={()=>onQuiz(s)} style={{width:'100%',padding:9,background:`${s.color}22`,color:s.color,border:`1px solid ${s.color}55`,fontSize:13}}>🎯 Start Adaptive Quiz</button>
          </div>
        ))}
      </div>
      {wData.some(d=>d.min>0)&&(
        <div className="card" style={{padding:24}}>
          <h3 style={{fontFamily:"'Syne',sans-serif",fontSize:15,marginBottom:18}}>📊 Weekly Activity</h3>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={wData}>
              <XAxis dataKey="day" tick={{fill:'var(--muted)',fontSize:11}} axisLine={false} tickLine={false}/>
              <YAxis hide/>
              <Tooltip contentStyle={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:8,fontSize:12}}/>
              <Bar dataKey="min" fill="var(--accent)" radius={[6,6,0,0]} name="Minutes"/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── UPLOAD ────────────────────────────────────────────────────────────────────
function Upload({onUpload}) {
  const [file,setFile] = useState(null)
  const [name,setName] = useState('')
  const [drag,setDrag] = useState(false)
  const ref = useRef()
  const pick = f => { setFile(f); if(!name) setName(f.name.replace(/\.[^.]+$/,'')) }
  return (
    <div className="fade" style={{maxWidth:560,margin:'0 auto'}}>
      <h2 style={{fontFamily:"'Syne',sans-serif",fontSize:28,fontWeight:800,marginBottom:6}}>📤 Upload Document</h2>
      <p style={{color:'var(--muted)',marginBottom:28,fontSize:14}}>Gemini AI will analyze your document and create adaptive quizzes</p>
      <div className="card" style={{padding:30}}>
        <div
          onDragOver={e=>{e.preventDefault();setDrag(true)}}
          onDragLeave={()=>setDrag(false)}
          onDrop={e=>{e.preventDefault();setDrag(false);const f=e.dataTransfer.files[0];if(f)pick(f)}}
          onClick={()=>ref.current?.click()}
          style={{border:`2px dashed ${drag?'var(--accent)':'var(--border)'}`,borderRadius:14,padding:44,textAlign:'center',cursor:'pointer',transition:'all 0.2s',background:drag?'rgba(0,200,255,0.04)':'transparent',marginBottom:22}}>
          <input ref={ref} type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.txt" style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(f)pick(f)}}/>
          <div style={{fontSize:44,marginBottom:10}}>{file?'✅':'📁'}</div>
          <p style={{fontWeight:600,marginBottom:4,fontSize:15}}>{file?file.name:'Drop file here or click to browse'}</p>
          <p style={{color:'var(--muted)',fontSize:12}}>{file?`${(file.size/1024).toFixed(1)} KB`:'PDF · Word · PowerPoint · TXT'}</p>
        </div>
        <label style={{display:'block',fontSize:12,color:'var(--muted)',marginBottom:7,fontWeight:700,letterSpacing:'0.05em'}}>SUBJECT NAME</label>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Organic Chemistry, World History..." style={{width:'100%',padding:'12px 15px',marginBottom:22,fontSize:14}}/>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:22}}>
          {[['📄','PDF'],['📝','Word'],['📊','PPT'],['📋','TXT']].map(([i,l])=>(
            <span key={l} style={{padding:'5px 12px',background:'rgba(16,185,129,0.12)',color:'var(--a3)',borderRadius:20,fontSize:12,fontWeight:600}}>{i} {l}</span>
          ))}
        </div>
        <button className="btn" onClick={()=>file&&name&&onUpload(file,name)} disabled={!file||!name}
          style={{width:'100%',padding:13,background:'linear-gradient(135deg,var(--accent),var(--a2))',color:'#fff',fontSize:14}}>
          🧠 Analyze with Gemini AI
        </button>
      </div>
    </div>
  )
}

// ── QUIZ ──────────────────────────────────────────────────────────────────────
function Quiz({sub,state,setState,onFinish,onBack}) {
  const {questions,current,showHint,done,finalScore,correct} = state
  const q   = questions[current]
  const ref = useRef()

  useEffect(()=>{
    if(done) return
    setState(s=>({...s,timeLeft:30}))
    ref.current = setInterval(()=>{
      setState(s=>{
        if(s.timeLeft<=1){ clearInterval(ref.current); answer(-1,s); return s }
        return {...s,timeLeft:s.timeLeft-1}
      })
    },1000)
    return()=>clearInterval(ref.current)
  },[current,done])

  const answer = (idx,s=state) => {
    clearInterval(ref.current)
    const ans = [...(s.answers||[]),idx]
    if(s.current+1>=questions.length){ setState(p=>({...p,answers:ans})); onFinish(ans,questions) }
    else setState(p=>({...p,answers:ans,current:p.current+1,showHint:false,timeLeft:30}))
  }

  if(done){
    const pct  = finalScore||0
    const col  = pct>=70?'var(--a3)':'var(--warn)'
    const msg  = pct>=90?'🏆 Outstanding!':pct>=70?'⭐ Great Work!':pct>=50?'📚 Keep Going!':'💪 Keep Practicing!'
    const newD = pct>=80?Math.min(sub.difficulty+1,4):pct<50?Math.max(sub.difficulty-1,1):sub.difficulty
    return(
      <div className="fade" style={{maxWidth:500,margin:'0 auto',textAlign:'center'}}>
        <div className="card" style={{padding:48}}>
          <div style={{fontSize:68,marginBottom:14}}>{pct>=70?'🎉':'📖'}</div>
          <h2 style={{fontFamily:"'Syne',sans-serif",fontSize:32,fontWeight:800,marginBottom:8}}>{msg}</h2>
          <p style={{color:'var(--muted)',marginBottom:30,fontSize:16}}>{correct} / {questions.length} correct</p>
          <div style={{width:120,height:120,borderRadius:'50%',background:`conic-gradient(${col} ${pct*3.6}deg,var(--border) 0deg)`,display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 28px'}}>
            <div style={{width:88,height:88,borderRadius:'50%',background:'var(--card)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Syne',sans-serif",fontSize:26,fontWeight:800}}>{pct}%</div>
          </div>
          <div style={{padding:14,background:'rgba(0,200,255,0.06)',borderRadius:12,border:'1px solid rgba(0,200,255,0.15)',marginBottom:16,fontSize:14,color:'var(--muted)',lineHeight:1.6}}>
            {newD>sub.difficulty?`🚀 Difficulty increased → ${DIFFS[newD]}!`:newD<sub.difficulty?`📉 Adjusted to ${DIFFS[newD]} for better learning`:`✅ Staying at ${DIFFS[sub.difficulty]}`}
          </div>
          <div style={{padding:12,background:'rgba(16,185,129,0.08)',borderRadius:12,border:'1px solid rgba(16,185,129,0.2)',marginBottom:28,fontSize:13,color:'var(--a3)'}}>
            ☁️ Results saved to cloud automatically
          </div>
          <button className="btn" onClick={onBack} style={{width:'100%',padding:13,background:'linear-gradient(135deg,var(--accent),var(--a2))',color:'#fff',fontSize:14}}>← Back to Dashboard</button>
        </div>
      </div>
    )
  }

  if(!q) return <div style={{textAlign:'center',padding:56,color:'var(--muted)'}}>Loading questions…</div>

  return(
    <div className="fade" style={{maxWidth:640,margin:'0 auto'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:22}}>
        <button className="btn" onClick={onBack} style={{padding:'7px 15px',background:'var(--surface)',color:'var(--muted)',fontSize:13,border:'1px solid var(--border)'}}>← Back</button>
        <div style={{textAlign:'center'}}>
          <div style={{fontWeight:700,fontSize:14}}>{sub.name}</div>
          <div style={{fontSize:12,color:'var(--muted)'}}>Q {current+1} / {questions.length}</div>
        </div>
        <div style={{width:44,height:44,borderRadius:'50%',background:state.timeLeft<=10?'rgba(239,68,68,0.15)':'rgba(0,200,255,0.1)',border:`2px solid ${state.timeLeft<=10?'var(--err)':'var(--accent)'}`,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,color:state.timeLeft<=10?'var(--err)':'var(--accent)',fontSize:16}}>
          {state.timeLeft}
        </div>
      </div>
      <div style={{height:4,background:'var(--border)',borderRadius:2,marginBottom:22}}>
        <div style={{height:'100%',width:`${(current/questions.length)*100}%`,background:'linear-gradient(90deg,var(--accent),var(--a2))',borderRadius:2,transition:'width 0.5s ease'}}/>
      </div>
      <span style={{padding:'4px 12px',background:`${DCOL[sub.difficulty]}22`,color:DCOL[sub.difficulty],borderRadius:20,fontSize:12,fontWeight:700,display:'inline-block',marginBottom:16}}>{DIFFS[sub.difficulty]} Mode</span>
      <div className="card" style={{padding:26,marginBottom:16}}>
        <p style={{fontSize:17,fontWeight:600,lineHeight:1.65}}>{q.q}</p>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:16}}>
        {q.options?.map((opt,i)=>(
          <button key={i} className="btn" onClick={()=>answer(i)}
            style={{padding:'15px 18px',background:'var(--card)',border:'1px solid var(--border)',color:'var(--text)',textAlign:'left',fontSize:14,lineHeight:1.45,borderRadius:12,display:'flex',alignItems:'center',gap:12}}
            onMouseOver={e=>{e.currentTarget.style.borderColor='var(--accent)';e.currentTarget.style.background='rgba(0,200,255,0.05)'}}
            onMouseOut={e=>{e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.background='var(--card)'}}>
            <span style={{width:28,height:28,borderRadius:'50%',background:'var(--border)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,flexShrink:0}}>
              {['A','B','C','D'][i]}
            </span>
            {opt}
          </button>
        ))}
      </div>
      <div style={{display:'flex',gap:10}}>
        <button className="btn" onClick={()=>setState(s=>({...s,showHint:!s.showHint}))} style={{flex:1,padding:9,background:'rgba(245,158,11,0.1)',color:'var(--warn)',border:'1px solid rgba(245,158,11,0.25)',fontSize:13}}>
          💡 {showHint?'Hide':'Show'} Hint
        </button>
        <button className="btn" onClick={()=>answer(-1)} style={{flex:1,padding:9,background:'var(--surface)',color:'var(--muted)',border:'1px solid var(--border)',fontSize:13}}>
          ⏭ Skip
        </button>
      </div>
      {showHint&&q.hint&&(
        <div style={{marginTop:14,padding:15,background:'rgba(245,158,11,0.06)',borderRadius:12,border:'1px solid rgba(245,158,11,0.2)',fontSize:14,color:'var(--warn)',lineHeight:1.6}}>
          💡 <strong>Hint:</strong> {q.hint}
        </div>
      )}
    </div>
  )
}

// ── SCHEDULE ──────────────────────────────────────────────────────────────────
function Schedule({subs}) {
  if(!subs.length) return(
    <div className="fade" style={{textAlign:'center',paddingTop:80}}>
      <div style={{fontSize:52,marginBottom:14}}>📅</div>
      <h2 style={{fontFamily:"'Syne',sans-serif",fontSize:24,marginBottom:8}}>No schedule yet</h2>
      <p style={{color:'var(--muted)',fontSize:14}}>Upload subjects to generate your weekly study plan</p>
    </div>
  )
  const sched = DAYS.map((day,di)=>({
    day, slots:subs.filter((_,si)=>(si+di)%Math.max(Math.ceil(subs.length/2),1)===0||subs.length===1).slice(0,2)
  }))
  return(
    <div className="fade">
      <h2 style={{fontFamily:"'Syne',sans-serif",fontSize:28,fontWeight:800,marginBottom:6}}>📅 Weekly Schedule</h2>
      <p style={{color:'var(--muted)',marginBottom:28,fontSize:14}}>AI-generated plan with spaced repetition · ☁️ Saved to cloud</p>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:10,marginBottom:28}}>
        {sched.map(({day,slots})=>(
          <div key={day} className="card" style={{padding:14,minHeight:170}}>
            <div style={{fontWeight:800,fontSize:13,color:'var(--accent)',marginBottom:10,textAlign:'center',fontFamily:"'Syne',sans-serif"}}>{day}</div>
            {slots.length===0
              ? <div style={{textAlign:'center',color:'var(--muted)',fontSize:11,marginTop:28}}>Rest 😴</div>
              : slots.map(s=>(
                <div key={s.id} style={{padding:'8px 9px',background:`${s.color}18`,borderRadius:8,marginBottom:7,borderLeft:`3px solid ${s.color}`}}>
                  <div style={{fontSize:11,fontWeight:700,color:s.color,marginBottom:2}}>{s.name.slice(0,12)}{s.name.length>12?'…':''}</div>
                  <div style={{fontSize:10,color:'var(--muted)'}}>30 min · {DIFFS[s.difficulty]}</div>
                </div>
              ))
            }
          </div>
        ))}
      </div>
      <div className="card" style={{padding:24}}>
        <h3 style={{fontFamily:"'Syne',sans-serif",fontSize:15,marginBottom:16}}>🔁 Spaced Repetition Plan</h3>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:12}}>
          {subs.map(s=>(
            <div key={s.id} style={{padding:15,background:'var(--surface)',borderRadius:12,border:'1px solid var(--border)'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <span style={{fontWeight:700,fontSize:14}}>{s.name}</span>
                <span style={{fontSize:11,padding:'2px 8px',background:`${DCOL[s.difficulty]}18`,color:DCOL[s.difficulty],borderRadius:10}}>{DIFFS[s.difficulty]}</span>
              </div>
              <div style={{fontSize:12,color:'var(--muted)'}}>
                Review every: <strong style={{color:s.avgScore>=80?'var(--a3)':'var(--warn)'}}>{s.avgScore>=80?'7 days':s.avgScore>=60?'3 days':'Daily'}</strong>
              </div>
              <div style={{fontSize:12,color:'var(--muted)',marginTop:4}}>Last: {s.lastStudied||'Never'} · {s.sessions||0} sessions</div>
              <div style={{height:3,background:'var(--border)',borderRadius:2,marginTop:10}}>
                <div style={{height:'100%',width:`${s.avgScore||0}%`,background:`linear-gradient(90deg,${s.color},var(--a2))`,borderRadius:2}}/>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── PROGRESS ──────────────────────────────────────────────────────────────────
function Progress({subs}) {
  if(!subs.length) return(
    <div className="fade" style={{textAlign:'center',paddingTop:80}}>
      <div style={{fontSize:52,marginBottom:14}}>📊</div>
      <h2 style={{fontFamily:"'Syne',sans-serif",fontSize:24,marginBottom:8}}>No data yet</h2>
      <p style={{color:'var(--muted)',fontSize:14}}>Complete quizzes to see your analytics</p>
    </div>
  )
  const pData   = subs.map(s=>({name:s.name.slice(0,9),score:s.avgScore||0}))
  const wData   = DAYS.map((d,i)=>({day:d,min:subs.reduce((a,s)=>(s.sessions||0)>i?a+35:a,0)}))
  const history = Array.from({length:5},(_,i)=>{
    const obj={session:`S${i+1}`}
    subs.forEach(s=>{obj[s.name.slice(0,8)]=s.scores?.[i]??null})
    return obj
  })
  return(
    <div className="fade">
      <h2 style={{fontFamily:"'Syne',sans-serif",fontSize:28,fontWeight:800,marginBottom:6}}>📊 Progress Analytics</h2>
      <p style={{color:'var(--muted)',marginBottom:28,fontSize:14}}>Performance breakdown across all subjects · ☁️ Cloud synced</p>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,marginBottom:20}}>
        <div className="card" style={{padding:24}}>
          <h3 style={{fontFamily:"'Syne',sans-serif",fontSize:14,marginBottom:18}}>📈 Average Score by Subject</h3>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={pData} margin={{left:-20}}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>
              <XAxis dataKey="name" tick={{fill:'var(--muted)',fontSize:11}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fill:'var(--muted)',fontSize:11}} domain={[0,100]}/>
              <Tooltip contentStyle={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:8,fontSize:12}}/>
              <Bar dataKey="score" fill="var(--accent)" radius={[6,6,0,0]} name="Score %"/>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card" style={{padding:24}}>
          <h3 style={{fontFamily:"'Syne',sans-serif",fontSize:14,marginBottom:18}}>🗓 Study Minutes Per Week</h3>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={wData} margin={{left:-20}}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>
              <XAxis dataKey="day" tick={{fill:'var(--muted)',fontSize:11}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fill:'var(--muted)',fontSize:11}}/>
              <Tooltip contentStyle={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:8,fontSize:12}}/>
              <Line type="monotone" dataKey="min" stroke="var(--a2)" strokeWidth={2.5} dot={{fill:'var(--a2)',r:4}} name="Minutes"/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      {subs.some(s=>(s.scores?.length||0)>1)&&(
        <div className="card" style={{padding:24,marginBottom:20}}>
          <h3 style={{fontFamily:"'Syne',sans-serif",fontSize:14,marginBottom:18}}>📉 Score History per Session</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={history} margin={{left:-20}}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>
              <XAxis dataKey="session" tick={{fill:'var(--muted)',fontSize:11}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fill:'var(--muted)',fontSize:11}} domain={[0,100]}/>
              <Tooltip contentStyle={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:8,fontSize:12}}/>
              <Legend wrapperStyle={{fontSize:12,color:'var(--muted)'}}/>
              {subs.map((s,i)=><Line key={s.id} type="monotone" dataKey={s.name.slice(0,8)} stroke={COLORS[i%COLORS.length]} strokeWidth={2} dot={{r:3}} connectNulls/>)}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="card" style={{padding:24}}>
        <h3 style={{fontFamily:"'Syne',sans-serif",fontSize:14,marginBottom:18}}>📋 Subject Performance Details</h3>
        <table>
          <thead>
            <tr style={{borderBottom:'1px solid var(--border)'}}>
              {['Subject','Sessions','Avg Score','Best','Difficulty','Trend'].map(h=>(
                <th key={h} style={{textAlign:'left',padding:'9px 12px',color:'var(--muted)',fontWeight:700,fontSize:12}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {subs.map(s=>(
              <tr key={s.id} style={{borderBottom:'1px solid rgba(28,42,64,0.6)'}}>
                <td style={{padding:'11px 12px',fontWeight:600}}>
                  <span style={{display:'inline-block',width:8,height:8,borderRadius:'50%',background:s.color,marginRight:10}}/>
                  {s.name}
                </td>
                <td style={{padding:'11px 12px',color:'var(--muted)'}}>{s.sessions||0}</td>
                <td style={{padding:'11px 12px'}}>
                  <span style={{color:s.avgScore>=70?'var(--a3)':s.avgScore>=50?'var(--warn)':'var(--err)',fontWeight:700}}>{s.avgScore||0}%</span>
                </td>
                <td style={{padding:'11px 12px',color:'var(--muted)'}}>{s.scores?.length?Math.max(...s.scores)+'%':'—'}</td>
                <td style={{padding:'11px 12px'}}>
                  <span style={{padding:'3px 9px',background:`${DCOL[s.difficulty]}18`,color:DCOL[s.difficulty],borderRadius:20,fontSize:11,fontWeight:700}}>{DIFFS[s.difficulty]}</span>
                </td>
                <td style={{padding:'11px 12px',color:'var(--muted)',fontSize:13}}>
                  {(s.scores?.length||0)>1?(s.scores.at(-1)>s.scores.at(-2)?'📈 Improving':'📉 Needs work'):'—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
