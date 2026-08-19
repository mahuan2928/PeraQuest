import Fastify from 'fastify'
import type { CapabilityResponse } from '@peraquest/contracts'
import { loadConfig } from './config.js'
export const buildApp=()=>{const app=Fastify({logger:false});const config=loadConfig();app.get('/health',async()=>({status:'ok' as const}));app.get('/v1/me/capabilities',async():Promise<CapabilityResponse>=>({examLevel:'eiken_grade_3',canLearn:true,canUploadVoice:config.VOICE_FEATURE_PUBLIC_ENABLED&&config.AI_VENDOR_APPROVED,canPurchase:false,consentVersionRequired:config.CONSENT_VERSION_REQUIRED}));return app}
