import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// We use Firebase Admin REST API or a simple FCM HTTP v1 fetch to send pushes.
// Since Deno can use fetch easily, we construct an FCM HTTP v1 request.

serve(async (req: Request) => {
  try {
    const payload = await req.json();
    
    // Webhook from Supabase will contain `type` and `record`
    const notification = payload.record;
    
    if (!notification || !notification.recipient_employee_id) {
      return new Response(JSON.stringify({ error: "Invalid payload" }), { status: 400 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const fcmServerKey = Deno.env.get("FCM_SERVER_KEY"); // Legacy HTTP FCM or we can use Service Account

    if (!fcmServerKey) {
      console.warn("Missing FCM_SERVER_KEY secret.");
      return new Response(JSON.stringify({ error: "FCM not configured server-side" }), { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get active device tokens for the recipient
    const { data: devices, error: dbError } = await supabase
      .from('notification_devices')
      .select('token, id')
      .eq('employee_id', notification.recipient_employee_id)
      .eq('is_active', true);

    if (dbError || !devices || devices.length === 0) {
      return new Response(JSON.stringify({ message: "No active devices found for recipient" }), { status: 200 });
    }

    // Prepare FCM Payload
    // In Phase 10: Use minimal payload
    const fcmPayload = {
      registration_ids: devices.map((d: any) => d.token),
      notification: {
        title: notification.title || 'WorkPulse Notification',
        body: notification.message || 'You have a new notification in WorkPulse.',
      },
      data: {
        notification_id: notification.id,
        notification_type: notification.notification_type || '',
        entity_type: notification.entity_type || '',
        entity_id: notification.entity_id || ''
      },
      // Android specific channels (Phase 11)
      android: {
        notification: {
          channel_id: 'WORKPULSE_GENERAL'
        }
      }
    };

    // Send to FCM (Using Legacy HTTP API for simplicity in Edge without heavy Google Auth libraries, 
    // though HTTP v1 is recommended, Legacy still works with Server Key).
    const fcmResponse = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `key=${fcmServerKey}`
      },
      body: JSON.stringify(fcmPayload)
    });

    const fcmResult = await fcmResponse.json();
    
    // Handle invalid tokens (Phase 7.6)
    if (fcmResult.results) {
      const tokensToRemove: string[] = [];
      fcmResult.results.forEach((res: any, index: number) => {
        if (res.error === 'NotRegistered' || res.error === 'InvalidRegistration') {
          tokensToRemove.push(devices[index].id);
        }
      });
      
      if (tokensToRemove.length > 0) {
        await supabase
          .from('notification_devices')
          .update({ is_active: false })
          .in('id', tokensToRemove);
      }
    }

    return new Response(JSON.stringify({ success: true, sent: fcmResult.success }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error sending push:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});
