import { supabase } from '../../../lib/supabase';

export type ProviderResultStatus =
  | 'SUCCESS'
  | 'FAILED'
  | 'REJECTED'
  | 'ERROR'
  | 'NOT_CONFIGURED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'NO_FACE_DETECTED'
  | 'MULTIPLE_FACES_DETECTED'
  | 'FACE_NOT_MATCHED'
  | 'AWS_SERVICE_ERROR'
  | 'AWS_ACCESS_DENIED'
  | 'AWS_COLLECTION_NOT_FOUND'
  | 'INVALID_IMAGE'
  | 'DATABASE_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'PROVIDER_ERROR';

export interface ProviderVerificationResult {
  status: ProviderResultStatus;
  providerReference?: string;
  confidenceScore?: number;
  failureReason?: string;
}

export interface ProviderRegistrationResult {
  status: ProviderResultStatus;
  providerReference?: string;
  failureReason?: string;
}

export interface IFaceVerificationProvider {
  isConfigured(): boolean;
  registerFace(employeeId: string, imageBase64: string, metadata?: any): Promise<ProviderRegistrationResult>;
  verifyFace(employeeId: string, registrationId: string, imageBase64: string, metadata?: any): Promise<ProviderVerificationResult>;
}

/**
 * Map raw provider status codes to user-friendly messages.
 * These are safe to show in the UI — no secrets or technical details.
 */
function getUserFriendlyMessage(status: string, rawReason?: string): string {
  switch (status) {
    case 'PROVIDER_NOT_CONFIGURED':
      return 'Face verification service is not configured. Please contact your administrator.';
    case 'NO_FACE_DETECTED':
      return rawReason || 'No face detected. Please position your face clearly in the frame.';
    case 'MULTIPLE_FACES_DETECTED':
      return rawReason || 'Multiple faces detected. Only one person should be visible.';
    case 'FACE_NOT_MATCHED':
      return rawReason || 'Face does not match the registered profile.';
    case 'AWS_ACCESS_DENIED':
      return 'Face verification service permission error. Please contact your administrator.';
    case 'AWS_COLLECTION_NOT_FOUND':
      return 'Face verification service configuration is invalid. Please contact your administrator.';
    case 'INVALID_IMAGE':
      return rawReason || 'Invalid face image. Please capture a clear photo and try again.';
    case 'AUTHENTICATION_ERROR':
      return 'Authentication failed. Please log in again.';
    case 'AWS_SERVICE_ERROR':
    case 'PROVIDER_ERROR':
      return rawReason || 'Face verification service encountered an error. Please try again.';
    default:
      return rawReason || 'Face verification failed. Please try again.';
  }
}

export const faceVerificationProvider: IFaceVerificationProvider = {
  isConfigured(): boolean {
    return true; // We rely on the secure backend checking the edge function secrets.
  },

  async registerFace(employeeId: string, imageBase64: string, metadata?: any): Promise<ProviderRegistrationResult> {
    const { data, error } = await supabase.functions.invoke('face-verification', {
      body: { action: 'REGISTER', employeeId, imageBase64 }
    });

    if (error) {
      console.error('[faceVerificationProvider] registerFace invoke error:', error.message);
      return {
        status: 'ERROR',
        failureReason: 'Unable to reach face verification service. Please check your connection and try again.',
      };
    }

    if (!data || !data.status) {
      return {
        status: 'ERROR',
        failureReason: 'Face verification service returned an unexpected response.',
      };
    }

    if (data.status === 'PROVIDER_NOT_CONFIGURED') {
      return { status: 'NOT_CONFIGURED', failureReason: getUserFriendlyMessage(data.status, data.failureReason) };
    }

    return {
      status: data.status as ProviderResultStatus,
      providerReference: data.providerReference,
      failureReason: data.status !== 'SUCCESS'
        ? getUserFriendlyMessage(data.status, data.failureReason)
        : undefined,
    };
  },

  async verifyFace(employeeId: string, registrationId: string, imageBase64: string, metadata?: any): Promise<ProviderVerificationResult> {
    const { data, error } = await supabase.functions.invoke('face-verification', {
      body: { action: 'VERIFY', employeeId, imageBase64, registrationId }
    });

    if (error) {
      console.error('[faceVerificationProvider] verifyFace invoke error:', error.message);
      return {
        status: 'ERROR',
        failureReason: 'Unable to reach face verification service. Please check your connection and try again.',
      };
    }

    if (!data || !data.status) {
      return {
        status: 'ERROR',
        failureReason: 'Face verification service returned an unexpected response.',
      };
    }

    if (data.status === 'PROVIDER_NOT_CONFIGURED') {
      return { status: 'NOT_CONFIGURED', failureReason: getUserFriendlyMessage(data.status, data.failureReason) };
    }

    return {
      status: data.status as ProviderResultStatus,
      confidenceScore: data.confidenceScore,
      failureReason: data.status !== 'SUCCESS'
        ? getUserFriendlyMessage(data.status, data.failureReason)
        : undefined,
    };
  }
};
