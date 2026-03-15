import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Input validation schema
const QRRequestSchema = z.object({
  eventId: z.string().uuid('Invalid event ID format'),
  personId: z.string().uuid('Invalid person ID format'),
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Check request size
    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 1024 * 1024) {
      return new Response(
        JSON.stringify({ error: 'Request too large' }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    
    // Validate input
    const validationResult = QRRequestSchema.safeParse(body);
    if (!validationResult.success) {
      return new Response(
        JSON.stringify({ error: 'Invalid request parameters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { eventId, personId } = validationResult.data;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user is the admin of this event
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('admin_id')
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      return new Response(
        JSON.stringify({ error: 'Event not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (event.admin_id !== user.id) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: You are not the admin of this event' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Generating QR for event:', eventId, 'person:', personId, 'by user:', user.id);

    // Get person data
    const { data: person, error: personError } = await supabase
      .from('persons')
      .select('*')
      .eq('id', personId)
      .single();

    if (personError) {
      return new Response(
        JSON.stringify({ error: 'Person not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify person belongs to this event
    if (person.event_id !== eventId) {
      return new Response(
        JSON.stringify({ error: 'Person does not belong to this event' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate cryptographically secure access token
    const accessToken = crypto.randomUUID();
    
    // Generate QR code string with access token for secure access
    const qrCode = `${eventId}_${person.person_id}_${accessToken}`;

    // Generate QR code image using API
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCode)}`;
    
    console.log('Fetching QR image from:', qrApiUrl);
    
    const qrResponse = await fetch(qrApiUrl);
    if (!qrResponse.ok) {
      throw new Error('Failed to generate QR code image');
    }

    const qrBlob = await qrResponse.blob();
    const qrBuffer = await qrBlob.arrayBuffer();

    // Upload QR code to storage
    const qrFileName = `${eventId}_${person.person_id}_${Date.now()}.png`;
    const { error: uploadError } = await supabase
      .storage
      .from('qr-codes')
      .upload(qrFileName, qrBuffer, {
        contentType: 'image/png',
        upsert: true,
      });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: { publicUrl } } = supabase
      .storage
      .from('qr-codes')
      .getPublicUrl(qrFileName);

    // Update person record with QR code and access token
    const { error: updateError } = await supabase
      .from('persons')
      .update({
        qr_code: qrCode,
        qr_url: publicUrl,
        access_token: accessToken,
      })
      .eq('id', personId);

    if (updateError) throw updateError;

    console.log('QR code generated successfully!');

    return new Response(
      JSON.stringify({
        success: true,
        qr_code: qrCode,
        qr_url: publicUrl,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error('Error in generate-qr function:', error);
    return new Response(
      JSON.stringify({ error: 'An error occurred processing your request' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
