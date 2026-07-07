export interface ServerHealth {
  authMode: 'development' | 'device-pairing';
  version?: string;
}

export function pairingAction(health: Pick<ServerHealth, 'authMode'> | null) {
  return health?.authMode === 'development'
    ? { requiresCode: false, label: '开发模式连接' }
    : { requiresCode: true, label: '连接设备' };
}

export async function fetchServerHealth(serverUrl: string): Promise<ServerHealth> {
  const base = serverUrl.trim().replace(/\/+$/, '').replace(/\/api$/, '');
  const response = await fetch(`${base}/api/health`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<ServerHealth>;
}
