import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SendQREmailRequest {
  personId: string;
  email: string;
  eventName?: string;
  personName?: string;
}

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("RESEND_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Email service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resend = new Resend(resendApiKey);

    // Validate request
    const body = await req.json();
    const { personId, email, eventName, personName }: SendQREmailRequest = body;

    if (!personId || !email) {
      return new Response(
        JSON.stringify({ error: "personId and email are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: "Invalid email format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get person data with QR code
    const { data: person, error: personError } = await supabase
      .from("persons")
      .select("id, name, qr_code, qr_url, event_id")
      .eq("id", personId)
      .maybeSingle();

    if (personError || !person) {
      console.error("Person fetch error:", personError);
      return new Response(
        JSON.stringify({ error: "Person not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!person.qr_url) {
      return new Response(
        JSON.stringify({ error: "QR code not generated yet for this person" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get event details
    const { data: event } = await supabase
      .from("events")
      .select("name")
      .eq("id", person.event_id)
      .maybeSingle();

    const displayName = personName || person.name || "Guest";
    const displayEventName = eventName || event?.name || "Event";

    // Build gallery URL
    const galleryUrl = `${req.headers.get("origin") || "https://your-app.lovable.app"}/gallery/${person.qr_code}`;

    // Send email
    const emailResponse = await resend.emails.send({
      from: "EventSnap <onboarding@resend.dev>",
      to: [email],
      subject: `📸 Your Photos from ${displayEventName} are Ready!`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
          <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
            <tr>
              <td style="padding: 40px 30px; text-align: center; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);">
                <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">📸 EventSnap</h1>
                <p style="margin: 10px 0 0; color: rgba(255,255,255,0.9); font-size: 16px;">Your memories, delivered</p>
              </td>
            </tr>
            <tr>
              <td style="padding: 40px 30px;">
                <h2 style="margin: 0 0 20px; color: #18181b; font-size: 24px; font-weight: 600;">
                  Hi ${displayName}! 👋
                </h2>
                <p style="margin: 0 0 20px; color: #52525b; font-size: 16px; line-height: 1.6;">
                  Great news! Your photos from <strong>${displayEventName}</strong> are ready to view and download.
                </p>
                <p style="margin: 0 0 30px; color: #52525b; font-size: 16px; line-height: 1.6;">
                  We've used AI to find all the photos you appear in. Scan the QR code below or click the button to access your personalized gallery.
                </p>
                
                <!-- QR Code -->
                <div style="text-align: center; margin: 30px 0;">
                  <img src="${person.qr_url}" alt="Your QR Code" style="width: 200px; height: 200px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                </div>
                
                <!-- CTA Button -->
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${galleryUrl}" style="display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px; box-shadow: 0 4px 6px rgba(99, 102, 241, 0.3);">
                    View My Photos →
                  </a>
                </div>
                
                <p style="margin: 30px 0 0; color: #71717a; font-size: 14px; text-align: center;">
                  Save this email to access your photos anytime!
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding: 30px; background-color: #f4f4f5; text-align: center;">
                <p style="margin: 0; color: #71717a; font-size: 12px;">
                  This email was sent by EventSnap.<br>
                  Your photos are private and only accessible via this unique link.
                </p>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });

    console.log("Email sent successfully:", emailResponse);

    // Track email sent
    try {
      await supabase.from("analytics_events").insert({
        event_id: person.event_id,
        person_id: person.id,
        event_type: "email_sent",
        metadata: { recipient: email, timestamp: new Date().toISOString() },
      });
    } catch (trackError) {
      console.error("Failed to track email:", trackError);
    }

    return new Response(
      JSON.stringify({ success: true, message: "Email sent successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Error in send-qr-email function:", error);
    return new Response(
      JSON.stringify({ error: "Failed to send email" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
