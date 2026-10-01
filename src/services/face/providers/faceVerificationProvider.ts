import { supabase } from '../../../lib/supabase';

export type ProviderResultStatus = 'SUCCESS' | 'FAILED' | 'REJECTED' | 'ERROR' | 'NOT_CONFIGURED' | 'PROVIDER_NOT_CONFIGURED' | 'NO_FACE_DETECTED' | 'MULTIPLE_FACES' | 'FACE_NOT_MATCHED' | 'AWS_SERVICE_ERROR';

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

export const faceVerificationProvider: IFaceVerificationProvider = {
  isConfigured(): boolean {
    return true; // We rely on the secure backend checking the edge function secrets.
  },

  async registerFace(employeeId: string, imageBase64: string, metadata?: any): Promise<ProviderRegistrationResult> {
    const { data, error } = await supabase.functions.invoke('face-verification', {
      body: { action: 'REGISTER', employeeId, imageBase64 }
    });

    if (error) {
      return { status: 'ERROR', failureReason: error.message };
    }
    
    if (data.status === 'PROVIDER_NOT_CONFIGURED') {
      return { status: 'NOT_CONFIGURED', failureReason: data.failureReason };
    }

    return {
      status: data.status as ProviderResultStatus,
      providerReference: data.providerReference,
      failureReason: data.failureReason
    };
  },

  async verifyFace(employeeId: string, registrationId: string, imageBase64: string, metadata?: any): Promise<ProviderVerificationResult> {
    const { data, error } = await supabase.functions.invoke('face-verification', {
      body: { action: 'VERIFY', employeeId, imageBase64, registrationId }
    });

    if (error) {
      return { status: 'ERROR', failureReason: error.message };
    }

    if (data.status === 'PROVIDER_NOT_CONFIGURED') {
      return { status: 'NOT_CONFIGURED', failureReason: data.failureReason };
    }

    return {
      status: data.status as ProviderResultStatus,
      confidenceScore: data.confidenceScore,
      failureReason: data.failureReason
    };
  }
};
