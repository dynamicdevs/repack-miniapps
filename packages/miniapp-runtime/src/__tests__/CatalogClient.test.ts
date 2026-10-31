import { httpCatalogClient } from "../CatalogClient.js";

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("httpCatalogClient", () => {
  it("returns the miniapps list", async () => {
    globalThis.fetch = fakeFetch(200, {
      miniapps: [
        { id: "a", name: "A", owner: "team", latestVersion: "1.0.0", versionCount: 2 },
        { id: "b", name: "B", owner: "team", latestVersion: null, versionCount: 0 },
      ],
    });
    const client = httpCatalogClient("https://backstage.example/");
    const list = await client.list();
    expect(list).toHaveLength(2);
    expect(list[0]?.latestVersion).toBe("1.0.0");
    expect(list[1]?.latestVersion).toBeNull();
  });

  it("returns [] when the payload has no miniapps", async () => {
    globalThis.fetch = fakeFetch(200, {});
    expect(await httpCatalogClient("https://x").list()).toEqual([]);
  });

  it("pide el catálogo de su host (host@contractVersion)", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => ({ miniapps: [] }) };
    }) as unknown as typeof fetch;
    await httpCatalogClient("https://x/", { host: "mi-banco", hostContractVersion: "1.2.0" }).list();
    await httpCatalogClient("https://x", { hostContractVersion: "1.2.0" }).list();
    expect(urls).toEqual(["https://x/api/miniapps?host=mi-banco%401.2.0", "https://x/api/miniapps?host=1.2.0"]);
  });

  it("throws on a non-2xx response", async () => {
    globalThis.fetch = fakeFetch(500, {});
    await expect(httpCatalogClient("https://x").list()).rejects.toThrow("HTTP 500");
  });
});
