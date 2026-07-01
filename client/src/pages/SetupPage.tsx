import { useEffect, useState } from 'react';
import { api, setServerUrl, setToken } from '../services/api';

export default function SetupPage({ onPaired }: { onPaired: () => void }) {
  const [serverUrl, setUrl] = useState(localStorage.getItem('serverUrl') || import.meta.env.VITE_SERVER_URL || 'http://10.0.2.2:3000');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Auto-pair in dev mode for localhost/emulator addresses
  useEffect(() => {
    const isDev = import.meta.env.DEV || serverUrl.includes('10.0.2.2') || serverUrl.includes('localhost');
    if (isDev && !loading) {
      setCode('dev');
      setLoading(true);
      setServerUrl(serverUrl);
      api.post<{ token: string }>('/auth/pair', { code: 'dev', deviceName: 'Android 论文阅读器' })
        .then((result) => { setToken(result.token); onPaired(); })
        .catch((e) => { setError(e instanceof Error ? e.message : '自动配对失败，请手动输入配对码'); setLoading(false); });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pair = async () => {
    setLoading(true);
    setError('');
    try {
      setServerUrl(serverUrl);
      const result = await api.post<{ token: string }>('/auth/pair', { code, deviceName: 'Android 论文阅读器' });
      setToken(result.token);
      onPaired();
    } catch (e) {
      setError(e instanceof Error ? e.message : '配对失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-5">
      <div className="card w-full max-w-md space-y-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">连接论文阅读器</h1>
          <p className="text-sm text-gray-500 mt-1">首次安装只需配对一次，令牌会保存在本机。</p>
        </div>
        <label className="block text-sm font-medium text-gray-700">
          服务器地址
          <input className="input-field mt-1" value={serverUrl} onChange={(e) => setUrl(e.target.value)} placeholder="https://reader.example.com" />
        </label>
        <label className="block text-sm font-medium text-gray-700">
          设备配对码
          <input className="input-field mt-1" type="password" value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary w-full" disabled={loading || !serverUrl || !code} onClick={pair}>
          {loading ? '正在配对…' : '连接设备'}
        </button>
      </div>
    </div>
  );
}
