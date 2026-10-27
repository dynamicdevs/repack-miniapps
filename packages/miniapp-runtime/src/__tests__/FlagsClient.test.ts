import { FLAGS_FALLBACK, httpFlagsClient } from "../FlagsClient.js";

describe("httpFlagsClient", () => {
  afterEach(() => jest.useRealTimers());

  it("un 200 devuelve el cuerpo y arma la URL con subject", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (u: string) => {
      urls.push(u);
      return { ok: true, status: 200, json: async () => ({ available: false, channel: "candidate" }) };
    }) as unknown as typeof fetch;
    const c = httpFlagsClient("http://x", { fetchImpl });
    expect(await c.evaluate("a b", "u1")).toEqual({ available: false, channel: "candidate" });
    expect(urls[0]).toBe("http://x/api/flags?id=a%20b&subject=u1");
  });

  it("sin subject omite el parámetro", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (u: string) => {
      urls.push(u);
      return { ok: true, status: 200, json: async () => ({ available: true, channel: "stable" }) };
    }) as unknown as typeof fetch;
    await httpFlagsClient("http://x", { fetchImpl }).evaluate("acc", null);
    expect(urls[0]).toBe("http://x/api/flags?id=acc");
  });

  it("un 500 devuelve FLAGS_FALLBACK", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    expect(await httpFlagsClient("http://x", { fetchImpl }).evaluate("a", null)).toEqual(FLAGS_FALLBACK);
  });

  it("un cuerpo inválido devuelve FLAGS_FALLBACK", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ available: "si", channel: "beta" }),
    })) as unknown as typeof fetch;
    expect(await httpFlagsClient("http://x", { fetchImpl }).evaluate("a", null)).toEqual(FLAGS_FALLBACK);
  });

  it("si el fetch nunca responde, devuelve FLAGS_FALLBACK a los 2000 ms", async () => {
    jest.useFakeTimers();
    const fetchImpl = (() => new Promise(() => {})) as unknown as typeof fetch;
    const p = httpFlagsClient("http://x", { fetchImpl }).evaluate("a", null);
    let done = false;
    void p.then(() => {
      done = true;
    });
    await jest.advanceTimersByTimeAsync(1999);
    expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(await p).toEqual(FLAGS_FALLBACK);
  });

  it("con platform=ios, incluye el parámetro en la URL", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (u: string) => {
      urls.push(u);
      return { ok: true, status: 200, json: async () => ({ available: false, channel: "candidate" }) };
    }) as unknown as typeof fetch;
    const c = httpFlagsClient("http://x", { fetchImpl, platform: "ios" });
    expect(await c.evaluate("minima", "user-001")).toEqual({ available: false, channel: "candidate" });
    expect(urls[0]).toBe("http://x/api/flags?id=minima&subject=user-001&platform=ios");
  });

  it("con platform=android, incluye el parámetro en la URL", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (u: string) => {
      urls.push(u);
      return { ok: true, status: 200, json: async () => ({ available: true, channel: "stable" }) };
    }) as unknown as typeof fetch;
    const c = httpFlagsClient("http://x", { fetchImpl, platform: "android" });
    expect(await c.evaluate("minima", "user-001")).toEqual({ available: true, channel: "stable" });
    expect(urls[0]).toBe("http://x/api/flags?id=minima&subject=user-001&platform=android");
  });
});
