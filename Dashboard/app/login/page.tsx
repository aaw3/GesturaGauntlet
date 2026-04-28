"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("Enter the dashboard password.");
  const [submitting, setSubmitting] = useState(false);

const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();

  if (submitting) return;

  setSubmitting(true);
  setStatus("Signing in.");

  try {
    const response = await fetch('/api/auth/login', {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      redirect: "manual",
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      setStatus(payload.error || "Invalid username or password.");
      setPassword("");
      setSubmitting(false);
      return;
    }

    router.replace("/");
  } catch {
    setStatus("Could not reach the backend. Check the backend URL and try again.");
    setSubmitting(false);
  }
};

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <form
        className="flex w-full max-w-sm flex-col gap-5 rounded-lg border border-border bg-card p-6"
        onSubmit={handleSubmit}
      >
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Lock className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Dashboard Login</h1>
            <p className="text-sm text-muted-foreground">Central control plane access</p>
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="username">Username</Label>
          <Input id="username" value={username} onChange={(event) => setUsername(event.target.value)} />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={submitting}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <Button type="submit" disabled={submitting}>
          <LogIn className="size-4" />
          Sign In
        </Button>

        <p className="text-sm text-muted-foreground">{status}</p>
      </form>
    </main>
  );
}
