import { describe, expect, it } from 'vitest'
import config from './capacitor.config.js'
describe('Capacitor shell',()=>{it('uses shared web build',()=>expect(config.webDir).toBe('../web/dist'));it('has production app id',()=>expect(config.appId).toBe('jp.lingoquest.app'))})
