import type { ProtocolAdapter } from './index.js';
import { backendRedirectAdapter, type BackendRedirectConfig } from './redirect.js';

export type CASAdapterConfig = BackendRedirectConfig;

export function casAdapter(config: CASAdapterConfig): ProtocolAdapter {
  return backendRedirectAdapter(config);
}
