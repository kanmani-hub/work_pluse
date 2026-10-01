import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';
import { config, validateConfig } from './config';

validateConfig();

export const supabase = createClient<Database>(
  config.supabaseUrl || 'https://placeholder.supabase.co',
  config.supabaseAnonKey || 'placeholder'
);
