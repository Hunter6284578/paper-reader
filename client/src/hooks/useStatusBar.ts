import { StatusBar, Style } from '@capacitor/status-bar';
import { useEffect } from 'react';
import { useReaderStore } from '../stores/readerStore';

// 检测是否为 Android 平台
const isAndroid = () => {
  return typeof window !== 'undefined' && 
         navigator.userAgent.toLowerCase().includes('android');
};

export const useStatusBar = () => {
  const theme = useReaderStore((s) => s.settings.theme);

  useEffect(() => {
    if (!isAndroid()) return;

    const setStatusBarStyle = async () => {
      try {
        await StatusBar.show();
        await StatusBar.setOverlaysWebView({ overlay: true }); // 沉浸式全屏
        
        // 根据阅读主题调整状态栏样式
        if (theme === 'dark') {
          await StatusBar.setStyle({ style: Style.Light }); // 浅色文字
          await StatusBar.setBackgroundColor({ color: '#1a1a1a' });
        } else {
          await StatusBar.setStyle({ style: Style.Dark }); // 深色文字
          await StatusBar.setBackgroundColor({ 
            color: theme === 'sepia' ? '#f5f0e1' : '#ffffff' 
          });
        }
      } catch (error) {
        console.error('设置状态栏失败:', error);
      }
    };

    setStatusBarStyle();
  }, [theme]);
};
