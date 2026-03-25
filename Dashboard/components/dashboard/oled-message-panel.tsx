"use client";

import { useState } from "react";
import { Monitor, Send } from "lucide-react";

interface OledMessagePanelProps {
  onSendMessage: (message: string) => void;
}

export function OledMessagePanel({ onSendMessage }: OledMessagePanelProps) {
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);

  const handleSend = async () => {
    if (!message.trim()) return;
    
    setIsSending(true);
    await onSendMessage(message);
    setIsSending(false);
    setMessage("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSend();
    }
  };

  return (
    <div className="rounded-xl border border-border bg-gradient-to-br from-card to-card/80 p-6 ring-1 ring-primary/5">
      <div className="mb-4 flex items-center gap-2">
        <Monitor className="h-5 w-5 text-primary" />
        <h2 className="font-semibold text-card-foreground">OLED Display</h2>
      </div>

      {/* Mock OLED Preview */}
      <div className="mb-4 rounded-lg border border-primary/20 bg-background/80 p-4">
        <div className="flex h-16 items-center justify-center rounded-md border border-primary/40 bg-gradient-to-b from-muted/50 to-muted/20 font-mono text-sm text-primary shadow-inner">
          {message || "Enter a message..."}
        </div>
        <p className="mt-2 text-center text-xs text-muted-foreground">OLED Preview</p>
      </div>

      {/* Input Area */}
      <div className="space-y-3">
        <div className="relative">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            maxLength={32}
            className="w-full rounded-lg border border-border bg-secondary px-4 py-3 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {message.length}/32
          </span>
        </div>

        <button
          onClick={handleSend}
          disabled={!message.trim() || isSending}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
          {isSending ? "Sending..." : "Send to OLED"}
        </button>
      </div>

      <div className="mt-4 rounded-lg bg-secondary/50 p-3">
        <p className="text-center text-xs text-muted-foreground">
          Sends to{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-primary">
            /message?text=...
          </code>
        </p>
      </div>
    </div>
  );
}
