import { chromium } from "playwright";
import { createServer } from "vite";
import { mkdir, rename } from "node:fs/promises";
import path from "node:path";

const USERNAME = process.env.GITHUB_CARD_USER ?? "biokraft";
const GITCG_DIR = process.env.GITCG_DIR ?? "./gitcg";
const OUT_PATH = process.env.CARD_OUT ?? "./assets/card.png";
const TOKEN = process.env.GITHUB_TOKEN;

const server = await createServer({ root: GITCG_DIR, server: { port: 0 } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch();
const page = await browser.newPage();

if (TOKEN) {
  await page.route("https://api.github.com/**", async (route) => {
    const headers = { ...route.request().headers(), Authorization: `Bearer ${TOKEN}` };
    await route.continue({ headers });
  });
}

await page.goto(url);
await page.getByPlaceholder("github username...").fill(USERNAME);
await page.getByRole("button", { name: "GENERATE CARD" }).click();
await page.getByRole("button", { name: /export png/i }).waitFor({ timeout: 20000 });

const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 15000 }),
  page.getByRole("button", { name: /export png/i }).click(),
]);

await mkdir(path.dirname(OUT_PATH), { recursive: true });
await download.saveAs(OUT_PATH);

await browser.close();
await server.close();
console.log(`Saved card to ${OUT_PATH}`);
