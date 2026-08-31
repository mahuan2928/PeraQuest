import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import type { AuthActor, UserRole } from '@peraquest/contracts'

export interface AuthConfig {
  issuer: string
  audience: string
  jwksUrl: string
  clockSkewSeconds: number
  maxTokenTtlSeconds?: number
  jwksCacheMaxAgeMs?: number
  jwksCooldownMs?: number
  jwksTimeoutMs?: number
}
export interface VerifiedTokenClaims { iss: string; aud: string | string[]; sub: string; exp: number; nbf?: number; iat?: number; jti?: string; role?: UserRole }
export interface TokenVerifier { verify(token: string, config: AuthConfig): Promise<VerifiedTokenClaims> }
export interface AuthUser { id: string; role: UserRole; disabledAt?: Date | null; deletedAt?: Date | null }
export interface AuthUserResolver { resolve(issuer: string, providerSubject: string): Promise<AuthUser | null> }
export interface AuthRequestContext { authActor: AuthActor }
export class AuthFailure extends Error { constructor(public readonly code: 'AUTH_REQUIRED' | 'AUTH_INVALID') { super(code) } }

const bearerPattern = /^Bearer[ \t]+([^ \t]+)$/i
const DEFAULT_MAX_TOKEN_TTL_SECONDS = 3600
const DEFAULT_JWKS_CACHE_MAX_AGE_MS = 10 * 60 * 1000
const DEFAULT_JWKS_COOLDOWN_MS = 30 * 1000
const DEFAULT_JWKS_TIMEOUT_MS = 5 * 1000

export const parseBearerToken = (authorization: unknown): string => {
  if (authorization === undefined) throw new AuthFailure('AUTH_REQUIRED')
  if (typeof authorization !== 'string') throw new AuthFailure('AUTH_INVALID')
  const match = bearerPattern.exec(authorization.trim())
  if (!match?.[1]) throw new AuthFailure('AUTH_INVALID')
  return match[1]
}

const hasAudience = (audience: string | string[], expected: string): boolean => Array.isArray(audience) ? audience.includes(expected) : audience === expected

export const verifyClaims = (claims: VerifiedTokenClaims, config: AuthConfig, now = Date.now()): void => {
  const skew = config.clockSkewSeconds
  const seconds = Math.floor(now / 1000)
  const maxTokenTtlSeconds = config.maxTokenTtlSeconds ?? DEFAULT_MAX_TOKEN_TTL_SECONDS
  if (claims.iss !== config.issuer || !hasAudience(claims.aud, config.audience) || typeof claims.sub !== 'string' || claims.sub.length === 0) throw new AuthFailure('AUTH_INVALID')
  const issuedAt = claims.iat
  if (!Number.isSafeInteger(claims.exp) || claims.exp <= seconds - skew) throw new AuthFailure('AUTH_INVALID')
  if (typeof issuedAt !== 'number' || !Number.isSafeInteger(issuedAt) || issuedAt > seconds + skew) throw new AuthFailure('AUTH_INVALID')
  if (claims.exp <= issuedAt || claims.exp - issuedAt > maxTokenTtlSeconds) throw new AuthFailure('AUTH_INVALID')
  if (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > seconds + skew)) throw new AuthFailure('AUTH_INVALID')
}

const claimsFromPayload = (payload: JWTPayload): VerifiedTokenClaims => {
  if (typeof payload.iss !== 'string' || (typeof payload.aud !== 'string' && !Array.isArray(payload.aud)) || typeof payload.sub !== 'string' || typeof payload.exp !== 'number' || typeof payload.iat !== 'number') {
    throw new AuthFailure('AUTH_INVALID')
  }
  return {
    iss: payload.iss,
    aud: payload.aud,
    sub: payload.sub,
    exp: payload.exp,
    ...(payload.nbf === undefined ? {} : { nbf: payload.nbf }),
    iat: payload.iat,
    ...(payload.jti === undefined ? {} : { jti: payload.jti }),
  }
}

export const createJwksTokenVerifier = (config: AuthConfig): TokenVerifier => {
  const jwks = createRemoteJWKSet(new URL(config.jwksUrl), {
    cacheMaxAge: config.jwksCacheMaxAgeMs ?? DEFAULT_JWKS_CACHE_MAX_AGE_MS,
    cooldownDuration: config.jwksCooldownMs ?? DEFAULT_JWKS_COOLDOWN_MS,
    timeoutDuration: config.jwksTimeoutMs ?? DEFAULT_JWKS_TIMEOUT_MS,
  })
  return {
    async verify(token: string): Promise<VerifiedTokenClaims> {
      try {
        const { payload } = await jwtVerify(token, jwks, {
          algorithms: ['RS256'],
          issuer: config.issuer,
          audience: config.audience,
          clockTolerance: config.clockSkewSeconds,
          requiredClaims: ['exp', 'iat', 'sub'],
          maxTokenAge: config.maxTokenTtlSeconds ?? DEFAULT_MAX_TOKEN_TTL_SECONDS,
        })
        const claims = claimsFromPayload(payload)
        verifyClaims(claims, config)
        return claims
      } catch {
        // Never preserve provider errors: they can include key ids, URLs, claims, or token fragments.
        throw new AuthFailure('AUTH_INVALID')
      }
    },
  }
}

export const createAuthActor = async (token: string, config: AuthConfig, verifier: TokenVerifier, resolver: AuthUserResolver, now?: () => number): Promise<AuthActor> => {
  let claims: VerifiedTokenClaims
  try {
    claims = await verifier.verify(token, config)
    verifyClaims(claims, config, now?.() ?? Date.now())
  } catch {
    throw new AuthFailure('AUTH_INVALID')
  }
  const user = await resolver.resolve(config.issuer, claims.sub)
  if (!user || user.disabledAt || user.deletedAt) throw new AuthFailure('AUTH_INVALID')
  return { id: user.id, role: user.role, method: 'bearer', providerSubject: claims.sub }
}

export const legacyActor = (headers: Record<string, unknown>): AuthActor | null => {
  const guardian = headers['x-guardian-id']
  const student = headers['x-student-id']
  if (typeof guardian === 'string' && guardian.length > 0) return { id: guardian, role: 'guardian', method: 'legacy_guardian_header' }
  if (typeof student === 'string' && student.length > 0) return { id: student, role: 'student', method: 'legacy_student_header' }
  return null
}

declare module 'fastify' { interface FastifyRequest { authActor: AuthActor } }
