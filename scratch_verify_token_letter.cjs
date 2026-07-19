const { chromium } = require("playwright-core");

const APP_URL = "http://localhost:5183";
const EXE = "C:/Program Files/Google/Chrome/Application/chrome.exe";

async function stepDrag(page, from, to, steps = 20) {
  await page.mouse.move(from.x, from.y);
  await page.waitForTimeout(50);
  await page.mouse.down();
  await page.waitForTimeout(50);
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await page.mouse.move(x, y);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(100);
  const el = await page.evaluate(({ x, y }) => {
    const e = document.elementFromPoint(x, y);
    return e ? e.outerHTML.slice(0, 200) : null;
  }, to);
  console.log("Element under drop point:", el);
  await page.mouse.up();
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.log("CONSOLE ERROR:", m.text());
  });

  await page.goto(APP_URL);
  await page.click("text=+ New");
  await page.fill('input[placeholder="The Sunken Keep"]', "Letter Test Room 2");
  await page.click('button:has-text("Create")');
  await page.click('button:has-text("Enter campaign")');

  await page.waitForSelector(".map-root canvas", { timeout: 15000 });
  await page.waitForTimeout(2000);

  await page.click('button[title="Actors"]');
  await page.waitForTimeout(500);

  const chip = await page.$(".dir-blank-chip");
  if (!chip) {
    console.log("NO BLANK CHIP FOUND");
  } else {
    const chipBox = await chip.boundingBox();
    console.log("chipBox:", chipBox);
    const from = { x: chipBox.x + chipBox.width / 2, y: chipBox.y + chipBox.height / 2 };
    const to = { x: 400, y: 300 };
    console.log("from:", from, "to:", to);
    await stepDrag(page, from, to);
    await page.waitForTimeout(1000);
  }

  await page.screenshot({ path: "c:/Projects/DnD/campaign-manager/scratch_token_letter.png" });

  await browser.close();
})();
