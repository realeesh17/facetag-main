import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { eventId } = await req.json();
    if (!eventId) return new Response(JSON.stringify({ error: 'Missing eventId' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    const lovableKey = Deno.env.get('LOVABLE_API_KEY');
    const apiKey = lovableKey || geminiKey;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!apiKey) return new Response(JSON.stringify({ error: 'No AI key configured. Add GEMINI_API_KEY to Supabase secrets.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (userError || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: event } = await supabase.from('events').select('admin_id').eq('id', eventId).single();
    if (!event || event.admin_id !== user.id) return new Response(JSON.stringify({ error: 'Forbidden' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Get persons with images
    const { data: persons } = await supabase.from('persons').select('id, person_id, name').eq('event_id', eventId).order('person_id');
    if (!persons || persons.length < 2) return new Response(JSON.stringify({ similarGroups: [] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const personImages: { personId: string; personNum: number; name: string | null; imageUrl: string }[] = [];
    for (const person of persons) {
      const { data: images } = await supabase.from('person_images').select('image_url').eq('person_id', person.id).limit(1);
      if (images && images.length > 0) {
        personImages.push({ personId: person.id, personNum: person.person_id, name: person.name, imageUrl: images[0].image_url });
      }
    }

    if (personImages.length < 2) return new Response(JSON.stringify({ similarGroups: [] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const prompt = `Compare these ${personImages.length} person profile photos from an event. Some clusters might be the SAME person split incorrectly.

${personImages.map((p, i) => `Image ${i}: "${p.name || `Person ${p.personNum}`}"`).join('\n')}

Return ONLY JSON:
{
  "similarGroups": [
    {
      "imageIndices": [0, 3],
      "confidence": 0.85,
      "reason": "Same person - matching features"
    }
  ]
}

Only include groups with 60%+ confidence. If none: {"similarGroups": []}`;

    const imageContent: any[] = [{ type: 'text', text: prompt }];
    for (const p of personImages) {
      imageContent.push({ type: 'image_url', image_url: { url: p.imageUrl } });
    }

    // Use Lovable gateway (supports both keys)
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: imageContent }],
      }),
    });

    if (!response.ok) {
      console.error('AI error:', response.status, await response.text());
      return new Response(JSON.stringify({ similarGroups: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return new Response(JSON.stringify({ similarGroups: [] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const result = JSON.parse(jsonMatch[0]);
    const mappedGroups = (result.similarGroups || [])
      .map((g: any) => ({
        personIds: (g.imageIndices || []).map((i: number) => personImages[i]?.personId).filter(Boolean),
        confidence: g.confidence || 0.6,
        reason: g.reason || 'Similar appearance',
      }))
      .filter((g: any) => g.personIds.length >= 2);

    return new Response(JSON.stringify({ similarGroups: mappedGroups }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'An error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});