# FACE REGISTRATION INVESTIGATION

Reproduced: PASS
Camera capture: PASS
Frontend invocation: PASS
Supabase Edge Function reached: PASS
HTTP status: 401 Unauthorized
Authentication: FAIL
AWS credentials configured: PASS
AWS region: ap-south-1
Rekognition collection: PASS
IAM permissions: PASS
Image decoding: BLOCKED
IndexFaces: BLOCKED
Database registration: BLOCKED

Root cause: The Edge Function utilized `supabaseClient.auth.getUser()` without explicitly passing the session JWT. In the Supabase Edge runtime, relying solely on the global `Authorization` header on the client object for `getUser()` causes it to fail to resolve the session locally, resulting in a 401 Unauthorized `AUTHENTICATION_ERROR`. The frontend `faceVerificationProvider.ts` subsequently mapped this generic 401 error to the UI message: "Unable to reach face verification service."

Fix: Modified `supabase/functions/face-verification/index.ts` to manually extract the JWT from the incoming `Authorization` header (`const token = authHeader.replace('Bearer ', '')`) and explicitly pass it into the auth resolution call via `await supabaseClient.auth.getUser(token)`. Redeployed the Edge Function to the Supabase production environment.

Retest: PASS (Direct network invocation of the Edge Function with a valid QA employee token now successfully passes the Supabase Auth check and proceeds to image validation, eliminating the 401 Unauthorized rejection).
