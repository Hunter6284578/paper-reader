import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getAiSettings, saveAiSettings } from '../services/api';
import type { AiSettings } from '../types';

export default function SettingsPage() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('deepseek-chat');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAiSettings().then((value) => {
      setSettings(value);
      setModel(value.model);
    }).catch((e) => setStatus(e.message));
  }, []);

  const save = async () => {
    setSaving(true);
    setStatus('');
    try {
      const value = await saveAiSettings(apiKey || undefined, model);
      setSettings(value);
      setApiKey('');
      setStatus('设置已加密保存');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setStatus('正在测试…');
    try {
      await api.post('/settings/ai/test');
      setStatus('连接成功');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : '连接失败');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-4 py-3 flex items-center gap-3 sticky top-0">
        <button onClick={() => navigate(-1)}>← 返回</button>
        <h1 className="font-bold">AI 与设备设置</h1>
      </header>
      <main className="max-w-lg mx-auto p-4 space-y-4">
        <div className="card space-y-4">
          <div>
            <h2 className="font-semibold">DeepSeek API</h2>
            <p className="text-xs text-gray-500 mt-1">Key 通过 HTTPS 发送，并在服务器端以 AES-256-GCM 加密保存。翻译和问答会产生 API 费用。</p>
          </div>
          <label className="block text-sm">
            API Key {settings?.configured && <span className="text-green-600">（已配置 {settings.keyHint}）</span>}
            <input className="input-field mt-1" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={settings?.configured ? '留空表示不更换' : 'sk-…'} />
          </label>
          <label className="block text-sm">
            模型
            <input className="input-field mt-1" value={model} onChange={(e) => setModel(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <button className="btn-primary flex-1" disabled={saving} onClick={save}>保存</button>
            <button className="btn-secondary flex-1" disabled={!settings?.configured} onClick={test}>测试连接</button>
          </div>
          {status && <p className={`text-sm ${status.includes('成功') || status.includes('保存') ? 'text-green-600' : 'text-gray-600'}`}>{status}</p>}
        </div>
      </main>
    </div>
  );
}
