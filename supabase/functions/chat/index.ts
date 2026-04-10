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
- Analytics: scan counts, downloads, shares

USER FEATURES:
- Scan QR code or enter code manually on Scan page
- View personal photo gallery
- Filter: All, Solo, Group, Favorites
- Download HD photos, share to WhatsApp/Instagram/Facebook

TROUBLESHOOTING:
- "0 photos" → Admin must cluster first, then generate QR
- "Access denied" → QR expired, ask admin for new one
- "Can't generate QR" → Save person name first
- Role switching → Profile icon in top-right navbar

Be friendly, concise, step-by-step when needed.`;

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// Try multiple Gemini models in order of preference
const GEMINI_MODELS = [
  "gemini-1.5-flash",
  "gemini-1.5-flash-001", 
  "gemini-1.0-pro",
];

async function callGeminiWithRetry(geminiKey: string, messages: any[]): Promise<string> {
  const contents: any[] = [];

  // Build conversation with system prompt embedded in first message
  const firstUserMsg = messages[0]?.content || "hi";
  contents.push({
    role: "user",
    parts: [{ text: `${SYSTEM_PROMPT}\n\nUser question: ${firstUserMsg}` }]
  });

  if (messages.length > 1) {
    contents.push({ role: "model", parts: [{ text: "I'm your FaceTag assistant, happy to help!" }] });
    for (let i = 1; i < messages.length; i++) {
      contents.push({
        role: messages[i].role === "assistant" ? "model" : "user",
        parts: [{ text: messages[i].content }]
      });
    }
  }

  const requestBody = {
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
  };

  // Try each model
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody)
          }
        );

        if (response.ok) {
          const data = await response.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            console.log(`Success with model: ${model}`);
            return text;
          }
        }

        if (response.status === 429) {
          const waitMs = 3000 * Math.pow(2, attempt);
          console.log(`Rate limited on ${model}, waiting ${waitMs}ms`);
          await delay(waitMs);
          continue;
        }

        if (response.status === 404) {
          console.log(`Model ${model} not found, trying next`);
          break; // Try next model
        }

        const errText = await response.text();
        console.error(`Error ${response.status} on ${model}:`, errText);
        break;

      } catch (e) {
        console.error(`Fetch error on ${model}:`, e);
        break;
      }
    }
  }

  throw new Error("All Gemini models failed. Please check your GEMINI_API_KEY in Supabase secrets.");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = await req.json();
    const geminiKey = Deno.env.get("GEMINI_API_KEY");

    if (!geminiKey) {
      return new Response(JSON.stringify({
        error: "GEMINI_API_KEY not set. Go to Supabase dashboard → Settings → Edge Functions → Add secret."
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const text = await callGeminiWithRetry(geminiKey, messages);

    // Return as SSE stream matching frontend format
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