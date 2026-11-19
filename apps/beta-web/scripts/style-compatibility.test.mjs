import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "@playwright/test";

// These values were captured from Orchestra's Tailwind 3 stylesheet before the
// compiler upgrade, except the approved decision-desk dark border token. Run in a real browser: jsdom cannot evaluate CSS layers.
const root = new URL("../", import.meta.url);
let browser;
let css;
before(async () => {
  const input = new URL("src/index.css", root);
  const fixtureClasses = 'bg-bg1 text-text1 rounded rounded-sm rounded-full shadow-sm font-sans border disabled:opacity-40 disabled:cursor-not-allowed mt-3 hidden md:flex flex-shrink-0 lg:flex-shrink-0 bg-[#B8543D] hover:bg-[#A04830] transition-colors';
  css = (await postcss([tailwind({ optimize: true })]).process(`${await readFile(input, "utf8")}\n@source inline("${fixtureClasses}");`, {
    from: fileURLToPath(input),
  })).css;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); });

async function probe(markup, run, theme = "light", width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
  try {
    await page.setContent(`<html data-theme="${theme}"><head><style>${css}</style></head><body>${markup}</body></html>`);
    return await run(page);
  } finally { await page.close(); }
}

for (const theme of ["light", "dark"]) {
  test(`${theme}: selected chat timestamps meet normal-text contrast`, async () => {
    const nav = await readFile(new URL("src/components/shell/NavRail.tsx", root), "utf8");
    const timestampClass = nav.match(/<span className="([^"]+)">\s*\{formatDistanceToNow\(conv\.timestamp\)\}/)?.[1];
    assert(timestampClass, "Use the class from the actual chat history timestamp");
    await probe(`<a id="selected" class="bg-[var(--bg-inset)]"><span id="timestamp" class="${timestampClass}">Yesterday</span></a>`, async (page) => {
      const ratio = await page.locator("#timestamp").evaluate((label) => {
        const luminance = (color) => {
          const rgb = color.match(/\d+/g).slice(0, 3).map((channel) => {
            const s = Number(channel) / 255;
            return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
          });
          return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
        };
        const text = luminance(getComputedStyle(label).color);
        const background = luminance(getComputedStyle(label.parentElement).backgroundColor);
        return (Math.max(text, background) + .05) / (Math.min(text, background) + .05);
      });
      assert(ratio >= 4.5, `Selected chat timestamp contrast ${ratio.toFixed(3)}:1 must reach 4.5:1`);
    }, theme);
  });

  test(`${theme}: retained semantic surfaces, typography, radius and small shadow`, async () => {
    await probe('<div id="card" class="bg-bg1 text-text1 rounded shadow-sm font-sans">Card</div><div id="small" class="rounded-sm">Small</div><div id="pill" class="rounded-full">Pill</div>', async (page) => {
      const values = await page.evaluate(() => {
        const card = getComputedStyle(document.getElementById("card"));
        return { bg: card.backgroundColor, color: card.color, font: card.fontFamily, radius: card.borderRadius, shadow: card.boxShadow,
          small: getComputedStyle(document.getElementById("small")).borderRadius, pill: getComputedStyle(document.getElementById("pill")).borderRadius };
      });
      assert.equal(values.bg, theme === "light" ? "rgb(255, 255, 255)" : "rgb(26, 23, 20)");
      assert.equal(values.color, theme === "light" ? "rgb(26, 23, 20)" : "rgb(245, 239, 230)");
      assert.match(values.font, /^Geist,/);
      assert.equal(values.radius, "4px");
      assert.equal(values.small, "2px");
      assert.equal(values.pill, "9999px");
      assert.match(values.shadow, /rgba\(0, 0, 0, 0\.05\) 0px 1px 2px 0px/);
      assert.doesNotMatch(values.shadow, /3px/);
    }, theme);
  });

  test(`${theme}: transparent outline, visible focus and honest disabled controls survive`, async () => {
    await probe('<label>Email<input id="email" class="outline-none border" placeholder="Email"></label><button id="button">Continue</button><button id="disabled" disabled class="disabled:opacity-40 disabled:cursor-not-allowed">Busy</button>', async (page) => {
      assert.deepEqual(await page.locator("#email").evaluate((el) => { const s = getComputedStyle(el); return [s.outlineWidth, s.outlineStyle, s.outlineColor, s.outlineOffset, s.borderTopColor, getComputedStyle(el, "::placeholder").color]; }),
        ["2px", "solid", "rgba(0, 0, 0, 0)", "2px", theme === "light" ? "rgb(229, 231, 235)" : "rgb(57, 50, 43)", "rgb(156, 163, 175)"]);
      await page.locator("#email").focus();
      assert.deepEqual(await page.locator("#email").evaluate((el) => { const s = getComputedStyle(el); return [s.outlineWidth, s.outlineStyle, s.outlineColor, s.outlineOffset]; }),
        ["2px", "solid", "rgba(184, 84, 61, 0.4)", "2px"]);
      assert.equal(await page.locator("#button").evaluate((el) => getComputedStyle(el).cursor), "pointer");
      assert.deepEqual(await page.locator("#disabled").evaluate((el) => {const s = getComputedStyle(el); return [s.opacity, s.cursor];}), ["0.4", "not-allowed"]);
    }, theme);
  });

  test(`${theme}: the existing sidebar toggle does not acquire a new shadow`, async () => {
    await probe('<button id="toggle" class="shadow-[var(--shadow-elevated)]">Collapse sidebar</button>', async (page) => {
      assert.equal(await page.locator("#toggle").evaluate((el) => getComputedStyle(el).boxShadow), "none");
    }, theme);
  });
}

