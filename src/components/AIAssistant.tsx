import { useState, useRef, useEffect } from "react";
import { X, Send, Sparkles, RotateCcw, ChevronRight } from "lucide-react";
import { useLocation } from "react-router-dom";

type Message = { role: "user" | "assistant"; content: string; id: number };
const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

const PAGE_SUGGESTIONS: Record<string, string[]> = {
  "/admin/event": ["How do I cluster faces?", "Why are persons showing 0 photos?", "How to generate a QR code?", "How to merge similar persons?"],
  "/admin/events": ["How do I create an event?", "What is face clustering?", "How to delete an event?"],
  "/user/scan": ["How do I scan a QR code?", "Where do I get my QR code?", "I got access denied error"],
  "/gallery": ["How to download all photos?", "How to save favorites?", "Can I share photos?"],
  "/event": ["How to download all photos?", "What is the activity score?", "How do I share a photo?"],
};

const DEFAULT_SUGGESTIONS = ["How does FaceTag work?", "How do I find my photos?", "I'm an organizer, where do I start?"];

function getSuggestions(path: string) {
  for (const [key, val] of Object.entries(PAGE_SUGGESTIONS)) {
    if (path.includes(key)) return val;
  }
  return DEFAULT_SUGGESTIONS;
}

function renderContent(text: string) {
  return text.split("\n").map((line, i) => {
    if (!line.trim()) return <div key={i} className="h-2" />;
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return (
      <p key={i} className={line.startsWith("- ") || line.startsWith("• ") ? "pl-3 before:content-['•'] before:mr-2 before:text-blue-400" : ""}>
        {parts.map((p, j) =>
          p.startsWith("**") && p.endsWith("**")
            ? <strong key={j} className="font-semibold text-foreground">{p.slice(2,-2)}</strong>
            : <span key={j}>{line.startsWith("- ") || line.startsWith("• ") ? p.replace(/^[-•]\s*/,"") : p}</span>
        )}
      </p>
    );
  });
}

let idCtr = 0;

export function AIAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [usedSuggestions, setUsedSuggestions] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const location = useLocation();
  const suggestions = getSuggestions(location.pathname);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 150); }, [open]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    setInput("");
    setUsedSuggestions(true);
    const userMsg: Message = { role: "user", content, id: ++idCtr };
    const history = [...messages, userMsg];
    setMessages(history);
    setLoading(true);
    let assistantText = "";
    try {
      const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({ messages: history.map(m => ({ role: m.role, content: m.content })) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Error ${res.status}`);
      }
      const assistantMsg: Message = { role: "assistant", content: "", id: ++idCtr };
      setMessages(prev => [...prev, assistantMsg]);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") break;
          try {
            const chunk = JSON.parse(json).choices?.[0]?.delta?.content;
            if (chunk) {
              assistantText += chunk;
              const t = assistantText;
              setMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, content: t } : m));
            }
          } catch {}
        }
      }
    } catch (e: any) {
      const msg = e.message?.includes("429") ? "Rate limit reached. Please wait a moment and try again." : e.message || "Something went wrong. Please try again.";
      setMessages(prev => [...prev, { role: "assistant", content: `⚠️ ${msg}`, id: ++idCtr }]);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setMessages([]); setInput(""); setUsedSuggestions(false); };

  // Floating button
  if (!open) return (
    <button
      onClick={() => setOpen(true)}
      className="fixed bottom-6 right-6 z-50 group"
      aria-label="Open AI Assistant"
    >
      <div className="relative">
        <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl shadow-xl shadow-blue-500/30 flex items-center justify-center hover:shadow-blue-500/50 hover:scale-105 transition-all">
          <Sparkles className="h-6 w-6 text-white" />
        </div>
        <div className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-green-400 rounded-full border-2 border-background" />
      </div>
    </button>
  );

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col rounded-3xl border border-border bg-background shadow-2xl overflow-hidden" style={{ width: 380, height: 540 }}>
      {/* Header — like image 1 */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-background shrink-0">
        <div className="w-9 h-9 bg-blue-500 rounded-xl flex items-center justify-center shadow-md shadow-blue-500/25 shrink-0">
          <Sparkles className="h-4.5 w-4.5 text-white h-[18px] w-[18px]" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-sm text-foreground leading-none">AI Assistant</p>
          <p className="text-xs text-muted-foreground mt-0.5">Powered by Gemini AI</p>
        </div>
        <button onClick={reset} className="p-1.5 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-foreground" title="Clear">
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => setOpen(false)} className="p-1.5 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Empty state */}
        {messages.length === 0 && (
          <div className="py-2">
            <p className="text-sm text-foreground leading-relaxed mb-4">
              Hi! I'm your <strong>FaceTag assistant</strong>. I can help you with uploads, clustering, QR codes, and anything else about the app.
            </p>
            {/* Suggestion chips — like image 1 */}
            {!usedSuggestions && (
              <div className="space-y-2">
                {suggestions.map((s, i) => (
                  <button key={i} onClick={() => send(s)}
                    className="w-full text-left px-4 py-2.5 rounded-xl bg-muted/60 hover:bg-muted text-sm text-muted-foreground hover:text-foreground transition-all flex items-center justify-between group border border-border/50">
                    <span>{s}</span>
                    <ChevronRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Messages */}
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "assistant" && (
              <div className="w-6 h-6 bg-blue-500 rounded-lg flex items-center justify-center shrink-0 mr-2 mt-0.5">
                <Sparkles className="h-3 w-3 text-white" />
              </div>
            )}
            <div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm ${
              msg.role === "user"
                ? "bg-blue-500 text-white rounded-tr-sm"
                : "bg-muted text-foreground rounded-tl-sm space-y-1"
            }`}>
              {msg.role === "assistant" ? renderContent(msg.content) : <p>{msg.content}</p>}
            </div>
          </div>
        ))}

        {/* Typing dots */}
        {loading && (
          <div className="flex justify-start">
            <div className="w-6 h-6 bg-blue-500 rounded-lg flex items-center justify-center shrink-0 mr-2 mt-0.5">
              <Sparkles className="h-3 w-3 text-white" />
            </div>
            <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1 items-center">
              {[0,1,2].map(i => (
                <div key={i} className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60"
                  style={{ animation: `bounce 1.2s ease-in-out ${i*0.2}s infinite` }} />
              ))}
              <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}`}</style>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border p-3 flex gap-2 shrink-0 bg-background">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask anything about FaceTag…"
          className="flex-1 resize-none text-sm rounded-xl border border-border bg-muted/40 px-3 py-2 min-h-[38px] max-h-[80px] focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
          rows={1}
          disabled={loading}
        />
        <button onClick={() => send()} disabled={!input.trim() || loading}
          className="w-10 h-10 bg-blue-500 hover:bg-blue-400 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl flex items-center justify-center shrink-0 transition-colors">
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}