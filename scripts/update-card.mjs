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
const OUT_PATH = process.env.CARD_OUT ?? "./assets/card.gif";
const TOKEN = process.env.GITHUB_TOKEN;

const FRAME_COUNT = 30; // one full back-and-forth cycle
const SHIFT_PX = 14; // how far the card drifts each side
const FPS = 12;
const OUT_WIDTH = 420; // matches README display width

const server = await createServer({ root: GITCG_DIR, server: { port: 0 } });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 900, height: 1400 },
  deviceScaleFactor: 1,
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

// let webfonts + entrance animations fully settle before capturing anything
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1500);

const card = page.locator("#card");
const baseBox = await card.boundingBox();
if (!baseBox) throw new Error("Card was not rendered");

// widen the clip so the card never gets cropped as it drifts sideways
const clip = {
  x: Math.max(0, baseBox.x - SHIFT_PX - 4),
  y: baseBox.y - 4,
  width: baseBox.width + (SHIFT_PX + 4) * 2,
  height: baseBox.height + 8,
};

const frameDir = await mkdtemp(path.join(tmpdir(), "gitcg-frames-"));

for (let i = 0; i < FRAME_COUNT; i++) {
  // ping-pong offset: -SHIFT -> +SHIFT -> -SHIFT over the cycle
  const t = i / FRAME_COUNT;
  const offset = SHIFT_PX * Math.sin(t * Math.PI * 2);
  await page.evaluate((px) => {
    document.getElementById("card").style.transform = `translateX(${px}px)`;
  }, offset);
  await page.waitForTimeout(30);
  const framePath = path.join(frameDir, `frame-${String(i).padStart(3, "0")}.png`);
  await page.screenshot({ path: framePath, clip });
}

await browser.close();
await server.close();

await mkdir(path.dirname(OUT_PATH), { recursive: true });

const palettePath = path.join(frameDir, "palette.png");
const scaleFilter = `scale=${OUT_WIDTH}:-1:flags=lanczos`;

await execFileP("ffmpeg", [
  "-y",
  "-framerate", String(FPS),
  "-i", path.join(frameDir, "frame-%03d.png"),
  "-vf", `${scaleFilter},palettegen=stats_mode=diff`,
  palettePath,
]);
await execFileP("ffmpeg", [
  "-y",
  "-framerate", String(FPS),
  "-i", path.join(frameDir, "frame-%03d.png"),
  "-i", palettePath,
  "-lavfi", `${scaleFilter}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
  "-loop", "0",
  OUT_PATH,
]);

await rm(frameDir, { recursive: true, force: true });
console.log(`Saved animated card to ${OUT_PATH}`);
