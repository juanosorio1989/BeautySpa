import { expect, test } from "@playwright/test";
import { mintManageToken } from "./manage-token";

// Fake OTP provider (NODE_ENV=test): the code is always 000000. The number is random per run.
const suffix = String(Math.floor(Math.random() * 100)).padStart(2, "0");
const PHONE = `718 555 02${suffix}`;

test("client confirms then cancels from a manage link", async ({ page }) => {
  await page.goto("/en");
  await page.getByRole("checkbox", { name: /Classic manicure/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();

  // Third day on, so the 24 h cancel window allows cancelling; empty days offer "next day with times".
  await expect(page).toHaveURL(/\/en\/book\/time/);
  const strip = page.getByRole("group", { name: "Date" });
  await strip.getByRole("button").nth(2).click();
  const slots = page.locator("button[aria-pressed]").filter({ hasText: /^\d{1,2}:\d{2}/ });
  const nextDay = page.getByRole("button", { name: "Next day with times" });
  await expect(slots.first().or(nextDay)).toBeVisible();
  if (await nextDay.isVisible()) await nextDay.click();
  await expect(slots.first()).toBeVisible();
  await slots.first().click();
  await page.getByRole("button", { name: "Hold this time" }).click();

  await page.getByLabel("Your mobile number").fill(PHONE);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel(/We (texted you a code|sent you a code)/).fill("000000");
  await page.getByRole("button", { name: "Verify code" }).click();
  const confirm = page.getByRole("button", { name: "Confirm appointment" });
  await expect(confirm).toBeVisible();
  const name = page.getByLabel("Your name");
  if (await name.isVisible()) await name.fill("E2E Manage");
  await confirm.click();

  await expect(page).toHaveURL(/\/en\/book\/done\//);
  const appointmentId = /\/en\/book\/done\/([^/?#]+)/.exec(page.url())![1]!;

  // Open the manage link a notification would carry
  await page.goto(`/en/manage/${mintManageToken(appointmentId)}`);
  await expect(page.getByText("Classic manicure")).toBeVisible();
  await page.getByRole("button", { name: "Confirm I'll be there" }).click();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Cancel appointment" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel appointment" }).click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();

  // Cancelling bumped manage_version: the same link is dead now
  await page.reload();
  await expect(page.getByText("This link is no longer valid")).toBeVisible();
});
