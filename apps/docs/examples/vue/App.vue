<script setup lang="ts">
import { onMounted, onUnmounted, shallowRef, ref } from 'vue';
import { sso } from '../shared/client';
import { callbackMessage, errorMessage } from '../shared/feedback';

const state = shallowRef(sso.getState());
const message = ref('');
let unsubscribe: (() => void) | undefined;
function report(error: unknown) { message.value = errorMessage(error); }
function login() { try { sso.login(); } catch (error) { report(error); } }
async function logout() {
  try { await sso.logout(); message.value = ''; } catch (error) { report(error); }
}
onMounted(() => {
  message.value = callbackMessage();
  unsubscribe = sso.onAuthChange((next) => { state.value = next; });
  void sso.ensureAuthenticated().catch(report);
});
onUnmounted(() => unsubscribe?.());
</script>

<template>
  <main>
    <h1>Vue SSO 接入</h1>
    <p aria-live="polite">{{ state.status === 'authenticated' ? `已登录：${state.user.id}` : state.status }}</p>
    <p v-if="message" role="alert">{{ message }}</p>
    <button @click="login">登录 / 重试</button>
    <button @click="logout">本域退出</button>
    <button @click="sso.getSession().catch(report)">查询会话</button>
    <a href="/app-b/">App B（本机 Demo）</a>
  </main>
</template>
