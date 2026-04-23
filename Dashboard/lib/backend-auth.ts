const ENV_BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

export const DEFAULT_BACKEND_URL =
  ENV_BACKEND_URL || "http://localhost:3001";

// Log once on module load (client-side)
if (typeof window !== "undefined") {
  console.log("[Backend URL Debug] NEXT_PUBLIC_BACKEND_URL =", ENV_BACKEND_URL);
  console.log(
    "[Backend URL Debug] Using",
    ENV_BACKEND_URL ? "ENV value" : "FALLBACK",
    "=>",
    DEFAULT_BACKEND_URL
  );
}

export async function fetchBackend(path: string, init: RequestInit = {}) {
  const isAbsolute = /^https?:\/\//.test(path);
  const url = isAbsolute ? path : `${DEFAULT_BACKEND_URL}${path}`;

  if (typeof window !== "undefined") {
    console.log("[fetchBackend]", {
      input: path,
      isAbsolute,
      base: DEFAULT_BACKEND_URL,
      finalUrl: url,
    });
  }

  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.headers || {}),
    },
  });

  if (response.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login";
  }

  return response;
}