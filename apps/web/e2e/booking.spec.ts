import { expect, test } from "@playwright/test";

// Fake OTP provider (NODE_ENV=test): the code is always 000000. The number is random per run.
const suffix = String(Math.floor(Math.random() * 100)).padStart(2, "0");
const PHONE = `718 555 01${suffix}`;

test("book manicure + pedicure in Spanish, then cancel from My appointments", async ({ page }) => {
  await page.goto("/es");

  // Both services are in the "Nails" category, the first chip.
  await page.getByRole("checkbox", { name: /Manicura clásica/ }).check();
  await page.getByRole("checkbox", { name: /Pedicura spa/ }).check();
  await page.getByRole("button", { name: "Continuar" }).click();

  // The cancel window is 24 h, so book from the third day on; seeded staff work Tuesday to Saturday,
  // so an empty day offers "next day with times".
  await expect(page).toHaveURL(/\/es\/book\/time/);
  const strip = page.getByRole("group", { name: "Fecha" });
  await strip.getByRole("button").nth(2).click();
  const slots = page.locator("button[aria-pressed]").filter({ hasText: /^\d{1,2}:\d{2}/ });
  const nextDay = page.getByRole("button", { name: "Siguiente día con horarios" });
  await expect(slots.first().or(nextDay)).toBeVisible();
  if (await nextDay.isVisible()) await nextDay.click();
  await expect(slots.first()).toBeVisible();
  await slots.first().click();
  await page.getByRole("button", { name: "Apartar este horario" }).click();

  // Sign in with the phone, then the details
  await page.getByLabel("Tu celular").fill(PHONE);
  await page.getByRole("button", { name: "Enviar código" }).click();
  await page.getByLabel("Te enviamos un código por mensaje de texto").fill("000000");
  await page.getByRole("button", { name: "Verificar código" }).click();
  const confirm = page.getByRole("button", { name: "Confirmar cita" });
  await expect(confirm).toBeVisible();
  // A returning customer (same random number as an earlier run) has no name field
  const name = page.getByLabel("Tu nombre");
  if (await name.isVisible()) await name.fill("Prueba E2E");
  await confirm.click();

  // Done shows both services
  await expect(page).toHaveURL(/\/es\/book\/done\//);
  const appointmentId = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.getByText("Manicura clásica")).toBeVisible();
  await expect(page.getByText("Pedicura spa")).toBeVisible();

  // The appointment is upcoming
  await page.getByRole("link", { name: "Ver o cambiar mis citas" }).click();
  await expect(page).toHaveURL(/\/es\/me/);
  await expect(page.getByRole("heading", { name: "Próximas" })).toBeVisible();
  const card = page.locator(`li[data-appointment-id="${appointmentId}"]`);
  const upcoming = card.locator("article").filter({ hasText: "Manicura clásica" });
  await expect(upcoming).toBeVisible();

  // Cancel: the native <dialog> opens modally and takes focus
  await upcoming.getByRole("button", { name: "Cancelar" }).click();
  const dialog = page.getByRole("dialog", { name: "¿Cancelar esta cita?" });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el: HTMLDialogElement) => el.open && el.matches(":modal"))).toBe(true);
  await expect(page.getByLabel("Motivo (opcional)")).toBeFocused();
  await dialog.getByRole("button", { name: "Cancelar la cita" }).click();
  await expect(dialog).toBeHidden();

  // It moves to the past, as cancelled
  await expect(page.getByRole("heading", { name: "Anteriores" })).toBeVisible();
  const past = card.locator("article").filter({ hasText: "Cancelada" }).filter({ hasText: "Manicura clásica" });
  await expect(past).toBeVisible();
});
