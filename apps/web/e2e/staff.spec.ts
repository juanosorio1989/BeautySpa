import { expect, test, type Page } from "@playwright/test";
import { totp } from "./totp";

// Accounts from apps/api/scripts/e2e-staff.ts (run by e2e/prepare.sh). Test-only values.
const PASSWORD = "E2e-Staff-Pass-1";
const TOTP_SECRET = "JBSWY3DPEHPK3PXP";
const TZ = "America/New_York";

function isoToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

/** The day the seed puts its appointments on: today, or the next Tuesday to Saturday (the seeded staff schedule). */
function seedDay(): string {
  let ms = Date.parse(`${isoToday()}T12:00:00Z`);
  while (new Date(ms).getUTCDay() < 2) ms += 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/en/staff/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  const code = page.getByLabel("6-digit code from your authenticator app");
  await expect(code).toBeVisible();
  // A code is accepted once per 30 s step for a user; when a previous run used this step, wait for the next one.
  for (let attempt = 0; attempt < 2; attempt++) {
    await code.fill(totp(TOTP_SECRET));
    await page.getByRole("button", { name: "Verify" }).click();
    try {
      await expect(page).toHaveURL(/\/en\/staff\/?(\?.*)?$/, { timeout: 8_000 });
      return;
    } catch (err) {
      if (attempt === 1) throw err;
      await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
    }
  }
}

test("owner signs in, books at the desk, checks in and completes", async ({ page }) => {
  await signIn(page, "owner@e2e.test");

  // The seeded appointment (María Gómez) is on the seed day.
  await page.goto(`/en/staff?date=${seedDay()}`);
  await expect(page.getByRole("button", { name: /María Gómez/ }).first()).toBeVisible();

  // Check-in and complete are only allowed from the appointment's day, so book for today.
  await page.goto(`/en/staff?date=${isoToday()}`);
  await page.getByRole("link", { name: "+ New" }).click();
  await expect(page).toHaveURL(/\/en\/staff\/book/);

  await page.getByLabel("Phone or name").fill("María");
  await page.getByRole("button", { name: /María Gómez/ }).click();
  await expect(page.getByRole("button", { name: "Change client" })).toBeVisible();

  const services = page.getByRole("group", { name: "Services" });
  await services.getByRole("button").first().click();

  // Times never run out for today on a working day; on Sunday/Monday or late evening, use "Other time…".
  const slots = page.locator("button[aria-pressed]").filter({ hasText: /^\d{1,2}:\d{2}/ });
  const otherTime = page.getByRole("button", { name: /Other time/ });
  await expect(slots.first().or(page.getByText("No times this day."))).toBeVisible();
  if (!(await slots.first().isVisible())) {
    await otherTime.click();
    await expect(slots.first()).toBeVisible();
  }
  await slots.first().click();
  const bookAnyway = page.getByRole("button", { name: "Book anyway" });
  if (await bookAnyway.isVisible()) await bookAnyway.click();
  await page.getByRole("button", { name: /^Save · / }).click();

  // Back on the agenda, the new card is highlighted (?highlight=<id>).
  await expect(page).toHaveURL(/\/en\/staff\?.*highlight=/);
  const id = new URL(page.url()).searchParams.get("highlight")!;
  const card = page.locator(`[data-appointment-id="${id}"]`);
  await expect(card).toContainText("Booked");

  await card.click();
  await page.getByRole("button", { name: "Check in", exact: true }).click();
  await expect(card).toContainText("Checked in");

  await card.click();
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(card).toContainText("Done");
});

test("an employee sees only her column and no booking buttons", async ({ page }) => {
  await signIn(page, "ana@demo-salon.test");
  await expect(page.getByRole("region", { name: "Ana Rivera" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Carmen López" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "+ New" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Walk-in" })).toHaveCount(0);
});
