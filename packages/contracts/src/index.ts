export const examLevels=['eiken_grade_3'] as const
export type ExamLevel=(typeof examLevels)[number]
export const interviewPhases=['greeting','reading_aloud','passage_questions','picture_questions','personal_questions','result'] as const
export type InterviewPhase=(typeof interviewPhases)[number]
export interface CapabilityResponse{examLevel:ExamLevel;canLearn:boolean;canUploadVoice:boolean;canPurchase:boolean;consentVersionRequired:string}
