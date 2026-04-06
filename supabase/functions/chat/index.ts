import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are FaceTag Assistant — a helpful AI built into the FaceTag event photo platform.

FaceTag helps event organizers upload photos, use AI to cluster faces by person, generate QR codes, and let guests find and download their own photos by scanning their QR code.

ADMIN FEATURES:
- Creating events and uploading photos (PNG, JPG, WEBP, HEIC up to 50MB)
- Face clustering: AI groups photos by detected faces into person clusters (uses Face++ API — 92% accuracy)
- Naming persons and generating QR codes for each person
- Sending QR codes via email to guests
- Merging similar persons if clustering split the same person
- Deleting persons or entire events
- Re-clustering to improve results
- Analytics: viewing scan counts, downloads, shares per event

USER FEATURES:
- Scanning QR codes with camera or entering manually on Scan page
- Viewing personal photo gallery with masonry layout
- Filtering: All, Solo, Group, Favorites
- Downloading individual photos or all at once in HD
- Social sharing: WhatsApp, Facebook, Twitter, Instagram
- Saving favorites and Activity Score (% of event photos you appear in)

TROUBLESHOOTING:
- "0 photos showing" → Admin needs to cluster faces first, then generate QR
- "Access denied" → QR code invalid or expired, request new one from admin
- "Clustering failed" → Photos may not have clear visible faces, try better quality photos
- "Can't generate QR" → Save a name for the person first before generating QR
- "Upload stuck" → Clear failed uploads and retry, check internet connection
- Role switching → Use Profile icon (circle with initial) in top-right navbar

TECHNICAL:
- Face clustering uses Face++ API for 92% accuracy face recognition
- Gemini AI does second-pass merge to combine duplicate persons
- Photos stored in Supabase Storage, metadata in PostgreSQL

Be conversational, helpful, and give step-by-step instructions when needed.`;

// Retry a fetch with exponential backoff on 429
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 2): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options);
    if (response.status !== 429 || attempt === maxRetries) return response;
    // Wait before retry: 2s, then 4s
    await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error("Max retries exceeded");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = await req.json();
    const geminiKey = Deno.env.get("GEMINI_API_KEY");

    if (!geminiKey) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured in Supabase secrets." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Build Gemini contents array
    const contents = [];

    // Add system as first user turn (Gemini doesn't have system role in same way)
    if (messages.length === 1) {
      contents.push({
        role: "user",
        parts: [{ text: SYSTEM_PROMPT + "\n\nUser question: " + messages[0].content }]
      });
    } else {
      // First message primes with system context
      contents.push({
        role: "user",
        parts: [{ text: SYSTEM_PROMPT + "\n\nUser question: " + messages[0].content }]
      });
      contents.push({
        role: "model",
        parts: [{ text: "Understood! I'm your FaceTag assistant. How can I help?" }]
      });
      // Add rest of conversation
      for (let i = 1; i < messages.length; i++) {
        contents.push({
          role: messages[i].role === "assistant" ? "model" : "user",
          parts: [{ text: messages[i].content }]
        });
      }
    }

    const response = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1024,
          }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini error:", response.status, errText);

      if (response.status === 429) {
        return new Response(JSON.stringify({
          error: "Gemini rate limit reached. Please wait 10 seconds and try again."
        }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
      || "I couldn't generate a response. Please try again.";

    // Return as SSE stream (single chunk matching frontend expectations)
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const chunk = JSON.stringify({ choices: [{ delta: { content: text } }] });
        controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" }
    });

  } catch (e: any) {
    console.error("Chat error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});