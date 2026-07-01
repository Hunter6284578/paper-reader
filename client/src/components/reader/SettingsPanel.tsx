import { useReaderStore } from '../../stores/readerStore';
import type { ReaderTheme } from '../../types';

export default function SettingsPanel() {
  const settings = useReaderStore((s) => s.settings);
  const updateSettings = useReaderStore((s) => s.updateSettings);
  const showSettings = useReaderStore((s) => s.showSettings);
  const toggleSettings = useReaderStore((s) => s.toggleSettings);

  if (!showSettings) return null;

  const themes: { key: ReaderTheme; label: string; bg: string }[] = [
    { key: 'light', label: '白色', bg: 'bg-white border-gray-300' },
    { key: 'sepia', label: '护眼', bg: 'bg-amber-50 border-amber-300' },
    { key: 'dark', label: '夜间', bg: 'bg-gray-800 border-gray-600' },
  ];

  return (
    <>
      {/* 遮罩层 */}
      <div className="fixed inset-0 z-50 bg-black/30" onClick={toggleSettings} />

      {/* 面板 */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-72 bg-white shadow-2xl p-5 overflow-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-base font-semibold text-gray-900">阅读设置</h3>
          <button onClick={toggleSettings} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
        </div>

        {/* 主题 */}
        <div className="mb-6">
          <label className="text-sm font-medium text-gray-700 mb-2 block">主题</label>
          <div className="flex gap-3">
            {themes.map((t) => (
              <button
                key={t.key}
                onClick={() => updateSettings({ theme: t.key })}
                className={`flex-1 py-2 rounded-lg border-2 text-sm font-medium transition-all ${t.bg} ${
                  settings.theme === t.key ? 'ring-2 ring-primary-500 ring-offset-1' : ''
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* 字号 */}
        <div className="mb-6">
          <label className="text-sm font-medium text-gray-700 mb-2 block">
            字号: {settings.fontSize}px
          </label>
          <input
            type="range"
            min="14"
            max="24"
            step="1"
            value={settings.fontSize}
            onChange={(e) => updateSettings({ fontSize: parseInt(e.target.value, 10) })}
            className="w-full accent-primary-500"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>小</span>
            <span>大</span>
          </div>
        </div>

        {/* 行高 */}
        <div className="mb-6">
          <label className="text-sm font-medium text-gray-700 mb-2 block">
            行高: {settings.lineHeight.toFixed(1)}
          </label>
          <input
            type="range"
            min="1.4"
            max="2.2"
            step="0.1"
            value={settings.lineHeight}
            onChange={(e) => updateSettings({ lineHeight: parseFloat(e.target.value) })}
            className="w-full accent-primary-500"
          />
        </div>

        {/* 翻译模式 */}
        <div className="mb-6">
          <label className="text-sm font-medium text-gray-700 mb-2 block">翻译模式</label>
          <div className="flex gap-2">
            <button
              onClick={() => updateSettings({ translationMode: 'paragraph' })}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                settings.translationMode === 'paragraph'
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              逐段翻译
            </button>
            <button
              onClick={() => updateSettings({ translationMode: 'sentence' })}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                settings.translationMode === 'sentence'
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              逐句翻译
            </button>
          </div>
        </div>

        {/* 显示翻译开关 */}
        <div className="mb-4 flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">显示翻译</label>
          <button
            onClick={() => updateSettings({ showTranslation: !settings.showTranslation })}
            className={`w-11 h-6 rounded-full transition-colors ${
              settings.showTranslation ? 'bg-primary-500' : 'bg-gray-300'
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${
                settings.showTranslation ? 'translate-x-5.5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        {/* 翻译默认折叠 */}
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">翻译默认折叠</label>
          <button
            onClick={() => updateSettings({ translationCollapsed: !settings.translationCollapsed })}
            className={`w-11 h-6 rounded-full transition-colors ${
              settings.translationCollapsed ? 'bg-primary-500' : 'bg-gray-300'
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${
                settings.translationCollapsed ? 'translate-x-5.5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>
    </>
  );
}
