import type { AuthActor, UserRole } from '@peraquest/contracts'

export interface AuthConfig { issuer: string; audience: string; jwksUrl: string; clockSkewSeconds: number }
export interface VerifiedTokenClaims { iss: string; aud: string | string[]; sub: string; exp: number; nbf?: number; iat?: number; jti?: string; role?: UserRole }
export interface TokenVerifier { verify(token: string, config: AuthConfig): Promise<VerifiedTokenClaims> }
export interface AuthUser { id: string; role: UserRole; disabledAt?: Date | null; deletedAt?: Date | null }
export interface AuthUserResolver { resolve(issuer: string, providerSubject: string): Promise<AuthUser | null> }
export interface AuthRequestContext { authActor: AuthActor }
export class AuthFailure extends Error { constructor(public readonly code: 'AUTH_REQUIRED' | 'AUTH_INVALID') { super(code) } }
const bearerPattern = /^Bearer[ \t]+([^ \t]+)$/i
export const parseBearerToken = (authorization: unknown): string => { if (authorization === undefined) throw new AuthFailure('AUTH_REQUIRED'); if (typeof authorization !== 'string') throw new AuthFailure('AUTH_INVALID'); const match = bearerPattern.exec(authorization.trim()); if (!match?.[1]) throw new AuthFailure('AUTH_INVALID'); return match[1] }
const hasAudience = (audience: string | string[], expected: string): boolean => Array.isArray(audience) ? audience.includes(expected) : audience === expected
export const verifyClaims = (claims: VerifiedTokenClaims, config: AuthConfig, now = Date.now()): void => { if (claims.iss !== config.issuer || !hasAudience(claims.aud, config.audience) || typeof claims.sub !== 'string' || claims.sub.length === 0) throw new AuthFailure('AUTH_INVALID'); const skew = config.clockSkewSeconds; const seconds = Math.floor(now / 1000); if (!Number.isFinite(claims.exp) || claims.exp < seconds - skew) throw new AuthFailure('AUTH_INVALID'); if (claims.nbf !== undefined && claims.nbf > seconds + skew) throw new AuthFailure('AUTH_INVALID') }
export const createAuthActor = async (token: string, config: AuthConfig, verifier: TokenVerifier, resolver: AuthUserResolver, now?: () => number): Promise<AuthActor> => { let claims: VerifiedTokenClaims; try { claims = await verifier.verify(token, config); verifyClaims(claims, config, now?.() ?? Date.now()) } catch { throw new AuthFailure('AUTH_INVALID') } const user = await resolver.resolve(config.issuer, claims.sub); if (!user || user.disabledAt || user.deletedAt) throw new AuthFailure('AUTH_INVALID'); return { id: user.id, role: user.role, method: 'bearer' } }
export const legacyActor = (headers: Record<string, unknown>): AuthActor | null => { const guardian = headers['x-guardian-id']; const student = headers['x-student-id']; if (typeof guardian === 'string' && guardian.length > 0) return { id: guardian, role: 'guardian', method: 'legacy_guardian_header' }; if (typeof student === 'string' && student.length > 0) return { id: student, role: 'student', method: 'legacy_student_header' }; return null }
export const defaultTokenVerifier: TokenVerifier = { async verify(): Promise<VerifiedTokenClaims> { throw new AuthFailure('AUTH_INVALID') } }

declare module 'fastify' { interface FastifyRequest { authActor: AuthActor } }
