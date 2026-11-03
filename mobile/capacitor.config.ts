import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.concord.app',
  appName: 'Concord',
  webDir: '../desktop-app/dist-mobile',
  android: {
    allowMixedContent: true
  }
}

export default config
