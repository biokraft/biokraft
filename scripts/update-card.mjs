import { chromium } from "playwright";
import { createServer } from "vite";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const USERNAME = process.env.GITHUB_CARD_USER ?? "biokraft";
const GITCG_DIR = process.env.GITCG_DIR ?? "./gitcg";
const OUT_PATH = process.env.CARD_OUT ?? "./assets/card.png";
const TOKEN = process.env.GITHUB_TOKEN;

// how far left of dead-center the card sits in the final image, as a
// fraction of the card's own width
const LEFT_SHIFT_FRACTION = 0.05;
// extra transparent canvas room on each side so the shift has space to live in
const CANVAS_PADDING_FRACTION = 0.15;

const server = await createServer({ root: GITCG_DIR, server: { port: 0 } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 900, height: 1400 },
});

if (TOKEN) {
  await page.route("https://api.github.com/**", async (route) => {
    const headers = { ...route.request().headers(), Authorization: `Bearer ${TOKEN}` };
    await route.continue({ headers });
  });
}

await page.goto(url);
await page.getByPlaceholder("github username...").fill(USERNAME);
await page.getByRole("button", { name: "GENERATE CARD" }).click();
await page.locator("#cardSection.show").waitFor({ timeout: 20000 });
await page.locator("#card .c-name").filter({ hasText: USERNAME }).waitFor();

// let webfonts + entrance animations fully settle before exporting
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1500);

const workDir = await mkdtemp(path.join(tmpdir(), "gitcg-card-"));
const rawPath = path.join(workDir, "raw.png");

const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 15000 }),
  page.getByRole("button", { name: /export png/i }).click(),
]);
await download.saveAs(rawPath);

await browser.close();
await server.close();

await mkdir(path.dirname(OUT_PATH), { recursive: true });

// bake the left-shift into the pixels so a plain centered <img> in the
// README renders it exactly the same everywhere, no relying on markdown/CSS
await execFileP("ffmpeg", [
  "-y",
  "-i", rawPath,
  "-vf",
  [
    "format=rgba",
    `pad=width=iw*${1 + CANVAS_PADDING_FRACTION * 2}:height=ih:` +
      `x='(ow-iw)/2-iw*${LEFT_SHIFT_FRACTION}':y=0:color=black@0`,
  ].join(","),
  OUT_PATH,
]);

await rm(workDir, { recursive: true, force: true });
console.log(`Saved card to ${OUT_PATH}`);
