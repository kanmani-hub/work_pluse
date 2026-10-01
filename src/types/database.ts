export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      roles: {
        Row: {
          id: string
          name: string
          description: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      departments: {
        Row: {
          id: string
          name: string
          description: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      offices: {
        Row: {
          id: string
          name: string
          address: string | null
          latitude: number | null
          longitude: number | null
          geofence_radius: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          address?: string | null
          latitude?: number | null
          longitude?: number | null
          geofence_radius?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          address?: string | null
          latitude?: number | null
          longitude?: number | null
          geofence_radius?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      employees: {
        Row: {
          id: string
          employee_code: string
          first_name: string
          last_name: string
          email: string
          phone: string | null
          date_of_birth: string | null
          joining_date: string
          department_id: string | null
          office_id: string | null
          role_id: string | null
          designation: string | null
          employment_type: string | null
          status: string
          profile_photo_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          employee_code: string
          first_name: string
          last_name: string
          email: string
          phone?: string | null
          date_of_birth?: string | null
          joining_date: string
          department_id?: string | null
          office_id?: string | null
          role_id?: string | null
          designation?: string | null
          employment_type?: string | null
          status?: string
          profile_photo_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          employee_code?: string
          first_name?: string
          last_name?: string
          email?: string
          phone?: string | null
          date_of_birth?: string | null
          joining_date?: string
          department_id?: string | null
          office_id?: string | null
          role_id?: string | null
          designation?: string | null
          employment_type?: string | null
          status?: string
          profile_photo_url?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      profiles: {
        Row: {
          id: string
          auth_user_id: string
          employee_id: string | null
          role_id: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          auth_user_id: string
          employee_id?: string | null
          role_id?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          auth_user_id?: string
          employee_id?: string | null
          role_id?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      shift_templates: {
        Row: {
          id: string
          name: string
          code: string
          shift_type: string
          start_time: string
          end_time: string
          crosses_midnight: boolean
          required_hours: number
          break_duration_minutes: number
          grace_period_minutes: number
          late_threshold_minutes: number
          early_logout_threshold_minutes: number
          auto_logout_enabled: boolean
          auto_logout_after_minutes: number | null
          is_wfh_allowed: boolean
          is_active: boolean
          description: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          code: string
          shift_type: string
          start_time: string
          end_time: string
          crosses_midnight?: boolean
          required_hours: number
          break_duration_minutes?: number
          grace_period_minutes?: number
          late_threshold_minutes?: number
          early_logout_threshold_minutes?: number
          auto_logout_enabled?: boolean
          auto_logout_after_minutes?: number | null
          is_wfh_allowed?: boolean
          is_active?: boolean
          description?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          code?: string
          shift_type?: string
          start_time?: string
          end_time?: string
          crosses_midnight?: boolean
          required_hours?: number
          break_duration_minutes?: number
          grace_period_minutes?: number
          late_threshold_minutes?: number
          early_logout_threshold_minutes?: number
          auto_logout_enabled?: boolean
          auto_logout_after_minutes?: number | null
          is_wfh_allowed?: boolean
          is_active?: boolean
          description?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      shift_assignments: {
        Row: {
          id: string
          employee_id: string
          shift_template_id: string
          effective_date: string
          end_date: string | null
          assignment_type: string
          notes: string | null
          assigned_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          employee_id: string
          shift_template_id: string
          effective_date: string
          end_date?: string | null
          assignment_type: string
          notes?: string | null
          assigned_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          employee_id?: string
          shift_template_id?: string
          effective_date?: string
          end_date?: string | null
          assignment_type?: string
          notes?: string | null
          assigned_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      rosters: {
        Row: {
          id: string
          name: string
          start_date: string
          end_date: string
          description: string | null
          status: string
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          start_date: string
          end_date: string
          description?: string | null
          status?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          start_date?: string
          end_date?: string
          description?: string | null
          status?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      roster_assignments: {
        Row: {
          id: string
          roster_id: string
          employee_id: string
          shift_template_id: string
          assignment_date: string
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          roster_id: string
          employee_id: string
          shift_template_id: string
          assignment_date: string
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          roster_id?: string
          employee_id?: string
          shift_template_id?: string
          assignment_date?: string
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      attendance: {
        Row: {
          id: string
          employee_id: string
          shift_template_id: string | null
          shift_assignment_id: string | null
          roster_assignment_id: string | null
          attendance_date: string
          clock_in_at: string | null
          clock_out_at: string | null
          required_hours: number
          worked_hours: number | null
          break_minutes: number
          status: string
          late_minutes: number
          early_logout_minutes: number
          is_half_day: boolean
          is_auto_logged_out: boolean
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          employee_id: string
          shift_template_id?: string | null
          shift_assignment_id?: string | null
          roster_assignment_id?: string | null
          attendance_date: string
          clock_in_at?: string | null
          clock_out_at?: string | null
          required_hours: number
          worked_hours?: number | null
          break_minutes?: number
          status: string
          late_minutes?: number
          early_logout_minutes?: number
          is_half_day?: boolean
          is_auto_logged_out?: boolean
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          employee_id?: string
          shift_template_id?: string | null
          shift_assignment_id?: string | null
          roster_assignment_id?: string | null
          attendance_date?: string
          clock_in_at?: string | null
          clock_out_at?: string | null
          required_hours?: number
          worked_hours?: number | null
          break_minutes?: number
          status?: string
          late_minutes?: number
          early_logout_minutes?: number
          is_half_day?: boolean
          is_auto_logged_out?: boolean
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      attendance_breaks: {
        Row: {
          id: string
          attendance_id: string
          employee_id: string
          break_type: string
          started_at: string
          ended_at: string | null
          duration_minutes: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          attendance_id: string
          employee_id: string
          break_type: string
          started_at: string
          ended_at?: string | null
          duration_minutes?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          attendance_id?: string
          employee_id?: string
          break_type?: string
          started_at?: string
          ended_at?: string | null
          duration_minutes?: number | null
          created_at?: string
          updated_at?: string
        }
      }
      attendance_events: {
        Row: {
          id: string
          attendance_id: string
          employee_id: string
          event_type: string
          event_at: string
          source: string
          metadata: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          attendance_id: string
          employee_id: string
          event_type: string
          event_at: string
          source: string
          metadata?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          attendance_id?: string
          employee_id?: string
          event_type?: string
          event_at?: string
          source?: string
          metadata?: Json | null
          created_at?: string
        }
      }
      wfh_requests: {
        Row: {
          id: string
          employee_id: string
          request_date: string
          reason: string
          status: string
          requested_at: string
          reviewed_by: string | null
          reviewed_at: string | null
          reviewer_remarks: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          employee_id: string
          request_date: string
          reason: string
          status?: string
          requested_at?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          reviewer_remarks?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          employee_id?: string
          request_date?: string
          reason?: string
          status?: string
          requested_at?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          reviewer_remarks?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      leave_types: {
        Row: {
          id: string
          name: string
          code: string
          description: string | null
          annual_allocation: number
          carry_forward_allowed: boolean
          max_carry_forward_days: number | null
          requires_document: boolean
          is_paid: boolean
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          code: string
          description?: string | null
          annual_allocation?: number
          carry_forward_allowed?: boolean
          max_carry_forward_days?: number | null
          requires_document?: boolean
          is_paid?: boolean
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          code?: string
          description?: string | null
          annual_allocation?: number
          carry_forward_allowed?: boolean
          max_carry_forward_days?: number | null
          requires_document?: boolean
          is_paid?: boolean
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      leave_balances: {
        Row: {
          id: string
          employee_id: string
          leave_type_id: string
          year: number
          allocated_days: number
          used_days: number
          pending_days: number
          remaining_days: number
          carry_forward_days: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          employee_id: string
          leave_type_id: string
          year: number
          allocated_days?: number
          used_days?: number
          pending_days?: number
          remaining_days?: number
          carry_forward_days?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          employee_id?: string
          leave_type_id?: string
          year?: number
          allocated_days?: number
          used_days?: number
          pending_days?: number
          remaining_days?: number
          carry_forward_days?: number
          created_at?: string
          updated_at?: string
        }
      }
      leave_requests: {
        Row: {
          id: string
          employee_id: string
          leave_type_id: string
          start_date: string
          end_date: string
          total_days: number
          is_half_day: boolean
          half_day_type: string | null
          reason: string
          status: string
          requested_at: string
          reviewed_by: string | null
          reviewed_at: string | null
          reviewer_remarks: string | null
          attachment_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          employee_id: string
          leave_type_id: string
          start_date: string
          end_date: string
          total_days: number
          is_half_day?: boolean
          half_day_type?: string | null
          reason: string
          status?: string
          requested_at?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          reviewer_remarks?: string | null
          attachment_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          employee_id?: string
          leave_type_id?: string
          start_date?: string
          end_date?: string
          total_days?: number
          is_half_day?: boolean
          half_day_type?: string | null
          reason?: string
          status?: string
          requested_at?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          reviewer_remarks?: string | null
          attachment_url?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      permission_requests: {
        Row: {
          id: string
          employee_id: string
          permission_date: string
          start_time: string
          end_time: string
          duration_minutes: number
          reason: string
          status: string
          requested_at: string
          reviewed_by: string | null
          reviewed_at: string | null
          reviewer_remarks: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          employee_id: string
          permission_date: string
          start_time: string
          end_time: string
          duration_minutes: number
          reason: string
          status?: string
          requested_at?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          reviewer_remarks?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          employee_id?: string
          permission_date?: string
          start_time?: string
          end_time?: string
          duration_minutes?: number
          reason?: string
          status?: string
          requested_at?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          reviewer_remarks?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      salary_structures: {
        Row: {
          id: string
          employee_id: string
          effective_from: string
          effective_to: string | null
          basic_salary: number
          hra: number
          transport_allowance: number
          medical_allowance: number
          special_allowance: number
          other_allowances: number
          standard_deduction: number
          overtime_rate_per_hour: number
          currency: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          employee_id: string
          effective_from: string
          effective_to?: string | null
          basic_salary: number
          hra?: number
          transport_allowance?: number
          medical_allowance?: number
          special_allowance?: number
          other_allowances?: number
          standard_deduction?: number
          overtime_rate_per_hour?: number
          currency?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          employee_id?: string
          effective_from?: string
          effective_to?: string | null
          basic_salary?: number
          hra?: number
          transport_allowance?: number
          medical_allowance?: number
          special_allowance?: number
          other_allowances?: number
          standard_deduction?: number
          overtime_rate_per_hour?: number
          currency?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      payroll: {
        Row: {
          id: string
          employee_id: string
          payroll_year: number
          payroll_month: number
          period_start: string
          period_end: string
          basic_salary: number
          gross_salary: number
          total_allowances: number
          total_deductions: number
          lop_deduction: number
          overtime_amount: number
          net_salary: number
          status: string
          calculated_at: string | null
          approved_at: string | null
          approved_by: string | null
          locked_at: string | null
          remarks: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          employee_id: string
          payroll_year: number
          payroll_month: number
          period_start: string
          period_end: string
          basic_salary: number
          gross_salary: number
          total_allowances: number
          total_deductions: number
          lop_deduction?: number
          overtime_amount?: number
          net_salary: number
          status?: string
          calculated_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          locked_at?: string | null
          remarks?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          employee_id?: string
          payroll_year?: number
          payroll_month?: number
          period_start?: string
          period_end?: string
          basic_salary?: number
          gross_salary?: number
          total_allowances?: number
          total_deductions?: number
          lop_deduction?: number
          overtime_amount?: number
          net_salary?: number
          status?: string
          calculated_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          locked_at?: string | null
          remarks?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      payroll_items: {
        Row: {
          id: string
          payroll_id: string
          item_type: string
          item_name: string
          amount: number
          calculation_basis: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          payroll_id: string
          item_type: string
          item_name: string
          amount: number
          calculation_basis?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          payroll_id?: string
          item_type?: string
          item_name?: string
          amount?: number
          calculation_basis?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      payroll_payments: {
        Row: {
          id: string
          payroll_id: string
          paid_at: string
          amount: number
          payment_method: string
          transaction_reference: string | null
          remarks: string | null
          paid_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          payroll_id: string
          paid_at: string
          amount: number
          payment_method: string
          transaction_reference?: string | null
          remarks?: string | null
          paid_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          payroll_id?: string
          paid_at?: string
          amount?: number
          payment_method?: string
          transaction_reference?: string | null
          remarks?: string | null
          paid_by?: string
          created_at?: string
          updated_at?: string
        }
      }
      payslips: {
        Row: {
          id: string
          payroll_id: string
          employee_id: string
          payslip_number: string
          payslip_period: string
          file_url: string | null
          generated_at: string | null
          generated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          payroll_id: string
          employee_id: string
          payslip_number: string
          payslip_period: string
          file_url?: string | null
          generated_at?: string | null
          generated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          payroll_id?: string
          employee_id?: string
          payslip_number?: string
          payslip_period?: string
          file_url?: string | null
          generated_at?: string | null
          generated_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      face_registrations: {
        Row: {
          id: string
          employee_id: string
          registration_status: string
          registered_at: string | null
          registered_by: string | null
          provider: string | null
          provider_reference: string | null
          consent_recorded_at: string | null
          consent_version: string | null
          last_verified_at: string | null
          is_active: boolean
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          employee_id: string
          registration_status?: string
          registered_at?: string | null
          registered_by?: string | null
          provider?: string | null
          provider_reference?: string | null
          consent_recorded_at?: string | null
          consent_version?: string | null
          last_verified_at?: string | null
          is_active?: boolean
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          employee_id?: string
          registration_status?: string
          registered_at?: string | null
          registered_by?: string | null
          provider?: string | null
          provider_reference?: string | null
          consent_recorded_at?: string | null
          consent_version?: string | null
          last_verified_at?: string | null
          is_active?: boolean
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      face_verification_events: {
        Row: {
          id: string
          employee_id: string
          face_registration_id: string | null
          attendance_id: string | null
          verification_type: string
          result: string
          verified_at: string
          confidence_score: number | null
          provider: string | null
          provider_reference: string | null
          failure_reason: string | null
          source: string
          metadata: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          employee_id: string
          face_registration_id?: string | null
          attendance_id?: string | null
          verification_type: string
          result: string
          verified_at?: string
          confidence_score?: number | null
          provider?: string | null
          provider_reference?: string | null
          failure_reason?: string | null
          source: string
          metadata?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          employee_id?: string
          face_registration_id?: string | null
          attendance_id?: string | null
          verification_type?: string
          result?: string
          verified_at?: string
          confidence_score?: number | null
          provider?: string | null
          provider_reference?: string | null
          failure_reason?: string | null
          source?: string
          metadata?: Json | null
          created_at?: string
        }
      }
      location_verification_events: {
        Row: {
          id: string
          employee_id: string
          attendance_id: string | null
          office_id: string | null
          verification_type: string
          result: string
          latitude: number | null
          longitude: number | null
          accuracy_meters: number | null
          distance_from_office_meters: number | null
          geofence_radius_meters: number | null
          verified_at: string
          source: string
          failure_reason: string | null
          metadata: Json | null
          created_at: string | null
        }
        Insert: {
          id?: string
          employee_id: string
          attendance_id?: string | null
          office_id?: string | null
          verification_type: string
          result: string
          latitude?: number | null
          longitude?: number | null
          accuracy_meters?: number | null
          distance_from_office_meters?: number | null
          geofence_radius_meters?: number | null
          verified_at?: string
          source: string
          failure_reason?: string | null
          metadata?: Json | null
          created_at?: string | null
        }
        Update: {
          id?: string
          employee_id?: string
          attendance_id?: string | null
          office_id?: string | null
          verification_type?: string
          result?: string
          latitude?: number | null
          longitude?: number | null
          accuracy_meters?: number | null
          distance_from_office_meters?: number | null
          geofence_radius_meters?: number | null
          verified_at?: string
          source?: string
          failure_reason?: string | null
          metadata?: Json | null
          created_at?: string | null
        }
      }
      employee_live_locations: {
        Row: {
          id: string
          employee_id: string
          attendance_id: string | null
          office_id: string | null
          latitude: number
          longitude: number
          accuracy_meters: number | null
          distance_from_office_meters: number | null
          location_status: string
          location_context: string
          is_tracking: boolean
          last_seen_at: string
          source: string
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          employee_id: string
          attendance_id?: string | null
          office_id?: string | null
          latitude: number
          longitude: number
          accuracy_meters?: number | null
          distance_from_office_meters?: number | null
          location_status: string
          location_context: string
          is_tracking?: boolean
          last_seen_at?: string
          source: string
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          employee_id?: string
          attendance_id?: string | null
          office_id?: string | null
          latitude?: number
          longitude?: number
          accuracy_meters?: number | null
          distance_from_office_meters?: number | null
          location_status?: string
          location_context?: string
          is_tracking?: boolean
          last_seen_at?: string
          source?: string
          created_at?: string | null
          updated_at?: string | null
        }
      }
      employee_location_history: {
        Row: {
          id: string
          employee_id: string
          attendance_id: string | null
          office_id: string | null
          latitude: number
          longitude: number
          accuracy_meters: number | null
          distance_from_office_meters: number | null
          location_status: string
          location_context: string
          recorded_at: string
          source: string
          metadata: Json | null
          created_at: string | null
        }
        Insert: {
          id?: string
          employee_id: string
          attendance_id?: string | null
          office_id?: string | null
          latitude: number
          longitude: number
          accuracy_meters?: number | null
          distance_from_office_meters?: number | null
          location_status: string
          location_context: string
          recorded_at?: string
          source: string
          metadata?: Json | null
          created_at?: string | null
        }
        Update: {
          id?: string
          employee_id?: string
          attendance_id?: string | null
          office_id?: string | null
          latitude?: number
          longitude?: number
          accuracy_meters?: number | null
          distance_from_office_meters?: number | null
          location_status?: string
          location_context?: string
          recorded_at?: string
          source?: string
          metadata?: Json | null
          created_at?: string | null
        }
      }
      geofence_events: {
        Row: {
          id: string
          employee_id: string
          attendance_id: string | null
          office_id: string | null
          event_type: string
          latitude: number | null
          longitude: number | null
          distance_from_office_meters: number | null
          geofence_radius_meters: number | null
          occurred_at: string
          source: string
          metadata: Json | null
          created_at: string | null
        }
        Insert: {
          id?: string
          employee_id: string
          attendance_id?: string | null
          office_id?: string | null
          event_type: string
          latitude?: number | null
          longitude?: number | null
          distance_from_office_meters?: number | null
          geofence_radius_meters?: number | null
          occurred_at?: string
          source: string
          metadata?: Json | null
          created_at?: string | null
        }
        Update: {
          id?: string
          employee_id?: string
          attendance_id?: string | null
          office_id?: string | null
          event_type?: string
          latitude?: number | null
          longitude?: number | null
          distance_from_office_meters?: number | null
          geofence_radius_meters?: number | null
          occurred_at?: string
          source?: string
          metadata?: Json | null
          created_at?: string | null
        }
      }
      notifications: {
        Row: {
          id: string
          recipient_employee_id: string
          notification_type: string
          title: string
          message: string
          priority: string
          is_read: boolean
          read_at: string | null
          action_url: string | null
          entity_type: string | null
          entity_id: string | null
          metadata: Json | null
          created_at: string
          expires_at: string | null
        }
        Insert: {
          id?: string
          recipient_employee_id: string
          notification_type: string
          title: string
          message: string
          priority?: string
          is_read?: boolean
          read_at?: string | null
          action_url?: string | null
          entity_type?: string | null
          entity_id?: string | null
          metadata?: Json | null
          created_at?: string
          expires_at?: string | null
        }
        Update: {
          id?: string
          recipient_employee_id?: string
          notification_type?: string
          title?: string
          message?: string
          priority?: string
          is_read?: boolean
          read_at?: string | null
          action_url?: string | null
          entity_type?: string | null
          entity_id?: string | null
          metadata?: Json | null
          created_at?: string
          expires_at?: string | null
        }
      }
      audit_logs: {
        Row: {
          id: string
          actor_employee_id: string | null
          action: string
          module: string
          entity_type: string | null
          entity_id: string | null
          description: string | null
          old_values: Json | null
          new_values: Json | null
          metadata: Json | null
          ip_address: string | null
          user_agent: string | null
          source: string
          created_at: string
        }
        Insert: {
          id?: string
          actor_employee_id?: string | null
          action: string
          module: string
          entity_type?: string | null
          entity_id?: string | null
          description?: string | null
          old_values?: Json | null
          new_values?: Json | null
          metadata?: Json | null
          ip_address?: string | null
          user_agent?: string | null
          source?: string
          created_at?: string
        }
        Update: {
          id?: string
          actor_employee_id?: string | null
          action?: string
          module?: string
          entity_type?: string | null
          entity_id?: string | null
          description?: string | null
          old_values?: Json | null
          new_values?: Json | null
          metadata?: Json | null
          ip_address?: string | null
          user_agent?: string | null
          source?: string
          created_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
