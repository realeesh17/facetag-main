import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are FaceTag Assistant — a helpful AI built into the FaceTag event photo platform.

FaceTag helps event organizers upload photos, cluster faces by person using AI, generate QR codes, and let guests find their photos by scanning QR codes.

Help with:
- Uploading photos (PNG, JPG, WEBP, HEIC up to 50MB)
- Face clustering: AI groups photos by person
- Naming persons and generating QR codes
- Sending QR codes via email
- Merging similar persons
- Deleting persons or events
- User gallery: scan QR → view/download photos

Troubleshooting:
- 0 photos showing → cluster faces first, then generate QR
- Access denied → QR expired, request new one
- Can't generate QR → save person name first
- Role switching → Profile icon in navbar

Be friendly, concise, and helpful.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = await req.json();
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");

    if (!geminiKey && !lovableKey) {
      return new Response(JSON.stringify({ error: "No AI API key configured." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (geminiKey) {
      // Build Gemini messages - add system as first turn
      const geminiContents = [
        { role: "user", parts: [{ text: SYSTEM_PROMPT + "\n\nUser: " + (messages[0]?.content || "hi") }] },
        { role: "model", parts: [{ text: "I understand! I'm ready to help with FaceTag." }] },
      ];
      
      // Add remaining messages
      for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (i === 0) continue; // Already added first message above
        geminiContents.push({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }]
        });
      }
      
      // If only 1 message, just use direct approach
      const contents = messages.length === 1 ? [
        { role: "user", parts: [{ text: SYSTEM_PROMPT + "\n\nPlease answer this: " + messages[0].content }] }
      ] : geminiContents;

      // Use non-streaming for simplicity and reliability
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents,
            generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
          })
        }
      );

      if (!response.ok) {
        const errText = await response.text();
        console.error("Gemini error:", response.status, errText);
        throw new Error(`Gemini API error: ${response.status} - ${errText}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "I couldn't generate a response. Please try again.";

      // Return as SSE stream (single chunk)
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

    } else {
      // Lovable gateway fallback
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
          stream: true,
        }),
      });

      if (!response.ok) throw new Error(`Gateway error ${response.status}`);
      return new Response(response.body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" }
      });
    }

  } catch (e: any) {
    console.error("Chat error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});