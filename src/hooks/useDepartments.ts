import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface Department {
  id: string;
  name: string;
  is_active: boolean;
}

export function useDepartments(activeOnly: boolean = true) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isMounted = true;
    
    async function fetchDepartments() {
      setLoading(true);
      try {
        let query = supabase.from('departments').select('id, name, is_active').order('name');
        if (activeOnly) {
          query = query.eq('is_active', true);
        }
        
        const { data, error } = await query;
        if (error) throw error;
        
        if (isMounted) {
          setDepartments(data || []);
          setError(null);
        }
      } catch (err: any) {
        if (isMounted) setError(err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchDepartments();

    return () => {
      isMounted = false;
    };
  }, [activeOnly]);

  return { departments, loading, error };
}
