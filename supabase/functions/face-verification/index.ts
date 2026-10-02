import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── 1. AUTH ──────────────────────────────────────────────────────────
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      console.error('[face-verification] Auth failed:', userError?.message);
      return jsonResponse({ status: 'AUTHENTICATION_ERROR', failureReason: 'Unauthorized. Please log in again.' }, 401);
    }

    // ── 2. PARSE BODY ───────────────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ status: 'INVALID_IMAGE', failureReason: 'Invalid request body.' }, 400);
    }

    const { action, employeeId, imageBase64 } = body as {
      action?: string;
      employeeId?: string;
      imageBase64?: string;
    };

    if (!action || !employeeId || !imageBase64) {
      return jsonResponse(
        { status: 'INVALID_IMAGE', failureReason: 'Missing required parameters: action, employeeId, imageBase64.' },
        400
      );
    }

    // ── 3. AUTHORIZATION: map auth user → employee ──────────────────────
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('employee_id, role_id')
      .eq('auth_user_id', user.id)
      .single();

    if (!profile) {
      return jsonResponse(
        { status: 'AUTHENTICATION_ERROR', failureReason: 'Employee profile not found for this user.' },
        403
      );
    }

    const currentEmployeeId = profile.employee_id;

    // VERIFY: only the employee themselves (or ADMIN/HR) may verify
    if (action === 'VERIFY' && currentEmployeeId !== employeeId) {
      const { data: role } = await supabaseClient
        .from('roles')
        .select('name')
        .eq('id', profile.role_id)
        .single();

      if (role?.name !== 'ADMIN' && role?.name !== 'HR') {
        return jsonResponse(
          { status: 'FACE_NOT_MATCHED', failureReason: 'Unauthorized. You can only verify your own identity.' },
          403
        );
      }
    }

    // ── 4. AWS CONFIG ───────────────────────────────────────────────────
    const accessKeyId     = Deno.env.get('AWS_ACCESS_KEY_ID');
    const secretAccessKey = Deno.env.get('AWS_SECRET_ACCESS_KEY');
    const region          = Deno.env.get('AWS_REGION');
    const collectionId    = Deno.env.get('REKOGNITION_COLLECTION_ID') || 'workpulse-hr-employees';
    const threshold       = parseFloat(Deno.env.get('FACE_MATCH_THRESHOLD') || '90.0');

    console.log('[face-verification] Config check:', {
      action,
      awsCredentialsConfigured: !!(accessKeyId && secretAccessKey),
      awsRegionConfigured: !!region,
      collectionId,
      threshold,
    });

    if (!accessKeyId || !secretAccessKey || !region) {
      console.error('[face-verification] PROVIDER_NOT_CONFIGURED: missing AWS env vars');
      return jsonResponse({
        status: 'PROVIDER_NOT_CONFIGURED',
        failureReason: 'Face verification service is not configured. Contact your administrator.',
      });
    }

    // ── 5. LOAD AWS SDK (dynamic import to catch module errors) ──────────
    let RekognitionClient: any, IndexFacesCommand: any,
        SearchFacesByImageCommand: any, CreateCollectionCommand: any;
    try {
      const mod = await import("npm:@aws-sdk/client-rekognition@3.496.0");
      RekognitionClient          = mod.RekognitionClient;
      IndexFacesCommand          = mod.IndexFacesCommand;
      SearchFacesByImageCommand  = mod.SearchFacesByImageCommand;
      CreateCollectionCommand    = mod.CreateCollectionCommand;
    } catch (importErr: any) {
      console.error('[face-verification] AWS SDK import failed:', importErr.message);
      return jsonResponse(
        { status: 'PROVIDER_ERROR', failureReason: 'Face verification service is temporarily unavailable.' },
        500
      );
    }

    const rekognition = new RekognitionClient({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });

    // ── 6. DECODE IMAGE ─────────────────────────────────────────────────
    // Strip data-URI prefix (e.g. "data:image/jpeg;base64,")
    const base64Data = (imageBase64 as string).replace(/^data:image\/\w+;base64,/, '');

    let imageBytes: Uint8Array;
    try {
      const binaryString = atob(base64Data);
      imageBytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        imageBytes[i] = binaryString.charCodeAt(i);
      }
    } catch {
      console.error('[face-verification] base64 decode failed');
      return jsonResponse(
        { status: 'INVALID_IMAGE', failureReason: 'Invalid face image format or encoding.' },
        400
      );
    }

    // Validate minimum size (a valid JPEG is at least a few hundred bytes)
    if (imageBytes.length < 200) {
      console.error('[face-verification] Image too small:', imageBytes.length, 'bytes');
      return jsonResponse(
        { status: 'INVALID_IMAGE', failureReason: 'Captured image is too small or empty.' },
        400
      );
    }

    console.log('[face-verification] Image decoded:', {
      byteLength: imageBytes.length,
      startsWithJPEG: imageBytes[0] === 0xFF && imageBytes[1] === 0xD8,
      startsWithPNG:  imageBytes[0] === 0x89 && imageBytes[1] === 0x50,
    });

    // ── 7. ENSURE COLLECTION EXISTS ─────────────────────────────────────
    // This is idempotent — if the collection already exists, CreateCollection
    // throws ResourceAlreadyExistsException which we safely ignore.
    try {
      await rekognition.send(new CreateCollectionCommand({ CollectionId: collectionId }));
      console.log('[face-verification] Collection created:', collectionId);
    } catch (collErr: any) {
      if (collErr.name === 'ResourceAlreadyExistsException' ||
          collErr.__type?.includes('ResourceAlreadyExistsException')) {
        // Collection already exists — expected in production
      } else if (collErr.name === 'AccessDeniedException' ||
                 collErr.__type?.includes('AccessDeniedException')) {
        console.error('[face-verification] AWS_ACCESS_DENIED creating collection:', collErr.message);
        return jsonResponse(
          { status: 'AWS_ACCESS_DENIED', failureReason: 'Face verification service permission error. Contact your administrator.' },
          500
        );
      } else {
        console.error('[face-verification] Unexpected error creating collection:', collErr.name, collErr.message);
        // Non-fatal: the collection may already exist; proceed and let the
        // actual IndexFaces / SearchFaces call surface a clearer error.
      }
    }

    // ── 8. REGISTER ─────────────────────────────────────────────────────
    if (action === 'REGISTER') {
      try {
        const externalImageId = (employeeId as string).replace(/[^a-zA-Z0-9_.\-:]/g, '_');

        const command = new IndexFacesCommand({
          CollectionId: collectionId,
          Image: { Bytes: imageBytes },
          ExternalImageId: externalImageId,
          MaxFaces: 1,
          QualityFilter: 'AUTO',
          DetectionAttributes: ['DEFAULT'],
        });

        const response = await rekognition.send(command);

        console.log('[face-verification] IndexFaces result:', {
          faceRecordsCount: response.FaceRecords?.length ?? 0,
          unindexedFacesCount: response.UnindexedFaces?.length ?? 0,
        });

        // No face detected
        if (!response.FaceRecords || response.FaceRecords.length === 0) {
          const reason = response.UnindexedFaces && response.UnindexedFaces.length > 0
            ? 'Face quality was too low. Please ensure good lighting and a clear front-facing view.'
            : 'No face detected in the image. Please position your face clearly in the frame.';
          return jsonResponse({ status: 'NO_FACE_DETECTED', failureReason: reason });
        }

        // Multiple faces
        if (response.FaceRecords.length > 1) {
          return jsonResponse({
            status: 'MULTIPLE_FACES_DETECTED',
            failureReason: 'Multiple faces detected. Only one person should be visible.',
          });
        }

        const faceId = response.FaceRecords[0].Face?.FaceId;
        if (!faceId) {
          console.error('[face-verification] FaceId missing from IndexFaces response');
          return jsonResponse({
            status: 'PROVIDER_ERROR',
            failureReason: 'Face registration failed unexpectedly. Please try again.',
          });
        }

        console.log('[face-verification] REGISTER SUCCESS, FaceId:', faceId);

        return jsonResponse({
          status: 'SUCCESS',
          providerReference: faceId,
        });

      } catch (err: any) {
        console.error('[face-verification] IndexFaces error:', err.name, err.message);
        return jsonResponse(
          { status: mapAwsError(err), failureReason: mapAwsMessage(err) },
          mapAwsStatus(err)
        );
      }
    }

    // ── 9. VERIFY ───────────────────────────────────────────────────────
    if (action === 'VERIFY') {
      try {
        const command = new SearchFacesByImageCommand({
          CollectionId: collectionId,
          Image: { Bytes: imageBytes },
          FaceMatchThreshold: threshold,
          MaxFaces: 1,
        });

        const response = await rekognition.send(command);

        console.log('[face-verification] SearchFaces result:', {
          matchCount: response.FaceMatches?.length ?? 0,
          searchedFaceConfidence: response.SearchedFaceBoundingBox ? 'detected' : 'none',
        });

        if (!response.FaceMatches || response.FaceMatches.length === 0) {
          return jsonResponse({
            status: 'FACE_NOT_MATCHED',
            failureReason: 'Face does not match the registered profile. Please try again with a clear view of your face.',
          });
        }

        const match = response.FaceMatches[0];

        // Identity verification: ensure the matched face belongs to this employee
        const externalId = match.Face?.ExternalImageId;
        const expectedExternalId = (employeeId as string).replace(/[^a-zA-Z0-9_.\-:]/g, '_');

        if (externalId !== expectedExternalId) {
          console.warn('[face-verification] ExternalImageId mismatch:', {
            expected: expectedExternalId,
            got: externalId,
          });
          return jsonResponse({
            status: 'FACE_NOT_MATCHED',
            failureReason: 'Face does not match the registered profile for this employee.',
          });
        }

        console.log('[face-verification] VERIFY SUCCESS, similarity:', match.Similarity);

        return jsonResponse({
          status: 'SUCCESS',
          confidenceScore: match.Similarity,
        });

      } catch (err: any) {
        console.error('[face-verification] SearchFaces error:', err.name, err.message);
        return jsonResponse(
          { status: mapAwsError(err), failureReason: mapAwsMessage(err) },
          mapAwsStatus(err)
        );
      }
    }

    return jsonResponse({ status: 'INVALID_IMAGE', failureReason: 'Invalid action. Expected REGISTER or VERIFY.' }, 400);

  } catch (err: any) {
    console.error('[face-verification] Unhandled error:', err.message, err.stack);
    return jsonResponse(
      { status: 'PROVIDER_ERROR', failureReason: 'An unexpected error occurred. Please try again.' },
      500
    );
  }
});


