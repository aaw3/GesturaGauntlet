"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEFAULT_BACKEND_URL, fetchBackend } from "@/lib/backend-auth";

export default function LoginPage() {
  const router = useRouter();
  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND_URL);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("Enter the dashboard password.");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setStatus("Signing in.");

    try {
      const response = await fetchBackend(`${backendUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `Login failed (${response.status})`);
      }

      router.replace("/");
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Login failed.");
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
