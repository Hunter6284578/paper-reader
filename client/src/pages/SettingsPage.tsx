import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getAiSettings, saveAiSettings } from '../services/api';
import { scheduleReviewReminder, cancelReviewReminder, getReminderStatus } from '../services/notifications';
import { useReaderStore } from '../stores/readerStore';
import type { AiSettings } from '../types';

interface PairedDevice {
  id: string;
  label: string;
  revoked: boolean;
  current: boolean;
  createdAt: string;
  lastSeenAt: string | null;
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const theme = useReaderStore((s) => s.settings.theme);
  const isDark = theme === 'dark';
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('deepseek-chat');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderHour, setReminderHour] = useState(9);
  const [devices, setDevices] = useState<PairedDevice[]>([]);

  useEffect(() => {
    getAiSettings().then((value) => {
      setSettings(value);
      setModel(value.model);
    }).catch((e) => setStatus(e.message));
    getReminderStatus().then(status => {
      setReminderEnabled(status.scheduled);
      if (status.hour !== undefined) setReminderHour(status.hour);
    });
    api.get<{ devices: PairedDevice[] }>('/auth/devices')
      .then((value) => setDevices(value.devices))
      .catch((error) => setStatus(error instanceof Error ? error.message : '设备列表加载失败'));
  }, []);

  const revokeDevice = async (device: PairedDevice) => {
    if (!confirm(`确定撤销设备“${device.label}”吗？${device.current ? '当前设备将需要重新配对。' : ''}`)) return;
    const result = await api.delete<{ revokedCurrentDevice: boolean }>(`/auth/devices/${device.id}`);
    if (result.revokedCurrentDevice) {
      localStorage.removeItem('token');
      window.dispatchEvent(new Event('paper-reader:auth-expired'));
    } else {
      setDevices((current) => current.map((item) => item.id === device.id ? { ...item, revoked: true } : item));
    }
  };

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
    <div className={`min-h-screen ${isDark ? 'bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-900'}`}>
      <header className={`sticky top-0 border-b px-4 py-3 flex items-center gap-3 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        <button onClick={() => navigate(-1)} className={isDark ? 'text-gray-300 hover:text-gray-100' : 'text-gray-700 hover:text-gray-900'}>← 返回</button>
        <h1 className={`font-bold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>AI 与设备设置</h1>
      </header>
      <main className="max-w-lg mx-auto p-4 space-y-4">
        <div className={`rounded-xl shadow-sm border p-4 space-y-4 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
          <div>
            <h2 className={`font-semibold ${isDark ? 'text-gray-100' : 'text-gray-900'}`}>DeepSeek API</h2>
            <p className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Key 通过 HTTPS 发送，并在服务器端以 AES-256-GCM 加密保存。翻译和问答会产生 API 费用。</p>
          </div>
          <label className={`block text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            API Key {settings?.configured && <span className="text-green-500">（已配置 {settings.keyHint}）</span>}
            <input
              className={`w-full px-4 py-2 border rounded-lg mt-1 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent ${isDark ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'}`}
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={settings?.configured ? '留空表示不更换' : 'sk-…'}
            />
          </label>
          <label className={`block text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            模型
            <input
              className={`w-full px-4 py-2 border rounded-lg mt-1 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent ${isDark ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'}`}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button className="btn-primary flex-1" disabled={saving} onClick={save}>保存</button>
            <button
              className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${isDark ? 'bg-gray-600 text-gray-200 hover:bg-gray-500 active:bg-gray-400' : 'bg-gray-200 text-gray-800 hover:bg-gray-300 active:bg-gray-400'}`}
              disabled={!settings?.configured}
              onClick={test}
            >
              测试连接
            </button>
          </div>
          {status && <p className={`text-sm ${status.includes('成功') || status.includes('保存') ? 'text-green-500' : isDark ? 'text-gray-400' : 'text-gray-600'}`}>{status}</p>}
        </div>

        <div className={`rounded-xl border p-4 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          <h3 className="font-bold mb-1">已配对设备</h3>
          <p className={`text-xs mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>设备令牌可以随时撤销；被撤销设备必须重新输入配对码。</p>
          <div className="space-y-2">
            {devices.filter((device) => !device.revoked).map((device) => (
              <div key={device.id} className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{device.label} {device.current && <span className="text-green-500">（当前）</span>}</p>
                  <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>最近使用：{device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : '尚未记录'}</p>
                </div>
                <button className="text-sm text-red-500 shrink-0" onClick={() => revokeDevice(device)}>撤销</button>
              </div>
            ))}
            {devices.filter((device) => !device.revoked).length === 0 && <p className="text-sm text-gray-500">开发模式或暂无持久设备记录。</p>}
          </div>
        </div>

        <div className={`rounded-xl border p-4 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          <h3 className="font-bold mb-3">复习提醒</h3>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm">每日提醒</span>
            <button
              onClick={async () => {
                if (reminderEnabled) {
                  await cancelReviewReminder();
                  setReminderEnabled(false);
                } else {
                  await scheduleReviewReminder(reminderHour);
                  setReminderEnabled(true);
                }
              }}
              className={`w-12 h-6 rounded-full transition-colors relative ${reminderEnabled ? 'bg-blue-500' : isDark ? 'bg-gray-600' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${reminderEnabled ? 'left-6' : 'left-0.5'}`} />
            </button>
          </div>
          {reminderEnabled && (
            <div className="flex items-center gap-2">
              <span className="text-sm">提醒时间:</span>
              <select
                value={reminderHour}
                onChange={async (e) => {
                  const h = parseInt(e.target.value);
                  setReminderHour(h);
                  await scheduleReviewReminder(h);
                }}
                className={`px-2 py-1 rounded-lg border text-sm ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300'}`}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{i.toString().padStart(2, '0')}:00</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
