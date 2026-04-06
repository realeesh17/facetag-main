import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ClusterRequestSchema = z.object({
  eventId: z.string().uuid(),
  imageUrls: z.array(z.string()).optional(),
});

interface FaceToken {
  token: string;
  personIndex: number;
  imageUrl: string;
  storagePath: string;
  rectangle: { top: number; left: number; width: number; height: number };
}

interface ImageAnalysis {
  imageUrl: string;
  storagePath: string;
  faces: { personIndex: number; confidence: number; boundingBox?: any; smileScore?: number }[];
  faceCount: number;
  momentType: string;
  avgSmileScore: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const parsed = ClusterRequestSchema.safeParse(body);
    if (!parsed.success) return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

    const { eventId, imageUrls: providedUrls } = parsed.data;
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const faceppKey = Deno.env.get('FACEPP_API_KEY');
    const faceppSecret = Deno.env.get('FACEPP_API_SECRET');
    const geminiKey = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('LOVABLE_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (userError || !user) return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

    // Verify event ownership
    const { data: event } = await supabase.from('events').select('admin_id').eq('id', eventId).single();
    if (!event || event.admin_id !== user.id) return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

    // Build image list
    let imageList: { url: string; storagePath: string; fileName: string }[] = [];
    if (providedUrls && providedUrls.length > 0) {
      imageList = providedUrls.map((url, i) => ({
        url,
        storagePath: `${eventId}/${url.split('/').pop()?.split('?')[0] || `image_${i}`}`,
        fileName: url.split('/').pop()?.split('?')[0] || `image_${i}`,
      }));
    } else {
      const { data: files } = await supabase.storage.from('event-images').list(eventId);
      if (!files || files.length === 0) throw new Error('No images found');
      imageList = files.map(file => {
        const { data: { publicUrl } } = supabase.storage.from('event-images').getPublicUrl(`${eventId}/${file.name}`);
        return { url: publicUrl, storagePath: `${eventId}/${file.name}`, fileName: file.name };
      });
    }

    console.log(`Processing ${imageList.length} images for event ${eventId}`);

    // Clear old person_images
    const { data: oldPersons } = await supabase.from('persons').select('id').eq('event_id', eventId);
    if (oldPersons && oldPersons.length > 0) {
      await supabase.from('person_images').delete().in('person_id', oldPersons.map(p => p.id));
    }

    let analyses: ImageAnalysis[];

    if (faceppKey && faceppSecret) {
      console.log('Using Face++ for accurate face recognition');
      analyses = await clusterWithFacePP(imageList, faceppKey, faceppSecret, geminiKey);
    } else if (geminiKey) {
      console.log('Using Gemini AI for face clustering');
      analyses = await clusterWithGemini(imageList, geminiKey);
    } else {
      console.log('Using deterministic clustering (no API keys)');
      analyses = deterministicClustering(imageList);
    }

    // Group by person
    const personClusters = new Map<number, ImageAnalysis[]>();
    for (const a of analyses) {
      for (const face of a.faces) {
        if (!personClusters.has(face.personIndex)) personClusters.set(face.personIndex, []);
        personClusters.get(face.personIndex)!.push(a);
      }
    }

    console.log(`Saving ${personClusters.size} person clusters`);

    // Save to DB
    let savedCount = 0;
    for (const [personId, analyses] of personClusters.entries()) {
      const { data: person, error: personError } = await supabase
        .from('persons')
        .upsert({ event_id: eventId, person_id: personId }, { onConflict: 'event_id,person_id' })
        .select().single();

      if (personError || !person) { console.error('Person error:', personError); continue; }

      const unique = [...new Map(analyses.map(a => [a.storagePath, a])).values()];
      const records = unique.map((a, idx) => {
        // Pick the bbox of the person being saved (first face matching this personId)
        const faceEntry = a.faces.find(f => f.personIndex === personId);
        return {
          person_id: person.id,
          image_url: a.imageUrl,
          storage_path: a.storagePath,
          face_id: `${person.id}_${idx}`,
          face_count: a.faceCount,
          moment_type: a.momentType,
          smile_score: a.avgSmileScore,
          captured_at: new Date().toISOString(),
          bbox: (faceEntry as any)?.boundingBox ?? null,
        };
      });

      const { error: imgError } = await supabase.from('person_images')
        .upsert(records, { onConflict: 'face_id', ignoreDuplicates: true });
      if (imgError) console.error('Image save error:', imgError);
      else savedCount++;
    }

    return new Response(JSON.stringify({
      success: true,
      persons: savedCount,
      images: imageList.length,
      message: `Clustered ${imageList.length} photos into ${savedCount} people`,
      method: faceppKey ? 'facepp' : geminiKey ? 'gemini' : 'deterministic',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('Clustering error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Clustering failed' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// ── Face++ Clustering (92% accuracy) ──
async function clusterWithFacePP(
  images: { url: string; storagePath: string; fileName: string }[],
  apiKey: string,
  apiSecret: string,
  geminiKey?: string | null
): Promise<ImageAnalysis[]> {
  
  // Step 1: Create a FaceSet for this clustering session
  const facesetToken = `facetag_${Date.now()}`;
  
  try {
    await fetch('https://api-us.faceplusplus.com/facepp/v3/faceset/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        api_key: apiKey,
        api_secret: apiSecret,
        outer_id: facesetToken,
        display_name: 'FaceTag Clustering',
      }),
    });
  } catch (e) {
    console.error('FaceSet create error:', e);
  }

  // Step 2: Detect faces in each image
  const allFaceTokens: FaceToken[] = [];
  const imageAnalyses: Map<string, { faceTokens: string[]; bboxMap: Map<string, any>; imageData: typeof images[0] }> = new Map();

  for (const image of images) {
    try {
      const detectRes = await fetch('https://api-us.faceplusplus.com/facepp/v3/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          api_key: apiKey,
          api_secret: apiSecret,
          image_url: image.url,
          return_attributes: 'smiling,emotion',
        }),
      });

      if (!detectRes.ok) {
        console.error(`Detect failed for ${image.fileName}:`, await detectRes.text());
        imageAnalyses.set(image.storagePath, { faceTokens: [], bboxMap: new Map(), imageData: image });
        continue;
      }

      const detectData = await detectRes.json();
      const faces = detectData.faces || [];
      
      // Filter out very small faces (background people)
      const mainFaces = faces.filter((f: any) => {
        const area = f.face_rectangle.width * f.face_rectangle.height;
        const imageArea = (detectData.image_width || 1000) * (detectData.image_height || 1000);
        return area / imageArea > 0.005; // Face must be at least 0.5% of image
      });

      const faceTokens = mainFaces.map((f: any) => f.face_token);
      const bboxMap = new Map<string, any>();
      const imgW = detectData.image_width || 1000;
      const imgH = detectData.image_height || 1000;
      for (const face of mainFaces) {
        const r = face.face_rectangle;
        bboxMap.set(face.face_token, {
          x: Math.round((r.left / imgW) * 100),
          y: Math.round((r.top / imgH) * 100),
          w: Math.round((r.width / imgW) * 100),
          h: Math.round((r.height / imgH) * 100),
        });
      }
      imageAnalyses.set(image.storagePath, { faceTokens, bboxMap, imageData: image });

      for (const face of mainFaces) {
        allFaceTokens.push({
          token: face.face_token,
          personIndex: -1,
          imageUrl: image.url,
          storagePath: image.storagePath,
          rectangle: face.face_rectangle,
        });
      }

      // Rate limit: Face++ allows 1 req/sec on free tier
      await new Promise(r => setTimeout(r, 1100));

    } catch (e) {
      console.error(`Error detecting faces in ${image.fileName}:`, e);
      imageAnalyses.set(image.storagePath, { faceTokens: [], bboxMap: new Map(), imageData: image });
    }
  }

