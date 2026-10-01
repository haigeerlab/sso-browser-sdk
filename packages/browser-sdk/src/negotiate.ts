import type { ProtocolAdapter } from './index.js';
import { backendRedirectAdapter, type BackendRedirectConfig } from './redirect.js';

export type NegotiateAdapterConfig = BackendRedirectConfig;

export function negotiateAdapter(config: NegotiateAdapterConfig): ProtocolAdapter {
  return backendRedirectAdapter(config);
}
