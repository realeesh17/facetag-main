import { useAuth } from "@/hooks/useAuth";
import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Camera, QrCode, Users, Sparkles, ArrowRight, Shield, Download, Share2, Zap, Star } from "lucide-react";

export default function Landing() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [mouse, setMouse] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!loading && user && profile) {
      if (profile.role === "admin") navigate("/admin/events");
      else navigate("/user/scan");
    }
  }, [user, profile, loading, navigate]);

  useEffect(() => {
    const onMouse = (e: MouseEvent) => setMouse({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", onMouse);
    return () => window.removeEventListener("mousemove", onMouse);
  }, []);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#06060A]">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border border-blue-500/20 animate-ping" />
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-500 animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center">
          <Camera className="h-5 w-5 text-blue-400" />
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#06060A] text-white overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none z-0" style={{ background: `radial-gradient(500px at ${mouse.x}px ${mouse.y}px, rgba(59,130,246,0.05) 0%, transparent 70%)` }} />
      <div className="fixed inset-0 pointer-events-none z-0 opacity-25" style={{ backgroundImage: `radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)`, backgroundSize: "32px 32px" }} />

      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-4 border-b border-white/5 bg-[#06060A]/90 backdrop-blur-xl">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/25">
            <Camera className="h-4 w-4 text-white" />
          </div>
          <span className="font-bold text-base">FaceTag</span>
        </div>
        <div className="hidden md:flex items-center gap-8 text-sm text-white/40">
          {["Features", "How it works", "For Organizers"].map(l => (
            <span key={l} className="hover:text-white/80 cursor-pointer transition-colors">{l}</span>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Link to="/auth" className="text-sm text-white/50 hover:text-white px-3 py-2 transition-colors">Sign in</Link>
          <Link to="/auth" className="text-sm bg-blue-500 hover:bg-blue-400 text-white px-5 py-2 rounded-lg font-medium transition-all shadow-lg shadow-blue-500/20">Get started</Link>
        </div>
      </nav>

      <section className="relative min-h-screen flex flex-col items-center justify-center px-4 pt-24 pb-16">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-blue-600/8 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/4 w-64 h-64 bg-purple-600/5 rounded-full blur-3xl" />

        <div className="relative z-10 text-center max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-blue-500/10 border border-blue-500/15 text-blue-400 px-4 py-1.5 rounded-full text-xs font-medium tracking-wide mb-8">
            <Sparkles className="h-3.5 w-3.5" />
            Face++ AI · 92% accuracy · Gemini-powered
          </div>
          <h1 className="text-[3.5rem] md:text-[5.5rem] font-black tracking-tight leading-none mb-6">
            <span className="block text-white">Find yourself</span>
            <span className="block bg-gradient-to-r from-blue-400 to-blue-200 bg-clip-text text-transparent">in every photo</span>
          </h1>
          <p className="text-lg text-white/35 max-w-xl mx-auto mb-10 leading-relaxed">
            Scan one QR code at any event. AI instantly shows every photo you're in. No scrolling, no searching.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-16">
            <Link to="/auth" className="group inline-flex items-center gap-2 bg-white text-black font-semibold px-7 py-3.5 rounded-xl hover:bg-blue-50 transition-all text-sm">
              <QrCode className="h-4 w-4" />Find My Photos<ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <Link to="/auth" className="inline-flex items-center gap-2 bg-white/5 hover:bg-white/8 border border-white/8 text-white/70 font-medium px-7 py-3.5 rounded-xl transition-all text-sm">
              <Camera className="h-4 w-4" />I'm an Organizer
            </Link>
          </div>
          <div className="flex flex-wrap justify-center gap-x-10 gap-y-4">
            {[["92%","Face accuracy"],["< 2s","Discovery time"],["∞","Photos/event"],["100%","Privacy"]].map(([n,l]) => (
              <div key={l} className="text-center">
                <div className="text-2xl font-black text-white">{n}</div>
                <div className="text-xs text-white/25 mt-0.5">{l}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 w-full max-w-3xl mx-auto mt-16">
          <div className="rounded-2xl border border-white/8 bg-white/3 backdrop-blur-sm shadow-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/2">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/50" />
              <div className="flex-1 mx-4 h-5 bg-white/5 rounded-md" />
            </div>
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-sm font-bold">R</div>
                  <div>
                    <div className="text-sm font-semibold text-white">Rakesh's Gallery</div>
                    <div className="text-xs text-white/30">Trophy Event · 12 photos</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <span className="text-xs bg-blue-500/15 text-blue-400 px-3 py-1 rounded-full border border-blue-500/20">Download All</span>
                </div>
              </div>
              <div className="mb-4 p-3 rounded-xl bg-blue-500/5 border border-blue-500/10 flex items-center gap-6">
                <div className="text-center"><div className="text-xl font-black text-blue-400">12</div><div className="text-xs text-white/25">your photos</div></div>
                <div className="text-center"><div className="text-xl font-black text-blue-400">37%</div><div className="text-xs text-white/25">of event</div></div>
                <div className="flex-1"><div className="h-1.5 bg-white/5 rounded-full"><div className="h-full w-[37%] bg-blue-500 rounded-full" /></div></div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {Array.from({length:8}).map((_,i) => (
                  <div key={i} className={`rounded-lg overflow-hidden flex items-center justify-center ${i===0?"col-span-2 row-span-2":""}`}
                    style={{aspectRatio:"1",background:`linear-gradient(135deg,hsl(${215+i*12},60%,${18+i*2}%),hsl(${230+i*8},50%,${12+i*3}%))`}}>
                    <Users className="h-5 w-5 text-white/10" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-28 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <div className="text-xs text-blue-400 font-semibold tracking-widest uppercase mb-3">How it works</div>
            <h2 className="text-4xl font-black tracking-tight text-white">Three steps. Zero effort.</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              {icon:Camera,n:"01",title:"Upload & Cluster",desc:"Admin uploads event photos. Face++ AI detects and groups every face automatically."},
              {icon:QrCode,n:"02",title:"Share QR Code",desc:"Admin names each person and generates a unique QR. Share via WhatsApp or email."},
              {icon:Download,n:"03",title:"Instant Gallery",desc:"Guests scan their QR. Instantly see only their photos. Download HD or share to social."},
            ].map(item => (
              <div key={item.n} className="relative bg-white/2 border border-white/6 rounded-2xl p-7 hover:border-blue-500/20 hover:bg-white/3 transition-all group">
                <div className="text-5xl font-black text-white/4 absolute top-5 right-6">{item.n}</div>
                <div className="w-11 h-11 bg-blue-500/10 border border-blue-500/15 rounded-xl flex items-center justify-center mb-5">
                  <item.icon className="h-5 w-5 text-blue-400" />
                </div>
                <h3 className="font-bold text-white mb-2">{item.title}</h3>
                <p className="text-white/35 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-10 px-4">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            {icon:Zap,title:"Face++ Engine",desc:"92% accuracy face recognition for reliable clustering.",col:"text-blue-400",bg:"bg-blue-500/8 border-blue-500/12"},
            {icon:Shield,title:"Secure Tokens",desc:"Cryptographic tokens in each QR. Only you see your photos.",col:"text-green-400",bg:"bg-green-500/8 border-green-500/12"},
            {icon:Users,title:"AI Clustering",desc:"Auto-groups faces. Gemini AI merges duplicates.",col:"text-purple-400",bg:"bg-purple-500/8 border-purple-500/12"},
            {icon:Share2,title:"Social Sharing",desc:"Share to WhatsApp, Instagram, Facebook from your gallery.",col:"text-pink-400",bg:"bg-pink-500/8 border-pink-500/12"},
            {icon:Download,title:"HD Downloads",desc:"Full-resolution downloads, individually or all at once.",col:"text-orange-400",bg:"bg-orange-500/8 border-orange-500/12"},
            {icon:Star,title:"Favorites",desc:"Heart your best moments and build a personal collection.",col:"text-yellow-400",bg:"bg-yellow-500/8 border-yellow-500/12"},
          ].map(f => (
            <div key={f.title} className={`border rounded-xl p-5 hover:scale-[1.02] transition-all ${f.bg}`}>
              <f.icon className={`h-5 w-5 mb-3 ${f.col}`} />
              <h3 className="font-semibold text-white text-sm mb-1">{f.title}</h3>
              <p className="text-white/30 text-xs leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="py-28 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <div className="relative rounded-3xl border border-blue-500/15 bg-gradient-to-b from-blue-500/8 to-transparent p-12">
            <div className="w-14 h-14 bg-blue-500/15 border border-blue-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Camera className="h-7 w-7 text-blue-400" />
            </div>
            <h2 className="text-3xl md:text-4xl font-black tracking-tight text-white mb-3">Ready to find your photos?</h2>
            <p className="text-white/30 mb-8 text-sm">For event attendees and organizers alike.</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link to="/auth" className="inline-flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-400 text-white font-semibold px-7 py-3.5 rounded-xl transition-all text-sm shadow-lg shadow-blue-500/20">
                <QrCode className="h-4 w-4" />Find My Photos
              </Link>
              <Link to="/auth" className="inline-flex items-center justify-center gap-2 bg-white/5 hover:bg-white/8 border border-white/8 text-white/60 px-7 py-3.5 rounded-xl transition-all text-sm">
                <Camera className="h-4 w-4" />Organize Event
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/4 py-8 px-8 flex items-center justify-between text-white/20 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 bg-blue-500 rounded flex items-center justify-center"><Camera className="h-3 w-3 text-white" /></div>
          <span className="font-semibold text-white/30">FaceTag</span>
        </div>
        <span>AI-powered event photo platform · Face++ &amp; Gemini AI</span>
        <span>© 2026</span>
      </footer>
    </div>
  );
}