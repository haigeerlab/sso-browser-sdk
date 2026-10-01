import type { ProtocolAdapter } from './index.js';
import { backendRedirectAdapter, type BackendRedirectConfig } from './redirect.js';

export type OIDCAdapterConfig = BackendRedirectConfig;

export function oidcAdapter(config: OIDCAdapterConfig): ProtocolAdapter {
  return backendRedirectAdapter(config);
}
