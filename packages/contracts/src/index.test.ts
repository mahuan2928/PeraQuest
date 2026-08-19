import { describe, expect, it } from 'vitest'
import { examLevels, interviewPhases } from './index.js'
describe('MVP contracts',()=>{it('exposes only Eiken Grade 3',()=>expect(examLevels).toEqual(['eiken_grade_3']));it('contains six interview phases',()=>expect(interviewPhases).toHaveLength(6))})
