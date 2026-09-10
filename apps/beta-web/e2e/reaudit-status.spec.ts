import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(`[R09] verified-email status is readable in ${theme} theme`, async ({ page }) => {
    await page.addInitScript((mode) => localStorage.setItem("orchestra-theme", mode), theme);
    await page.route("**/v1/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/csrf")) return route.fulfill({ json: { data: { csrfToken: "test-csrf" } } });
      if (path.endsWith("/email-verification/confirm")) return route.fulfill({ json: { data: { verified: true, emailVerifiedAt: "2026-09-05T00:00:00Z" } } });
      return route.fulfill({ status: 401, json: { error: { code: "unauthorized", message: "Sign in" } } });
    });
    await page.goto("/login?verify_email=synthetic-verification-test-token");
    const message = page.getByText("Email verified. You can now change your password securely.");
    await expect(message).toBeVisible();
    const ratio = await message.evaluate((element) => {
      const parse = (color: string) => color.match(/[\d.]+/g)!.map(Number);
      const foreground = parse(getComputedStyle(element).color);
      let background = [255, 255, 255];
      const ancestors: Element[] = [];
      for (let node: Element | null = element; node; node = node.parentElement) ancestors.unshift(node);
      for (const node of ancestors) {
        const color = parse(getComputedStyle(node).backgroundColor);
        const alpha = color[3] ?? 1;
        background = background.map((value, i) => color[i] * alpha + value * (1 - alpha));
      }
      const luminance = (rgb: number[]) => rgb.slice(0, 3).map((value) => {
        const s = value / 255;
        return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
      }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
      const a = luminance(foreground), b = luminance(background);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
}
