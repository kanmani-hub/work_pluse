import { supabase } from '../../lib/supabase';
import { validateConfig } from '../../lib/config';

export type ConnectionStatus = 'CONNECTED' | 'NOT_CONNECTED' | 'MIGRATIONS_NOT_APPLIED';

export const checkSupabaseConnection = async (): Promise<ConnectionStatus> => {
  if (!validateConfig()) {
    console.warn('Connection test not executed because Supabase environment variables are not configured.');
    return 'NOT_CONNECTED';
  }

  try {
    const { data, error } = await supabase
      .from('roles')
      .select('id')
      .limit(1);

    if (error) {
      if (error.code === '42P01') {
        // Relation does not exist (migrations missing)
        return 'MIGRATIONS_NOT_APPLIED';
      }
      console.error('Supabase connection error:', error.message);
      return 'NOT_CONNECTED';
    }

    return 'CONNECTED';
  } catch (error) {
    console.error('Supabase unexpected connection error:', error);
    return 'NOT_CONNECTED';
  }
};
