import { App } from '@capacitor/app';
import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

// 检测是否为 Android 平台
const isAndroid = () => {
  return typeof window !== 'undefined' && 
         navigator.userAgent.toLowerCase().includes('android');
};

export const useBackButton = () => {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isAndroid()) return;

    const handleBackButton = async () => {
      if (location.pathname === '/') {
        // 首页：退出应用
        await App.exitApp();
      } else {
        // 其他页面：返回上一页
        navigate(-1);
      }
    };

    App.addListener('backButton', handleBackButton);
    return () => {
      App.removeAllListeners();
    };
  }, [navigate, location]);
};