test("existing vertical spacing ignores hidden children and remains above subsequent rows", async () => {
  for (const [name, expected] of [["1", "4px"], ["2", "8px"], ["3", "12px"], ["4", "16px"], ["5", "20px"], ["7", "28px"], ["8", "32px"]]) {
    await probe(`<div id="list" class="space-y-${name}"><p class="mt-3">One</p><p hidden>Hidden</p><p>Two</p><p>Three</p></div>`, async (page) => {
      assert.deepEqual(await page.locator("#list").evaluate((el) => [...el.children].map((child) => {const s = getComputedStyle(child); return [s.marginTop, s.marginBottom];})), [["12px", "0px"], ["0px", "0px"], [expected, "0px"], [expected, "0px"]]);
    });
  }
});

test("existing row dividers stay on subsequent visible rows", async () => {
  for (const [color, expected] of [["#F2EDE6", "rgb(242, 237, 230)"], ["rgba(26,22,18,0.08)", "rgba(26, 22, 18, 0.08)"]]) {
    await probe(`<div id="list" class="divide-y divide-[${color}]"><p>One</p><p hidden>Hidden</p><p>Two</p><p>Three</p></div>`, async (page) => {
      assert.deepEqual(await page.locator("#list").evaluate((el) => [...el.children].map((child) => {const s = getComputedStyle(child); return [s.borderTopWidth, s.borderBottomWidth];})), [["0px", "0px"], ["0px", "0px"], ["1px", "0px"], ["1px", "0px"]]);
      assert.deepEqual(await page.locator("#list").evaluate((el) => [...el.children].slice(2).map((child) => getComputedStyle(child).borderTopColor)), [expected, expected]);
    });
  }
});

test("nested spacing uses each container's value without changing its parent's gap", async () => {
  await probe('<div class="space-y-4"><p>First</p><div id="nested" class="space-y-2"><p>Child one</p><p id="child">Child two</p></div></div>', async (page) => {
    assert.equal(await page.locator("#nested").evaluate((el) => getComputedStyle(el).marginTop), "16px");
    assert.equal(await page.locator("#child").evaluate((el) => getComputedStyle(el).marginTop), "8px");
  });
});

test("responsive layout and existing icon shrink behaviour preserve viewport boundaries", async () => {
  for (const width of [390, 768, 1280]) {
    await probe('<div id="layout" class="hidden md:flex"><span id="icon" class="flex-shrink-0 lg:flex-shrink-0">Icon</span></div>', async (page) => {
      assert.equal(await page.locator("#layout").evaluate((el) => getComputedStyle(el).display), width < 768 ? "none" : "flex");
      assert.equal(await page.locator("#icon").evaluate((el) => getComputedStyle(el).flexShrink), "0");
    }, "light", width);
  }
});

test("hover interactions preserve brand colours and transition scope", async () => {
  await probe('<button id="button" class="bg-[#B8543D] hover:bg-[#A04830] transition-colors">Continue</button>', async (page) => {
    assert.equal(await page.locator("#button").evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(184, 84, 61)");
    await page.locator("#button").hover();
    await page.waitForFunction(() => getComputedStyle(document.getElementById("button")).backgroundColor === "rgb(160, 72, 48)");
    assert.equal(await page.locator("#button").evaluate((el) => getComputedStyle(el).transitionProperty), "color, background-color, border-color, text-decoration-color, fill, stroke");
  });
});