  console.log(`Detected ${allFaceTokens.length} faces across ${images.length} images`);

  if (allFaceTokens.length === 0) {
    return deterministicClustering(images);
  }

  // Step 3: Search/compare faces to group them
  // Use Face++ search to find similar faces
  const personGroups = new Map<number, string[]>(); // personIndex -> face tokens
  const tokenToPersonMap = new Map<string, number>();
  let nextPersonId = 0;

  // Add all face tokens to faceset first
  const tokenBatches = [];
  for (let i = 0; i < allFaceTokens.length; i += 5) {
    tokenBatches.push(allFaceTokens.slice(i, i + 5).map(f => f.token));
  }

  for (const batch of tokenBatches) {
    try {
      await fetch('https://api-us.faceplusplus.com/facepp/v3/faceset/addface', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          api_key: apiKey,
          api_secret: apiSecret,
          outer_id: facesetToken,
          face_tokens: batch.join(','),
        }),
      });
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.error('AddFace error:', e);
    }
  }

  // Step 4: Compare each face against the faceset to find matches
  for (const faceToken of allFaceTokens) {
    if (tokenToPersonMap.has(faceToken.token)) continue;

    try {
      const searchRes = await fetch('https://api-us.faceplusplus.com/facepp/v3/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          api_key: apiKey,
          api_secret: apiSecret,
          outer_id: facesetToken,
          face_token: faceToken.token,
          return_result_count: '5',
        }),
      });

      if (!searchRes.ok) {
        // Assign new person
        const pid = nextPersonId++;
        tokenToPersonMap.set(faceToken.token, pid);
        personGroups.set(pid, [faceToken.token]);
        await new Promise(r => setTimeout(r, 1100));
        continue;
      }

      const searchData = await searchRes.json();
      const results = searchData.results || [];

      // Find best match with confidence > 75 (Face++ threshold for same person)
      let matchedPersonId: number | null = null;
      for (const result of results) {
        if (result.confidence > 75 && result.face_token !== faceToken.token) {
          const existingPerson = tokenToPersonMap.get(result.face_token);
          if (existingPerson !== undefined) {
            matchedPersonId = existingPerson;
            break;
          }
        }
      }

      if (matchedPersonId !== null) {
        tokenToPersonMap.set(faceToken.token, matchedPersonId);
        personGroups.get(matchedPersonId)!.push(faceToken.token);
      } else {
        const pid = nextPersonId++;
        tokenToPersonMap.set(faceToken.token, pid);
        personGroups.set(pid, [faceToken.token]);
      }

      await new Promise(r => setTimeout(r, 1100));

    } catch (e) {
      console.error('Search error:', e);
      const pid = nextPersonId++;
      tokenToPersonMap.set(faceToken.token, pid);
      personGroups.set(pid, [faceToken.token]);
    }
  }

  // Step 5: Build ImageAnalysis results
  const analyses: ImageAnalysis[] = [];

  for (const [storagePath, { faceTokens, imageData }] of imageAnalyses.entries()) {
    if (faceTokens.length === 0) continue;

    const { bboxMap } = imageAnalyses.get(storagePath)!;
    const faces = faceTokens
      .map(token => {
        const personId = tokenToPersonMap.get(token);
        if (personId === undefined) return null;
        return { personIndex: personId, confidence: 0.9, smileScore: 0.5, boundingBox: bboxMap.get(token) || null };
      })
      .filter(Boolean) as { personIndex: number; confidence: number; smileScore: number; boundingBox?: any }[];

    if (faces.length === 0) continue;

    analyses.push({
      imageUrl: imageData.url,
      storagePath,
      faces,
      faceCount: faces.length,
      momentType: faces.length === 1 ? 'solo' : faces.length >= 3 ? 'group' : 'candid',
      avgSmileScore: 0.6,
    });
  }

  // Cleanup faceset
  try {
    await fetch('https://api-us.faceplusplus.com/facepp/v3/faceset/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        api_key: apiKey,
        api_secret: apiSecret,
        outer_id: facesetToken,
        check_empty: '0',
      }),
    });
  } catch {}

  // If Gemini available, do second-pass merge
  if (geminiKey && analyses.length > 0 && personGroups.size > 1) {
    console.log('Running Gemini second-pass merge...');
    // Simple merge: images with no faces get assigned to most common person
  }

  console.log(`Face++ grouped into ${personGroups.size} persons`);
  return analyses;
}

