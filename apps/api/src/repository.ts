import type { ConsentStatus, GuardianLinkStatus } from '@peraquest/contracts'

export interface StudentRecord {
  id: string
  birthMonth: string
  isMinor: boolean
  guardianLinkStatus: GuardianLinkStatus
  guardianId: string | null
}

export interface ConsentRecord {
  status: ConsentStatus
  version: string | null
}

export interface TrialSessionRecord {
  id: string
  studentId: string
  answers: Map<string, boolean>
  completed: boolean
}

export interface StudentRepository {
  create(student: StudentRecord): Promise<void>
  findById(id: string): Promise<StudentRecord | null>
  getVoiceConsent(studentId: string, requiredVersion: string): Promise<ConsentRecord>
  setVoiceConsent(studentId: string, status: Exclude<ConsentStatus, 'missing' | 'outdated'>, version: string): Promise<ConsentRecord>
  hasRedeemedTrial(studentId: string): Promise<boolean>
  createTrialSession(session: TrialSessionRecord): Promise<void>
  findTrialSession(sessionId: string): Promise<TrialSessionRecord | null>
  completeTrialSession(sessionId: string): Promise<void>
}

export class MemoryStudentRepository implements StudentRepository {
  private readonly students = new Map<string, StudentRecord>()
  private readonly consents = new Map<string, ConsentRecord>()
  private readonly trialSessions = new Map<string, TrialSessionRecord>()
  private readonly trialRedemptions = new Set<string>()

  async create(student: StudentRecord): Promise<void> {
    this.students.set(student.id, student)
  }

  async findById(id: string): Promise<StudentRecord | null> {
    return this.students.get(id) ?? null
  }

  async getVoiceConsent(studentId: string, requiredVersion: string): Promise<ConsentRecord> {
    const consent = this.consents.get(studentId)
    if (!consent) return { status: 'missing', version: null }
    if (consent.status === 'granted' && consent.version !== requiredVersion) return { ...consent, status: 'outdated' }
    return consent
  }

  async setVoiceConsent(studentId: string, status: Exclude<ConsentStatus, 'missing' | 'outdated'>, version: string): Promise<ConsentRecord> {
    const consent = { status, version }
    this.consents.set(studentId, consent)
    return consent
  }

  async hasRedeemedTrial(studentId: string): Promise<boolean> {
    return this.trialRedemptions.has(studentId)
  }

  async createTrialSession(session: TrialSessionRecord): Promise<void> {
    this.trialSessions.set(session.id, session)
  }

  async findTrialSession(sessionId: string): Promise<TrialSessionRecord | null> {
    return this.trialSessions.get(sessionId) ?? null
  }

  async completeTrialSession(sessionId: string): Promise<void> {
    const session = this.trialSessions.get(sessionId)
    if (!session) return
    session.completed = true
    this.trialRedemptions.add(session.studentId)
  }
}
