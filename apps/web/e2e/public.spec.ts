import { expect, test } from "@playwright/test";

test("services page lists the seeded services and Book preselects one", async ({ page }) => {
  await page.goto("/en/services");
  await expect(page.getByRole("heading", { name: "Services", level: 1 })).toBeVisible();
  const book = page.getByRole("link", { name: "Book Spa pedicure" });
  await expect(book).toBeVisible();

  await book.click();
  await expect(page).toHaveURL(/\/en\?service=[\w-]+/);
  await expect(page.getByRole("checkbox", { name: /Spa pedicure/ })).toBeChecked();
});
