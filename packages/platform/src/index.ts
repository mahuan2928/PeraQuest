export type RuntimePlatform = 'web' | 'ios' | 'android' | 'desktop'
export interface PlatformCapabilities { runtime: RuntimePlatform; installable: boolean; microphone: boolean; pushNotifications: boolean; deepLinks: boolean; secureStorage: boolean; backgroundDelivery: boolean; automaticUpdates: boolean }
const matrix: Record<RuntimePlatform, PlatformCapabilities> = {
  web:{runtime:'web',installable:false,microphone:true,pushNotifications:false,deepLinks:true,secureStorage:false,backgroundDelivery:false,automaticUpdates:true},
  ios:{runtime:'ios',installable:true,microphone:true,pushNotifications:true,deepLinks:true,secureStorage:true,backgroundDelivery:true,automaticUpdates:true},
  android:{runtime:'android',installable:true,microphone:true,pushNotifications:true,deepLinks:true,secureStorage:true,backgroundDelivery:true,automaticUpdates:true},
  desktop:{runtime:'desktop',installable:true,microphone:true,pushNotifications:true,deepLinks:true,secureStorage:true,backgroundDelivery:true,automaticUpdates:true}
}
export const getPlatformCapabilities=(runtime:RuntimePlatform):PlatformCapabilities=>matrix[runtime]
