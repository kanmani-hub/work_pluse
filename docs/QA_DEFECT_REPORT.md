# QA Defect Report

## DEFECT-UI-001
- **Title:** Admin Settings Save Action Unresponsive
- **Module:** Admin Settings
- **Role:** Admin
- **Environment:** QA / Localhost
- **Preconditions:** Logged in as QA Admin.
- **Steps:** Navigate to Settings, change a value, click Save.
- **Expected:** Success message and data persisted to Supabase.
- **Actual:** Save action is unresponsive/fails to persist.
- **Severity:** HIGH
- **Priority:** HIGH
- **Likely root cause:** UI button lacks click handler or API payload is malformed.
- **Resolution:** The automated VLM agent incorrectly entered text into the Global Search bar instead of a settings field, leaving the form in an unmodified state (hasChanges=false), which kept the Save button disabled. Testing with targeted field inputs confirmed the Save action correctly persists to Supabase and displays a success toast.
- **Status:** CLOSED (FALSE POSITIVE)

## DEFECT-UI-002
- **Title:** HR Login Fails to Redirect
- **Module:** Authentication
- **Role:** HR
- **Environment:** QA / Localhost
- **Preconditions:** Valid HR credentials.
- **Steps:** Enter credentials and click Login.
- **Expected:** Redirect to Admin/HR Dashboard.
- **Actual:** Hangs on Login page. No error displayed.
- **Severity:** HIGH
- **Priority:** HIGH
- **Likely root cause:** `ProtectedRoute` or `AuthContext` navigation logic fails to resolve the HR/Staff role correctly or encounters an unhandled exception.
- **Status:** CLOSED (FIXED)
