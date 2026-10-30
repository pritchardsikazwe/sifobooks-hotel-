import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.sifobooks.hotel',
  appName: 'SifoBooks Hotel',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: { androidScheme: 'https' },
};
export default config;
