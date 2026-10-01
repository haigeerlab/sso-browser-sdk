import type { ProtocolAdapter } from './index.js';
import { backendRedirectAdapter, type BackendRedirectConfig } from './redirect.js';

export type SAMLAdapterConfig = BackendRedirectConfig;

export function samlAdapter(config: SAMLAdapterConfig): ProtocolAdapter {
  return backendRedirectAdapter(config);
}
