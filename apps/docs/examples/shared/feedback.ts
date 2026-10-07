const callbackMessages: Record<string, string> = {
  oidc_login_canceled: '登录已取消，可以手动重试。',
  cas_login_canceled: '登录已取消，可以手动重试。',
  saml_login_canceled: '登录已取消，可以手动重试。',
  wsfed_login_canceled: '登录已取消，可以手动重试。',
};

// SDK 不解析 ssoError。业务页只显示白名单文案，不直接信任 URL 内容。
export function callbackMessage(): string {
  const code = new URL(window.location.href).searchParams.get('ssoError');
  return code ? callbackMessages[code] ?? '认证回调失败，请检查后端或手动重试。' : '';
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && /login loop/i.test(error.message)) {
    return callbackMessage() || '登录返回后仍没有会话，请检查回调和 Cookie，然后手动重试。';
  }
  return '操作失败，请检查网络和后端接口后重试。';
}
