import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.caloriq.mobile',
  appName: 'Calor-IQ',
  webDir: 'out',
  server: {
    url: 'https://calor-iq.com',
    cleartext: false,
  },
};
export default config;