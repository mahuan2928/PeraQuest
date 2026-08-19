import { describe, expect, it } from 'vitest'
import packageJson from './package.json'
describe('desktop packaging',()=>{it('produces Windows, macOS and Linux installers',()=>{expect(packageJson.build.win.target).toContain('nsis');expect(packageJson.build.mac.target).toContain('dmg');expect(packageJson.build.linux.target).toContain('AppImage')})})
