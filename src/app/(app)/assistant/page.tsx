"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert, Button, Card, EmptyState, Input, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/client/api";
import { useApp } from "@/lib/client/hooks";

type AssistantSource = { label: string; href: string };
type AssistantResponse = { answer: string; intent: string; sources: AssistantSource[]; suggestions: string[] };
type ChatMessage = { id: number; role: "user" | "assistant"; text: string; sources?: AssistantSource[] };

const DEFAULT_SUGGESTIONS = [
  "What needs attention on this farm?",
  "What is the maize yield estimate?",
  "Should I irrigate?",
  "How does the AI decide?",
  "Where do readings come from?",
];

function greeting(farmName?: string) {
  return `Hello — I’m the AgriSense assistant for ${farmName ?? "your farm"}. Ask me about current readings, irrigation, yield estimates, active risks or how the rule engine explains its decisions.`;
}

function MessageText({ text }: { text: string }) {
  return (
    <div className="text-sm leading-relaxed">
      {text.split("\n").filter(Boolean).map((line, index) => (
        <p key={index} className={line.startsWith("• ") ? "pl-3" : undefined}>
          {line}
        </p>
      ))}
    </div>
  );
}

function AssistantChat({ farmId, farmName }: { farmId: string; farmName?: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => [{ id: 1, role: "assistant", text: greeting(farmName) }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>(DEFAULT_SUGGESTIONS);
  const nextId = useRef(2);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, loading]);

  const reset = () => {
    nextId.current = 2;
    setMessages([{ id: 1, role: "assistant", text: greeting(farmName) }]);
    setSuggestions(DEFAULT_SUGGESTIONS);
    setError(null);
    setInput("");
  };

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || loading) return;
    const userId = nextId.current++;
    setMessages((current) => [...current, { id: userId, role: "user" as const, text }].slice(-40));
    setInput("");
    setError(null);
    setLoading(true);
    try {
      const result = await api<AssistantResponse>("/assistant/ask", {
        method: "POST",
        body: { question: text, farmId },
      });
      setMessages((current) => [...current, { id: nextId.current++, role: "assistant" as const, text: result.answer, sources: result.sources }].slice(-40));
      if (result.suggestions?.length) setSuggestions(result.suggestions);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void ask(input);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <Card className="flex min-h-[32rem] flex-col p-0">
        <div className="flex items-center gap-2 border-b border-stone-200 px-4 py-3">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-leaf-100 text-base" aria-hidden>✨</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-stone-900">AgriSense Assistant</p>
            <p className="truncate text-xs text-stone-500">Grounded in {farmName ?? "your selected farm"}</p>
          </div>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={reset}>
            New conversation
          </Button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto bg-stone-50/60 px-4 py-4 sm:px-5" aria-live="polite">
          {messages.map((message) => (
            <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={message.role === "user" ? "max-w-[85%] rounded-2xl rounded-br-sm bg-leaf-700 px-4 py-2.5 text-white" : "max-w-[85%] rounded-2xl rounded-bl-sm border border-stone-200 bg-white px-4 py-2.5 text-stone-800 shadow-sm"}>
                <MessageText text={message.text} />
                {!!message.sources?.length && (
                  <div className="mt-3 flex flex-wrap gap-1.5 border-t border-stone-100 pt-2">
                    {message.sources.map((source) => (
                      <Link key={source.href} href={source.href} className="rounded-full bg-leaf-50 px-2 py-1 text-xs font-medium text-leaf-800 hover:bg-leaf-100">
                        {source.label} ↗
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-sm border border-stone-200 bg-white px-4 py-2.5 text-sm text-stone-500 shadow-sm" role="status">
                <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-leaf-600 align-middle motion-reduce:animate-none" />
                Checking the farm records…
              </div>
            </div>
          )}
          <div ref={bottom} />
        </div>
        {error && <div className="px-4 pt-3"><Alert tone="error">{error}</Alert></div>}
        <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-stone-200 bg-white px-4 py-3">
          <Input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask about readings, irrigation, yield, risks…"
            aria-label="Ask the AgriSense assistant"
            maxLength={500}
            autoComplete="off"
          />
          <Button type="submit" loading={loading} disabled={!input.trim()}>
            Send
          </Button>
        </form>
      </Card>
      <Card title="Suggested questions" subtitle="Tap one to ask it now">
        <div className="space-y-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => void ask(suggestion)}
              disabled={loading}
              className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-left text-sm text-stone-700 transition hover:border-leaf-300 hover:bg-leaf-50 disabled:opacity-60"
            >
              {suggestion}
            </button>
          ))}
        </div>
        <p className="mt-4 rounded-xl bg-stone-50 p-3 text-xs leading-relaxed text-stone-600">
          The assistant answers from current farm records and the explainable rule engine. Open a linked page to see the underlying values and reasons.
        </p>
      </Card>
    </div>
  );
}

export default function AssistantPage() {
  const { farmId, farms } = useApp();
  const farm = farms.find((f) => f.id === farmId);
  return (
    <>
      <PageHeader
        title="AI Assistant"
        description="Ask questions about this farm. Answers come from the same readings, soil data, weather, predictions and rule-engine explanations used across AgriSense."
      />
      {!farmId ? (
        <EmptyState title="No farm selected" action={<Link href="/farms?new=1" className="text-sm font-semibold text-leaf-700 hover:underline">Add a farm</Link>} />
      ) : (
        <AssistantChat key={farmId} farmId={farmId} farmName={farm?.name} />
      )}
    </>
  );
}
