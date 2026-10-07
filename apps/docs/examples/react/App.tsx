import { useEffect, useState } from 'react';
import { sso } from '../shared/client';
import { callbackMessage, errorMessage } from '../shared/feedback';

export default function App() {
  const [state, setState] = useState(sso.getState());
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    setMessage(callbackMessage());
    const unsubscribe = sso.onAuthChange(setState);
    setState(sso.getState());
    void sso.ensureAuthenticated().catch((error: unknown) => {
      if (active) setMessage(errorMessage(error));
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  function login() { try { sso.login(); } catch (error) { setMessage(errorMessage(error)); } }
  async function logout() {
    try { await sso.logout(); setMessage(''); } catch (error) { setMessage(errorMessage(error)); }
  }
  return <main>
    <h1>React SSO 接入</h1>
    <p aria-live="polite">{state.status === 'authenticated' ? `已登录：${state.user.id}` : state.status}</p>
    {message && <p role="alert">{message}</p>}
    <button onClick={login}>登录 / 重试</button>
    <button onClick={() => { void logout(); }}>本域退出</button>
    <button onClick={() => { void sso.getSession().catch((error: unknown) => setMessage(errorMessage(error))); }}>查询会话</button>
    <a href="/app-a/">App A（本机 Demo）</a>
  </main>;
}
