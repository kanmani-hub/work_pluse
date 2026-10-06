import { supabase } from '../../lib/supabase';
import type { Database } from '../../types/database';
import { faceVerificationProvider } from './providers/faceVerificationProvider';

export type FaceRegistrationRow = Database['public']['Tables']['face_registrations']['Row'];
export type FaceVerificationEventRow = Database['public']['Tables']['face_verification_events']['Row'];

export const faceService = {
  /**
   * Helper to securely get current employee identity.
   */
  async getCurrentEmployeeId(): Promise<string | null> {
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData.user) return null;
    
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('employee_id')
      .eq('auth_user_id', authData.user.id)
      .single() as any;
      
    if (profErr || !profile?.employee_id) return null;
    return profile.employee_id;
  },

  /**
   * Get registration for the current authenticated employee
   */
  async getMyFaceRegistration(): Promise<{ data: FaceRegistrationRow | null; error: Error | null }> {
    const empId = await this.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Unauthorized') };

    return this.getFaceRegistration(empId);
  },

  /**
   * Get a specific employee's active registration (Admin or self)
   */
  async getFaceRegistration(employeeId: string): Promise<{ data: FaceRegistrationRow | null; error: Error | null }> {
    const { data, error } = await supabase
      .from('face_registrations')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('is_active', true)
      .maybeSingle() as any;

    if (error) return { data: null, error: new Error(error.message) };
    return { data, error: null };
  },

  /**
   * Admin: Initiate face registration for an employee
   */
  async registerFaceAdmin(employeeId: string, imageBase64: string): Promise<{ data: FaceRegistrationRow | null; error: Error | null }> {
    const adminEmpId = await this.getCurrentEmployeeId();
    if (!adminEmpId) return { data: null, error: new Error('Unauthorized') };

    // 1. Check existing
    const { data: existing } = await this.getFaceRegistration(employeeId);
    if (existing) {
      // Typically we'd revoke it first or return an error depending on policy.
      // For safety, we prevent multiple active ones.
      return { data: null, error: new Error('Active registration already exists. Must revoke first.') };
    }

    // 2. Call provider
    const providerResult = await faceVerificationProvider.registerFace(employeeId, imageBase64);
    
    if (providerResult.status === 'NOT_CONFIGURED') {
      return { data: null, error: new Error('Real face provider configuration is pending.') };
    }

    if (providerResult.status !== 'SUCCESS') {
      return { data: null, error: new Error(`Provider failed: ${providerResult.failureReason}`) };
    }

    // 3. Store registration metadata (no raw biometrics)
    // Removed: The Supabase Edge Function 'face-verification' now securely handles the DB insert 
    // using the service_role key to prevent RLS violations and spoofing.

    import('../audit/auditService').then(({ auditService }) => {
      auditService.recordAuditLog({
        action: 'FACE_REGISTERED',
        module: 'SECURITY',
        entity_type: 'employees',
        entity_id: employeeId,
        description: `Face registered via ${providerResult.providerReference || 'AWS'}`
      }).catch(e => console.error('[AUDIT]', e));
    });

    return { 
      data: {
        id: 'handled-by-backend', // Dummy ID since we don't query the created record back immediately
        employee_id: employeeId,
        provider: 'AWS_REKOGNITION',
        provider_reference: providerResult.providerReference || null,
        registration_status: 'REGISTERED',
        is_active: true
      } as any, 
      error: null 
    };
  },

  /**
   * Admin: Revoke face registration
   */
  async revokeFaceRegistration(registrationId: string): Promise<{ success: boolean; error: Error | null }> {
    // @ts-ignore
    const { error } = await (supabase.from('face_registrations') as any)
      .update({
        is_active: false,
        registration_status: 'REVOKED'
      } as any)
      .eq('id', registrationId);

    if (error) return { success: false, error: new Error(error.message) };
    return { success: true, error: null };
  },

  /**
   * Create verification event for attendance (Clock In/Out)
   * Ensures that face validation is correctly linked to the provider.
   */
  async verifyFaceForAttendance(type: 'CLOCK_IN' | 'CLOCK_OUT' | 'REGISTRATION', imageBase64: string, metadata?: any): Promise<{ eventId: string | null; error: Error | null }> {
    const empId = await this.getCurrentEmployeeId();
    if (!empId) return { eventId: null, error: new Error('Unauthorized') };

    // 1. Get active registration
    const { data: reg } = await this.getFaceRegistration(empId);
    if (!reg) {
      return { eventId: null, error: new Error('Face registration is required before clock-in.') };
    }
    if (reg.registration_status === 'REVOKED' || !reg.is_active) {
      return { eventId: null, error: new Error('Face registration is inactive or revoked.') };
    }

    // 2. Provider verification
    const providerResult = await faceVerificationProvider.verifyFace(empId, reg.id, imageBase64, metadata);

    // 3. Handle NO PROVIDER gracefully
    if (providerResult.status === 'NOT_CONFIGURED') {
      // Return clear error without inserting a fake SUCCESS event
      return { eventId: null, error: new Error('Real provider configuration is pending.') };
    }

    // 4. If configured, log the result
    const nowIso = new Date().toISOString();
    // @ts-ignore
    const { data: eventResult, error: insertErr } = await supabase
      .from('face_verification_events')
      .insert({
        employee_id: empId,
        face_registration_id: reg.id,
        verification_type: type,
        result: providerResult.status,
        verified_at: nowIso,
        confidence_score: providerResult.confidenceScore || null,
        provider: 'DEFAULT_PROVIDER',
        provider_reference: providerResult.providerReference || null,
        failure_reason: providerResult.failureReason || null,
        source: 'WEB'
      } as any)
      .select('id')
      .single() as any;

    if (insertErr) {
      return { eventId: null, error: new Error(insertErr.message) };
    }

    if (providerResult.status !== 'SUCCESS') {
      import('../audit/auditService').then(({ auditService }) => {
        auditService.recordAuditLog({
          action: 'FACE_VERIFICATION_FAILED',
          module: 'SECURITY',
          description: `Face verification failed: ${providerResult.failureReason}`
        }).catch(e => console.error('[AUDIT]', e));
      });
      return { eventId: eventResult.id, error: new Error(`Face verification failed: ${providerResult.failureReason}`) };
    }

    import('../audit/auditService').then(({ auditService }) => {
      auditService.recordAuditLog({
        action: 'FACE_VERIFICATION_SUCCESS',
        module: 'SECURITY',
        description: `Face verification succeeded`
      }).catch(e => console.error('[AUDIT]', e));
    });

    return { eventId: eventResult.id, error: null };
  },

  /**
   * Get face verification history
   */
  async getFaceVerificationHistory(employeeId?: string): Promise<{ data: FaceVerificationEventRow[] | null; error: Error | null }> {
    let targetEmpId = employeeId;
    if (!targetEmpId) {
      targetEmpId = await this.getCurrentEmployeeId() || undefined;
    }
    if (!targetEmpId) return { data: null, error: new Error('Unauthorized') };

    const { data, error } = await supabase
      .from('face_verification_events')
      .select('*')
      .eq('employee_id', targetEmpId)
      .order('verified_at', { ascending: false });

    if (error) return { data: null, error: new Error(error.message) };
    return { data, error: null };
  }
};
