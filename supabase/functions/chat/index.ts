import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are FaceTag Assistant — a helpful AI built into the FaceTag event photo platform.

FaceTag helps event organizers upload photos, use AI to cluster faces by person, generate QR codes, and let guests find their own photos by scanning a QR code.

ADMIN FEATURES:
- Upload event photos (PNG, JPG, WEBP, HEIC up to 50MB)
- Face clustering: AI groups photos by person (Face++ API, 92% accuracy)
- Name persons and generate QR codes
- Send QR codes via email
- Merge duplicate persons, delete persons or events
- Re-cluster to improve results
- Analytics: scan counts, downloads, shares

USER FEATURES:
- Scan QR code or enter code manually
- View personal photo gallery (masonry layout)
- Filter: All, Solo, Group, Favorites
- Download HD photos individually or all at once
- Share to WhatsApp, Facebook, Twitter, Instagram

TROUBLESHOOTING:
- "0 photos" → Admin must cluster first, then generate QR
- "Access denied" → QR expired, ask admin for new one
- "Can't generate QR" → Save person's name first
- "Upload stuck" → Retry, check internet
- Role switching → Profile icon in top-right navbar

Be friendly, concise, and give step-by-step help when needed.`;

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

async function callGemini(geminiKey: string, messages: any[], retries = 3): Promise<string> {
  const contents = [];
  
  if (messages.length === 1) {
    contents.push({
      role: "user",
      parts: [{ text: SYSTEM_PROMPT + "\n\nAnswer this question about FaceTag: " + messages[0].content }]
    });
  } else {
    contents.push({
      role: "user",
      parts: [{ text: SYSTEM_PROMPT + "\n\nUser: " + messages[0].content }]
    });
    contents.push({ role: "model", parts: [{ text: "Got it! I'm your FaceTag assistant." }] });
    for (let i = 1; i < messages.length; i++) {
      contents.push({
        role: messages[i].role === "assistant" ? "model" : "user",
        parts: [{ text: messages[i].content }]
      });
    }
  }

  for (let attempt = 0; attempt < retries; attempt++) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
        })
      }
    );

    if (response.ok) {
      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text
        || "I couldn't generate a response. Please try again.";
    }

    if (response.status === 429) {
      if (attempt < retries - 1) {
        // Exponential backoff: 3s, 6s, 12s
        const waitMs = 3000 * Math.pow(2, attempt);
        console.log(`Rate limited, waiting ${waitMs}ms before retry ${attempt + 1}`);
        await delay(waitMs);
        continue;
      }
      throw new Error("Gemini is temporarily busy. Please wait 30 seconds and try again.");
    }

    const errText = await response.text();
    console.error("Gemini error:", response.status, errText);
    throw new Error(`AI error: ${response.status}`);
  }

  throw new Error("Max retries exceeded. Please try again in a moment.");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = await req.json();
    const geminiKey = Deno.env.get("GEMINI_API_KEY");

    if (!geminiKey) {
      return new Response(JSON.stringify({ 
        error: "GEMINI_API_KEY not configured. Add it in Supabase dashboard → Settings → Edge Functions." 
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const text = await callGemini(geminiKey, messages);

    // Return as SSE stream
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