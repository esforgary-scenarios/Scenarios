import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { ArrowRight, Eye, Info, LoaderCircle } from 'lucide-react'
import Workspace from './components/Workspace'
import { Brand, IconButton } from './components/ui'
import { Presence } from './components/Presence'
import { backendConfigured, clearAuthStorage, createCloudRepository, prepareSignIn, supabase, watchAuthExpiry } from './lib/backend'

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  async function signIn(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true); setError('')
    try {
      prepareSignIn(remember)
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (authError) throw authError
    } catch (cause) {
      clearAuthStorage()
      setError(cause instanceof Error && /invalid login/i.test(cause.message) ? 'Не удалось войти. Проверьте почту и пароль.' : 'Не удалось войти. Проверьте подключение и настройки Supabase.')
    } finally { setBusy(false) }
  }
  return <main className="login-page"><section className="login-main"><div className="login-form-wrap">
    <Brand/><h1>Вход</h1>
    <form onSubmit={signIn}>
      <label className="field-label" htmlFor="email">Электронная почта</label>
      <input id="email" type="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="username" required disabled={!backendConfigured}/>
      <label className="field-label" htmlFor="password">Пароль</label>
      <div className="password-field"><input id="password" type={showPassword?'text':'password'} placeholder="Пароль" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required disabled={!backendConfigured}/><IconButton title={showPassword?'Скрыть пароль':'Показать пароль'} onClick={()=>setShowPassword(!showPassword)}><Eye size={18}/></IconButton></div>
      <label className="remember"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>Запомнить меня <span>на 40 дней</span></label>
      <Presence>{error&&<p role="alert" className="form-error">{error}</p>}</Presence>
      <button className="primary-button login-submit" disabled={busy||!backendConfigured}>{busy?<LoaderCircle className="spin" size={18}/>:<>Войти<ArrowRight size={18}/></>}</button>
    </form>
    {!backendConfigured&&<div className="setup-note"><Info size={17}/><p>Добавьте URL проекта и публичный ключ Supabase в <code>.env.local</code>. Инструкция в README.</p></div>}
  </div></section></main>
}

export default function App() {
  const [user,setUser] = useState<User|null>(null)
  const [checking,setChecking] = useState(backendConfigured)
  useEffect(()=>{
    // Remove the retired sample workspace without touching account storage.
    try {
      sessionStorage.removeItem('kadr-demo')
      window.indexedDB?.deleteDatabase('kadr-public-demo')
    } catch { /* Storage restrictions must not prevent signing in. */ }
    if(!supabase)return
    let live=true
    void supabase.auth.getSession().then(({data})=>{if(live){setUser(data.session?.user??null);setChecking(false)}}).catch(()=>{if(live)setChecking(false)})
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event)=>{
      if(event==='SIGNED_OUT') {clearAuthStorage();setUser(null);setChecking(false);return}
      // Another tab can have a different persistence choice. Read this tab's storage
      // after leaving Supabase's auth callback lock, rather than trusting its broadcast.
      setTimeout(()=>{
        if(!live)return
        void supabase!.auth.getSession().then(({data})=>{if(live){setUser(data.session?.user??null);setChecking(false)}}).catch(()=>{if(live)setChecking(false)})
      },0)
    })
    return()=>{live=false;subscription.unsubscribe()}
  },[])
  useEffect(()=>{
    if(!user)return
    return watchAuthExpiry(()=>{void supabase?.auth.signOut({scope:'local'});clearAuthStorage();setUser(null)})
  },[user])
  const repository=useMemo(()=>user?createCloudRepository(user.id):null,[user?.id])
  useEffect(()=>()=>{repository?.dispose?.()},[repository])
  if(checking)return <div className="loading-screen"><Brand/><LoaderCircle className="spin"/><p>Проверяем вход…</p></div>
  if(!repository||!user)return <Login/>
  return <Workspace key={user.id} repository={repository} email={user.email??''} onExit={async()=>{
    if(supabase){
      try {await supabase.auth.signOut({scope:'local'})}
      catch { /* Local exit must remain possible while the network is unavailable. */ }
      finally {clearAuthStorage();setUser(null)}
    }
  }}/>
}
