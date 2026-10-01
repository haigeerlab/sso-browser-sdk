import type { ProtocolAdapter } from './index.js';
import { backendRedirectAdapter, type BackendRedirectConfig } from './redirect.js';

export type WSFedAdapterConfig = BackendRedirectConfig;

export function wsFedAdapter(config: WSFedAdapterConfig): ProtocolAdapter {
  return backendRedirectAdapter(config);
}
