import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { RekognitionClient, IndexFacesCommand, SearchFacesByImageCommand } from "npm:@aws-sdk/client-rekognition@3.496.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 });
    }

    const { action, employeeId, imageBase64 } = await req.json();

    if (!action || !employeeId || !imageBase64) {
      return new Response(JSON.stringify({ error: 'Missing required parameters' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
    }

    const accessKeyId = Deno.env.get('AWS_ACCESS_KEY_ID');
    const secretAccessKey = Deno.env.get('AWS_SECRET_ACCESS_KEY');
    const region = Deno.env.get('AWS_REGION');
    const collectionId = Deno.env.get('REKOGNITION_COLLECTION_ID') || 'workpulse-hr-employees';
    const threshold = parseFloat(Deno.env.get('FACE_MATCH_THRESHOLD') || "90.0");

    if (!accessKeyId || !secretAccessKey || !region || !collectionId) {
      return new Response(JSON.stringify({ status: 'PROVIDER_NOT_CONFIGURED', failureReason: 'Missing AWS credentials or configuration.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    const rekognition = new RekognitionClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    });

    // Strip prefix from base64 if present (e.g. data:image/jpeg;base64,...)
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const imageBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

    if (action === 'REGISTER') {
      try {
        const command = new IndexFacesCommand({
          CollectionId: collectionId,
          Image: { Bytes: imageBytes },
          ExternalImageId: employeeId.replace(/[^a-zA-Z0-9_.\-:]/g, '_'), // Ensure valid chars
          MaxFaces: 1,
          QualityFilter: "AUTO",
          DetectionAttributes: ["DEFAULT"]
        });

        const response = await rekognition.send(command);

        if (!response.FaceRecords || response.FaceRecords.length === 0) {
          if (response.UnindexedFaces && response.UnindexedFaces.length > 0) {
             return new Response(JSON.stringify({ status: 'NO_FACE_DETECTED', failureReason: 'Face quality was too low or no face detected by AWS.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
          return new Response(JSON.stringify({ status: 'NO_FACE_DETECTED', failureReason: 'No valid face was detected. Please capture a clear front-facing image.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        if (response.FaceRecords.length > 1) {
          return new Response(JSON.stringify({ status: 'MULTIPLE_FACES', failureReason: 'Multiple faces detected. Only one employee should be visible.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const faceId = response.FaceRecords[0].Face?.FaceId;

        return new Response(JSON.stringify({ 
          status: 'SUCCESS', 
          providerReference: faceId 
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      } catch (err) {
        return new Response(JSON.stringify({ status: 'AWS_SERVICE_ERROR', failureReason: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    } 
    
    else if (action === 'VERIFY') {
      try {
        const command = new SearchFacesByImageCommand({
          CollectionId: collectionId,
          Image: { Bytes: imageBytes },
          FaceMatchThreshold: threshold,
          MaxFaces: 1
        });

        const response = await rekognition.send(command);

        if (!response.FaceMatches || response.FaceMatches.length === 0) {
          return new Response(JSON.stringify({ status: 'FACE_NOT_MATCHED', failureReason: 'Face verification failed. Please try again with a clear view of your face.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const match = response.FaceMatches[0];
        
        // Ensure the matched face belongs to the expected employee
        const externalId = match.Face?.ExternalImageId;
        const expectedExternalId = employeeId.replace(/[^a-zA-Z0-9_.\-:]/g, '_');
        
        if (externalId !== expectedExternalId) {
          return new Response(JSON.stringify({ status: 'FACE_NOT_MATCHED', failureReason: 'Face verification failed. Identity does not match authenticated employee.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({ 
          status: 'SUCCESS',
          confidenceScore: match.Similarity
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      } catch (err) {
        return new Response(JSON.stringify({ status: 'AWS_SERVICE_ERROR', failureReason: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});
