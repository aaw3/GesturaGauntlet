export class SimulatorClient {
  constructor(
    private baseUrl: string,
    private authToken?: string,
  ) {}

  async getJson<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {},
    });
    if (!res.ok) throw new Error(`GET ${path} failed`);
    return res.json();
  }

  async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path} failed`);
    return res.json();
  }
}
