import { describe, expect, it } from 'vitest'
import { getPlatformCapabilities } from './index.js'
describe('platform capability matrix',()=>{it.each(['ios','android','desktop'] as const)('%s is installable',(runtime)=>expect(getPlatformCapabilities(runtime).installable).toBe(true));it('keeps browser storage outside secure-storage contract',()=>expect(getPlatformCapabilities('web').secureStorage).toBe(false))})
