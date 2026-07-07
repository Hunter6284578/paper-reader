import { useEffect, useState } from 'react';
import { api, setServerUrl, setToken } from '../services/api';
import { useReaderStore } from '../stores/readerStore';
import { fetchServerHealth, pairingAction, type ServerHealth } from '../services/pairing';

export default function SetupPage({ onPaired }: { onPaired: () => void }) {
  const theme = useReaderStore((s) => s.settings.theme);
  const isDark = theme === 'dark';
  const [serverUrl, setUrl] = useState(() => {
    const stored = localStorage.getItem('serverUrl');
    const envUrl = import.meta.env.VITE_API_BASE_URL;
    // Prefer env URL (build-time configured), fall back to stored or emulator default
    if (envUrl && envUrl !== 'http://localhost:3000/api') {
      return envUrl.replace(/\/api$/, '');
    }
    return stored || 'http://10.0.2.2:3000';
  });
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [health, setHealth] = useState<ServerHealth | null>(null);

  useEffect(() => {
    let active = true;
    setHealth(null);
    const timer = window.setTimeout(() => {
      fetchServerHealth(serverUrl)
        .then((result) => { if (active) { setHealth(result); setError(''); } })
        .catch(() => { if (active) setError('无法连接服务器，请检查地址与网络'); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [serverUrl]);

  const action = pairingAction(health);

  const pair = async () => {
    setLoading(true);
    setError('');
    try {
      setServerUrl(serverUrl);
      const result = await api.post<{ token: string }>('/auth/pair', { code: action.requiresCode ? code : 'development', deviceName: 'Android 论文阅读器' });
      setToken(result.token);
      onPaired();
    } catch (e) {
      setError(e instanceof Error ? e.message : '配对失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`min-h-screen flex items-center justify-center px-5 ${isDark ? 'bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-900'}`}>
      <div className={`w-full max-w-md space-y-5 rounded-xl shadow-sm border p-4 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
        <div>
          <h1 className={`text-xl font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>连接论文阅读器</h1>
          <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>首次安装只需配对一次，令牌会保存在本机。</p>
        </div>
        <label className={`block text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          服务器地址
          <input
            className={`w-full px-4 py-2 border rounded-lg mt-1 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent ${isDark ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'}`}
            value={serverUrl}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://reader.example.com"
          />
        </label>
        {action.requiresCode && <label className={`block text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          设备配对码
          <input
            className={`w-full px-4 py-2 border rounded-lg mt-1 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent ${isDark ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'}`}
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>}
        {health?.version && <p className="text-xs text-gray-500">服务器版本 {health.version}</p>}
        {error && <p className="text-sm text-red-500" role="alert" aria-live="polite">{error}</p>}
        <button className="btn-primary w-full" disabled={loading || !serverUrl || !health || (action.requiresCode && !code)} onClick={pair}>
          {loading ? '正在配对…' : action.label}
        </button>
      </div>
    </div>
  );
}
