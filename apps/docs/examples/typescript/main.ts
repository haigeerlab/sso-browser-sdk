import { sso } from '../shared/client';
import { callbackMessage, errorMessage } from '../shared/feedback';

const status = document.querySelector<HTMLParagraphElement>('#status')!;
const error = document.querySelector<HTMLParagraphElement>('#error')!;
function render() {
  const state = sso.getState();
  status.textContent = state.status === 'authenticated' ? `已登录：${state.user.id}` : state.status;
}
function report(reason: unknown) { error.textContent = errorMessage(reason); }
const unsubscribe = sso.onAuthChange(render);
render();
error.textContent = callbackMessage();
document.querySelector('#login')!.addEventListener('click', () => {
  try { sso.login(); } catch (reason) { report(reason); }
});
document.querySelector('#logout')!.addEventListener('click', () => {
  void sso.logout().then(() => { error.textContent = ''; }).catch(report);
});
document.querySelector('#refresh')!.addEventListener('click', () => {
  void sso.getSession().catch(report);
});
// 未登录时发起导航；Promise 不等待认证中心完成登录。
void sso.ensureAuthenticated().catch(report);
window.addEventListener('pagehide', unsubscribe, { once: true });
