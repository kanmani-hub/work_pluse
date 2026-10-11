-- =====================================================================================
-- WorkPulse HR — SCHEMA FINGERPRINT (READ-ONLY). Changes nothing; reads catalog metadata only,
-- never table data, never secrets. Run the SAME file on PRODUCTION and on STAGING, export each
-- result as CSV (Results → Download CSV) and compare (diff) the two files.
-- One result table (the SQL editor shows only the last result): one row per object, sorted.
-- Covers the public schema: tables & columns, constraints, indexes, RLS on/off, policies,
-- functions (definition hash), triggers, extensions, realtime publication, and grants on
-- functions to anon / authenticated.
-- =====================================================================================
-- Whitespace inside definitions is collapsed to single spaces so each object is exactly one CSV line.
SELECT kind, name, regexp_replace(detail, '\s+', ' ', 'g') AS detail, md5(regexp_replace(detail, '\s+', ' ', 'g')) AS hash FROM (
  SELECT 'column' AS kind, c.table_name || '.' || c.column_name AS name,
         c.data_type || ' null=' || c.is_nullable || ' default=' || coalesce(c.column_default, '') AS detail
  FROM information_schema.columns c
  JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
  WHERE c.table_schema = 'public'
  UNION ALL
  SELECT 'constraint', conrelid::regclass::text || '.' || conname, pg_get_constraintdef(oid)
  FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid <> 0
  UNION ALL
  SELECT 'index', tablename || '.' || indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL
  SELECT 'rls', c.relname, 'enabled=' || c.relrowsecurity || ' forced=' || c.relforcerowsecurity
  FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
  UNION ALL
  SELECT 'policy', tablename || '.' || policyname,
         cmd || ' roles=' || array_to_string(roles, ',') || ' permissive=' || permissive
           || ' using=' || coalesce(qual, '') || ' check=' || coalesce(with_check, '')
  FROM pg_policies WHERE schemaname = 'public'
  UNION ALL
  SELECT 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         'returns=' || pg_get_function_result(p.oid) || ' secdef=' || p.prosecdef || ' lang=' || l.lanname
           || ' config=' || coalesce(array_to_string(p.proconfig, ';'), '') || ' body_md5=' || md5(coalesce(p.prosrc, ''))
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace
  UNION ALL
  SELECT 'function_grant', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         'anon=' || has_function_privilege('anon', p.oid, 'EXECUTE') || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  UNION ALL
  SELECT 'trigger', tgrelid::regclass::text || '.' || tgname, pg_get_triggerdef(t.oid)
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
  UNION ALL
  SELECT 'extension', extname, 'version=' || extversion || ' schema=' || extnamespace::regnamespace::text FROM pg_extension
  UNION ALL
  SELECT 'publication', pubname || ':' || schemaname || '.' || tablename, 'member'
  FROM pg_publication_tables WHERE schemaname = 'public'
) f
ORDER BY kind, name;