// ── HELPERS ───────────────────────────────────────────────────────────────

/** Map AWS SDK error names to safe application-level error codes. */
function mapAwsError(err: any): string {
  const name = err.name || err.__type || '';
  if (name.includes('AccessDenied'))              return 'AWS_ACCESS_DENIED';
  if (name.includes('ResourceNotFound'))           return 'AWS_COLLECTION_NOT_FOUND';
  if (name.includes('InvalidParameterException'))  return 'INVALID_IMAGE';
  if (name.includes('ImageTooLargeException'))      return 'INVALID_IMAGE';
  if (name.includes('InvalidImageFormatException')) return 'INVALID_IMAGE';
  if (name.includes('ProvisionedThroughput'))       return 'PROVIDER_ERROR';
  if (name.includes('Throttling'))                  return 'PROVIDER_ERROR';
  return 'AWS_SERVICE_ERROR';
}

/** Map AWS SDK errors to user-friendly messages. */
function mapAwsMessage(err: any): string {
  const name = err.name || err.__type || '';
  if (name.includes('AccessDenied'))
    return 'Face verification service permission error. Contact your administrator.';
  if (name.includes('ResourceNotFound'))
    return 'Face verification service configuration is invalid. Contact your administrator.';
  if (name.includes('InvalidParameterException'))
    return 'The captured image could not be processed. Please try again.';
  if (name.includes('ImageTooLargeException'))
    return 'The captured image is too large. Please try again.';
  if (name.includes('InvalidImageFormatException'))
    return 'Invalid image format. Please try again with a JPEG or PNG image.';
  if (name.includes('ProvisionedThroughput') || name.includes('Throttling'))
    return 'Face verification service is temporarily overloaded. Please try again shortly.';
  return 'Face verification service encountered an error. Please try again.';
}

/** Map AWS errors to appropriate HTTP status codes. */
function mapAwsStatus(err: any): number {
  const name = err.name || err.__type || '';
  if (name.includes('AccessDenied'))        return 500;
  if (name.includes('ResourceNotFound'))     return 500;
  if (name.includes('InvalidParameter'))     return 400;
  if (name.includes('ImageTooLarge'))        return 400;
  if (name.includes('InvalidImageFormat'))   return 400;
  return 500;
}
