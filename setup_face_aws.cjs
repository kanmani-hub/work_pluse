const fs = require('fs');
const path = require('path');

// 1. Edge Function Creation
const edgeFuncDir = path.join(__dirname, 'supabase', 'functions', 'face-verification');
if (!fs.existsSync(edgeFuncDir)) {
  fs.mkdirSync(edgeFuncDir, { recursive: true });
}

const edgeFuncCode = `import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
    const collectionId = Deno.env.get('REKOGNITION_COLLECTION_ID');
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
    const base64Data = imageBase64.replace(/^data:image\\/\\w+;base64,/, "");
    const imageBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

    if (action === 'REGISTER') {
      try {
        const command = new IndexFacesCommand({
          CollectionId: collectionId,
          Image: { Bytes: imageBytes },
          ExternalImageId: employeeId.replace(/[^a-zA-Z0-9_.\\-:]/g, '_'), // Ensure valid chars
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
        const expectedExternalId = employeeId.replace(/[^a-zA-Z0-9_.\\-:]/g, '_');
        
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
`;
fs.writeFileSync(path.join(edgeFuncDir, 'index.ts'), edgeFuncCode);

// 2. Update faceVerificationProvider.ts
const providerPath = path.join(__dirname, 'src', 'services', 'face', 'providers', 'faceVerificationProvider.ts');
const providerCode = `import { supabase } from '../../../../lib/supabase';

export type ProviderResultStatus = 'SUCCESS' | 'FAILED' | 'REJECTED' | 'ERROR' | 'NOT_CONFIGURED' | 'PROVIDER_NOT_CONFIGURED' | 'NO_FACE_DETECTED' | 'MULTIPLE_FACES' | 'FACE_NOT_MATCHED' | 'AWS_SERVICE_ERROR';

export interface ProviderVerificationResult {
  status: ProviderResultStatus;
  providerReference?: string;
  confidenceScore?: number;
  failureReason?: string;
}

export interface ProviderRegistrationResult {
  status: ProviderResultStatus;
  providerReference?: string;
  failureReason?: string;
}

export interface IFaceVerificationProvider {
  isConfigured(): boolean;
  registerFace(employeeId: string, imageBase64: string, metadata?: any): Promise<ProviderRegistrationResult>;
  verifyFace(employeeId: string, registrationId: string, imageBase64: string, metadata?: any): Promise<ProviderVerificationResult>;
}

export const faceVerificationProvider: IFaceVerificationProvider = {
  isConfigured(): boolean {
    return true; // We rely on the secure backend checking the edge function secrets.
  },

  async registerFace(employeeId: string, imageBase64: string, metadata?: any): Promise<ProviderRegistrationResult> {
    const { data, error } = await supabase.functions.invoke('face-verification', {
      body: { action: 'REGISTER', employeeId, imageBase64 }
    });

    if (error) {
      return { status: 'ERROR', failureReason: error.message };
    }
    
    if (data.status === 'PROVIDER_NOT_CONFIGURED') {
      return { status: 'NOT_CONFIGURED', failureReason: data.failureReason };
    }

    return {
      status: data.status as ProviderResultStatus,
      providerReference: data.providerReference,
      failureReason: data.failureReason
    };
  },

  async verifyFace(employeeId: string, registrationId: string, imageBase64: string, metadata?: any): Promise<ProviderVerificationResult> {
    const { data, error } = await supabase.functions.invoke('face-verification', {
      body: { action: 'VERIFY', employeeId, imageBase64, registrationId }
    });

    if (error) {
      return { status: 'ERROR', failureReason: error.message };
    }

    if (data.status === 'PROVIDER_NOT_CONFIGURED') {
      return { status: 'NOT_CONFIGURED', failureReason: data.failureReason };
    }

    return {
      status: data.status as ProviderResultStatus,
      confidenceScore: data.confidenceScore,
      failureReason: data.failureReason
    };
  }
};
`;
fs.writeFileSync(providerPath, providerCode);

// 3. Update faceService.ts signatures
const servicePath = path.join(__dirname, 'src', 'services', 'face', 'faceService.ts');
let serviceCode = fs.readFileSync(servicePath, 'utf8');

serviceCode = serviceCode.replace(
  /async registerFaceAdmin\(employeeId: string\): Promise<\{ data: FaceRegistrationRow \| null; error: Error \| null \}> \{/g,
  "async registerFaceAdmin(employeeId: string, imageBase64: string): Promise<{ data: FaceRegistrationRow | null; error: Error | null }> {"
);
serviceCode = serviceCode.replace(
  /const providerResult = await faceVerificationProvider\.registerFace\(employeeId\);/g,
  "const providerResult = await faceVerificationProvider.registerFace(employeeId, imageBase64);"
);

serviceCode = serviceCode.replace(
  /async verifyFaceForAttendance\(type: 'CLOCK_IN' \| 'CLOCK_OUT' \| 'REGISTRATION', metadata\?: any\): Promise<\{ eventId: string \| null; error: Error \| null \}> \{/g,
  "async verifyFaceForAttendance(type: 'CLOCK_IN' | 'CLOCK_OUT' | 'REGISTRATION', imageBase64: string, metadata?: any): Promise<{ eventId: string | null; error: Error | null }> {"
);
serviceCode = serviceCode.replace(
  /const providerResult = await faceVerificationProvider\.verifyFace\(empId, reg\.id, metadata\);/g,
  "const providerResult = await faceVerificationProvider.verifyFace(empId, reg.id, imageBase64, metadata);"
);
fs.writeFileSync(servicePath, serviceCode);

// 4. Update FaceRegistration.tsx
const regPath = path.join(__dirname, 'src', 'pages', 'admin', 'FaceRegistration.tsx');
let regCode = fs.readFileSync(regPath, 'utf8');
regCode = regCode.replace(
  /const \{ error \} = await faceService\.registerFaceAdmin\(selectedEmp\.id\);/g,
  "if (!capturedImage) {\n      alert('No image captured.');\n      return;\n    }\n    const { error } = await faceService.registerFaceAdmin(selectedEmp.id, capturedImage);"
);
fs.writeFileSync(regPath, regCode);

// 5. Update Attendance.tsx
const attPath = path.join(__dirname, 'src', 'pages', 'employee', 'Attendance.tsx');
let attCode = fs.readFileSync(attPath, 'utf8');

const captureReplacement = `
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const capturedImage = canvas.toDataURL('image/jpeg');

    stopCamera();
    setClockInFlowStep(2); // Processing

    try {
      if (cameraAction === 'REGISTER_FACE') {
        const empId = await attendanceService.getCurrentEmployeeId();
        if (empId) {
           const { error } = await faceService.registerFaceAdmin(empId, capturedImage);
`;
attCode = attCode.replace(
  /stopCamera\(\);\n    setClockInFlowStep\(2\); \/\/ Processing\n\n    try \{\n      if \(cameraAction === 'REGISTER_FACE'\) \{\n        const empId = await attendanceService\.getCurrentEmployeeId\(\);\n        if \(empId\) \{\n           const \{ error \} = await faceService\.registerFaceAdmin\(empId\);/g,
  captureReplacement
);

attCode = attCode.replace(
  /const \{ eventId, error \} = await faceService\.verifyFaceForAttendance\('CLOCK_IN'\);/g,
  "const { eventId, error } = await faceService.verifyFaceForAttendance('CLOCK_IN', capturedImage);"
);

fs.writeFileSync(attPath, attCode);

console.log('Successfully completed AWS Rekognition integration script.');
