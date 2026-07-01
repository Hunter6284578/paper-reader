import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.paperreader.app',
  appName: '论文阅读器',
  webDir: 'dist',
  server: {
    androidScheme: 'http',
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#ffffff'
    }
  }
};

export default config;
