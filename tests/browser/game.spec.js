import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const bank = JSON.parse(
  readFileSync(new URL("../../src/questions.json", import.meta.url), "utf8"),
);

for (const level of ["Fácil", "Medio", "Hardcore"]) {
  test(`complete a ${level} game, review answers, persist record and replay`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await page.getByRole("radio", { name: new RegExp(level) }).check();
    await page.getByRole("button", { name: "¡A jugar!" }).click();
    await expect(page.locator(".question-title")).toBeInViewport();
    const categories = [];
    for (let i = 0; i < 5; i++) {
      const text = await page.locator(".question-title").textContent();
      const question = bank.find((q) => q.question === text);
      expect(question).toBeTruthy();
      categories.push(question.category);
      await page
        .getByRole("button", {
          name: question.options[question.answer],
          exact: false,
        })
        .click();
      await expect(page.locator(".feedback")).toContainText(
        "¡Estás en la onda!",
      );
      await expect(page.locator(".answer-button:disabled")).toHaveCount(question.options.length);
      if (i < 4)
        await page.getByRole("button", { name: "Siguiente pregunta" }).click();
      else await page.getByRole("button", { name: "Ver resultados" }).click();
    }
    expect(new Set(categories).size).toBe(5);
    await expect(
      page.getByRole("heading", { name: "¡Ganaste el desafío!" }),
    ).toBeVisible();
    await expect(page.locator(".result-stats")).toContainText("5 de 5");
    await expect(page.locator(".recap-item")).toHaveCount(5);
    await page.locator(".recap-item summary").first().click();
    await expect(page.locator(".recap-detail").first()).toBeVisible();
    await page.getByRole("button", { name: "Cambiar dificultad" }).click();
    await expect(page.locator("#best-line strong")).not.toHaveText("0 pts");
    await page.reload();
    await page.getByRole("radio", { name: new RegExp(level) }).check();
    await expect(page.locator("#best-line strong")).not.toHaveText("0 pts");
    await page.getByRole("button", { name: "¡A jugar!" }).click();
    await expect(page.locator(".score")).toHaveText("0 PTS");
    expect(errors).toEqual([]);
  });
}

test("timeout awards zero points and shows the correct answer", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "¡A jugar!" }).click();
  await page.clock.fastForward(21_000);
  await expect(page.locator(".feedback")).toContainText("¡Se acabó el tiempo!");
  await expect(page.locator(".score")).toHaveText("0 PTS");
  await expect(page.locator(".answer-button.is-correct")).toHaveCount(1);
  await page.getByRole("button", { name: "Siguiente pregunta" }).click();
  await expect(page.locator("#seconds")).toHaveText("20");
});

test("a wrong answer cannot be changed and leaving the game requires confirmation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "¡A jugar!" }).click();
  const text = await page.locator(".question-title").textContent();
  const question = bank.find((q) => q.question === text);
  const incorrect = question.options.find((o, i) => i !== question.answer);
  await page.getByRole("button", { name: incorrect, exact: false }).click();
  await expect(page.locator(".answer-button.is-wrong")).toHaveCount(1);
  await expect(page.locator(".score")).toHaveText("0 PTS");
  await page.getByRole("button", { name: "Siguiente pregunta" }).click();
  await page
    .getByRole("button", { name: "Salir de la partida", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Seguir jugando" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".question-title")).toBeVisible();
  await page
    .getByRole("button", { name: "Salir de la partida", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Salir de la partida" })
    .click();
  await expect(page.getByRole("button", { name: "¡A jugar!" })).toBeVisible();
});

test("keyboard answers once, and the layout has no horizontal overflow", async ({
  page,
}) => {
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "¡A jugar!" }).click();
  await page.keyboard.press("1");
  await expect(page.locator(".feedback")).toBeVisible();
  const score = await page.locator(".score").textContent();
  await page.keyboard.press("2");
  expect(await page.locator(".score").textContent()).toBe(score);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
