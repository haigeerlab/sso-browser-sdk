import { createSSO } from 'sso-browser-sdk-prototype';
import { oidcAdapter } from 'sso-browser-sdk-prototype/oidc';

export interface User { id: string }

// 修改为业务后端提供的同源路径；协议回调由后端处理。
export const sso = createSSO<User>({
  session: { endpoint: '/sso/session' },
  logout: { endpoint: '/sso/logout' },
  adapter: oidcAdapter({ loginEndpoint: '/sso/oidc/start' }),
});