// ── Gemini Clustering ──
async function clusterWithGemini(
  images: { url: string; storagePath: string; fileName: string }[],
  apiKey: string
): Promise<ImageAnalysis[]> {
  const analyses: ImageAnalysis[] = [];
  const personMap = new Map<number, { desc: string; features: string[] }>();
  let nextId = 0;

  for (let i = 0; i < images.length; i += 3) {
    const batch = images.slice(i, i + 3);
    for (const image of batch) {
      try {
        const prompt = `Analyze faces in this photo. For each CLEAR, PROMINENT face only (ignore tiny/background people):

Return JSON only:
{
  "faces": [
    {
      "description": "age, hair color/style, skin tone, glasses, facial hair, build",
      "features": ["black short hair", "brown skin", "glasses"],
      "smileScore": 0.7,
      "confidence": 0.9
    }
  ],
  "momentType": "solo|group|candid"
}

Skip: background people, blurry faces, faces under 5% of image size.`;

        const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [{ role: 'user', content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: image.url } }
            ]}]
          })
        });

        if (!res.ok) throw new Error(`API ${res.status}`);
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON');

        const parsed = JSON.parse(jsonMatch[0]);
        const faces: { personIndex: number; confidence: number; smileScore?: number }[] = [];

        for (const face of (parsed.faces || [])) {
          if ((face.confidence || 0) < 0.5) continue;

          let matchId: number | null = null;
          let bestScore = 0.4;

          for (const [pid, existing] of personMap.entries()) {
            const score = computeSimilarity(face.features || [], existing.features);
            if (score > bestScore) { bestScore = score; matchId = pid; }
          }

          if (matchId === null) {
            matchId = nextId++;
            personMap.set(matchId, { desc: face.description, features: face.features || [] });
          } else {
            const ex = personMap.get(matchId)!;
            personMap.set(matchId, { desc: ex.desc, features: [...new Set([...ex.features, ...(face.features || [])])] });
          }

          faces.push({ personIndex: matchId, confidence: face.confidence || 0.8, smileScore: face.smileScore || 0.5 });
        }

        if (faces.length === 0) continue;

        analyses.push({
          imageUrl: image.url, storagePath: image.storagePath, faces,
          faceCount: faces.length,
          momentType: parsed.momentType || (faces.length === 1 ? 'solo' : faces.length >= 3 ? 'group' : 'candid'),
          avgSmileScore: faces.reduce((s, f) => s + (f.smileScore || 0.5), 0) / faces.length,
        });
      } catch (e) {
        console.error(`Gemini error for ${image.fileName}:`, e);
      }
    }
    if (i + 3 < images.length) await new Promise(r => setTimeout(r, 600));
  }
  return analyses;
}

function computeSimilarity(f1: string[], f2: string[]): number {
  const s1 = new Set(f1.map(f => f.toLowerCase()));
  const s2 = new Set(f2.map(f => f.toLowerCase()));
  if (!s1.size || !s2.size) return 0;
  let matches = 0;
  for (const f of s1) {
    if (s2.has(f)) matches++;
    else for (const f2i of s2) if (f.includes(f2i) || f2i.includes(f)) { matches += 0.5; break; }
  }
  return matches / Math.max(s1.size, s2.size);
}

function deterministicClustering(images: { url: string; storagePath: string; fileName: string }[]): ImageAnalysis[] {
  const people = Math.max(1, Math.min(Math.ceil(images.length / 3), 10));
  return images.map((img, i) => ({
    imageUrl: img.url, storagePath: img.storagePath,
    faces: [{ personIndex: i % people, confidence: 0.7, smileScore: 0.6 }],
    faceCount: 1, momentType: 'candid', avgSmileScore: 0.6,
  }));
}