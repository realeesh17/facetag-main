import { useState, useRef, useEffect } from "react";
import { Bot, X, Send, Loader2, MessageCircle, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useLocation } from "react-router-dom";

type Message = { role: "user" | "assistant"; content: string; id: number };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

// Quick suggestion chips based on current page
const getSuggestions = (path: string) => {
  if (path.includes("/admin/event/")) {
    return [
      "How do I cluster faces?",
      "Why are persons showing 0 photos?",
      "How do I generate a QR code?",
      "How to merge similar persons?",
    ];
  }
  if (path.includes("/admin/events")) {
    return [
      "How do I create an event?",
      "How to delete an event?",
      "What is face clustering?",
    ];
  }
  if (path.includes("/user/scan")) {
    return [
      "How do I scan a QR code?",
      "Where do I get my QR code?",
      "I entered the code but got access denied",
    ];
  }
  if (path.includes("/gallery") || path.includes("/event/")) {
    return [
      "How do I download all photos?",
      "How to save favorites?",
      "Can I share photos?",
    ];
  }
  return [
    "How does FaceTag work?",
    "How do I find my photos?",
    "I'm an event organizer, how do I start?",
  ];
};

// Simple markdown-like renderer
function MessageContent({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith("## ")) return <p key={i} className="font-bold text-base">{line.slice(3)}</p>;
        if (line.startsWith("# ")) return <p key={i} className="font-bold text-lg">{line.slice(2)}</p>;
        if (line.match(/^\d+\.\s/)) return <p key={i} className="ml-2">• {line.replace(/^\d+\.\s/, "")}</p>;
        if (line.startsWith("- ") || line.startsWith("• ")) return <p key={i} className="ml-2">• {line.slice(2)}</p>;
        if (line.startsWith("**") && line.endsWith("**")) return <p key={i} className="font-semibold">{line.slice(2, -2)}</p>;
        if (line.trim() === "") return <div key={i} className="h-1" />;
        // Inline bold
        const parts = line.split(/(\*\*[^*]+\*\*)/g);
        return (
          <p key={i}>
            {parts.map((part, j) =>
              part.startsWith("**") && part.endsWith("**")
                ? <strong key={j}>{part.slice(2, -2)}</strong>
                : part
            )}
          </p>
        );
      })}
    </div>
  );
}

// Typing dots animation
function TypingDots() {
  return (
    <div className="flex gap-1 items-center px-1 py-1">
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="w-2 h-2 rounded-full bg-primary/50"
          style={{ animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
        />
      ))}
      <style>{`@keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-6px)} }`}</style>
    </div>
  );
}

let msgIdCounter = 0;

export function AIAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const location = useLocation();
  const suggestions = getSuggestions(location.pathname);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const send = async (text?: string) => {
    const content = (text || input).trim();
    if (!content || isLoading) return;

    setInput("");
    setShowSuggestions(false);

    const userMsg: Message = { role: "user", content, id: ++msgIdCounter };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setIsLoading(true);

    let assistantText = "";

    try {
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: newMessages.map(m => ({ role: m.role, content: m.content })) }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || `Server error ${resp.status}`);
      }

      if (!resp.body) throw new Error("No response body");

      const assistantMsg: Message = { role: "assistant", content: "", id: ++msgIdCounter };
      setMessages(prev => [...prev, assistantMsg]);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") break;
          try {
            const parsed = JSON.parse(json);
            const chunk = parsed.choices?.[0]?.delta?.content;
            if (chunk) {
              assistantText += chunk;
              const text = assistantText;
              setMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, content: text } : m));
            }
          } catch {}
        }
      }

      // Handle remaining buffer
      if (buffer.startsWith("data: ")) {
        const json = buffer.slice(6).trim();
        if (json !== "[DONE]") {
          try {
            const parsed = JSON.parse(json);
            const chunk = parsed.choices?.[0]?.delta?.content;
            if (chunk) {
              assistantText += chunk;
              setMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, content: assistantText } : m));
            }
          } catch {}
        }
      }

    } catch (e: any) {
      console.error("Chat error:", e);
      const errMsg = e.message?.includes("429")
        ? "Too many requests. Please wait a moment and try again."
        : e.message || "Something went wrong. Please try again.";
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `⚠️ ${errMsg}`,
        id: ++msgIdCounter
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const reset = () => {
    setMessages([]);
    setShowSuggestions(true);
    setInput("");
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 flex items-center justify-center transition-all hover:scale-110 hover:shadow-xl"
        aria-label="Open AI Assistant"
      >
        <MessageCircle className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col rounded-2xl border border-border bg-background shadow-2xl overflow-hidden"
      style={{ width: 380, height: 520 }}>

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-primary text-primary-foreground shrink-0">
        <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-sm">FaceTag Assistant</p>
          <p className="text-xs opacity-75">Powered by Gemini AI</p>
        </div>
        <button onClick={reset} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors" title="Clear chat">
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => setOpen(false)} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Welcome message */}
        {messages.length === 0 && (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <Bot className="h-6 w-6 text-primary" />
            </div>
            <p className="font-medium text-sm mb-1">Hi! I'm FaceTag Assistant</p>
            <p className="text-xs text-muted-foreground">Ask me anything about the app</p>
          </div>
        )}

        {/* Messages */}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "assistant" && (
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                <Sparkles className="h-3 w-3 text-primary" />
              </div>
            )}
            <div className={`max-w-[82%] rounded-2xl px-3 py-2 ${
              msg.role === "user"
                ? "bg-primary text-primary-foreground rounded-tr-sm"
                : "bg-muted text-foreground rounded-tl-sm"
            }`}>
              {msg.role === "assistant"
                ? <MessageContent content={msg.content} />
                : <p className="text-sm">{msg.content}</p>
              }
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {isLoading && (
          <div className="flex gap-2 justify-start">
            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
              <Sparkles className="h-3 w-3 text-primary" />
            </div>
            <div className="bg-muted rounded-2xl rounded-tl-sm px-3 py-1">
              <TypingDots />
            </div>
          </div>
        )}

        {/* Quick suggestions */}
        {showSuggestions && messages.length === 0 && (
          <div className="space-y-2 pt-2">
            <p className="text-xs text-muted-foreground text-center">Quick questions</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => send(s)}
                  className="text-xs px-3 py-1.5 rounded-full border border-border hover:border-primary hover:bg-primary/5 hover:text-primary transition-all text-left"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border p-3 flex gap-2 shrink-0 bg-background">
        <Textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything…"
          className="min-h-[38px] max-h-[80px] resize-none text-sm rounded-xl"
          rows={1}
          disabled={isLoading}
        />
        <Button
          size="icon"
          onClick={() => send()}
          disabled={!input.trim() || isLoading}
          className="shrink-0 h-10 w-10 rounded-xl"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}