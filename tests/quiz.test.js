import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CATEGORIES,
  LEVELS,
  QUESTION_SECONDS,
  createGame,
  pointsFor,
  validateBank,
} from "../src/quiz.js";

const bank = JSON.parse(
  readFileSync(new URL("../src/questions.json", import.meta.url), "utf8"),
);

test("the question bank covers all categories in each difficulty", () => {
  assert.equal(validateBank(bank), true);
  assert.ok(bank.length >= CATEGORIES.length * LEVELS.length);
});

for (const level of LEVELS) {
  test(`${level.label}: each game has five unique categories and preserves correct answers after shuffling`, () => {
    for (let n = 0; n < 100; n++) {
      const game = createGame(bank, level.id);
      assert.equal(game.length, 5);
      assert.deepEqual(
        new Set(game.map((q) => q.category)),
        new Set(CATEGORIES.map((c) => c.id)),
      );
      for (const question of game) {
        const original = bank.find((q) => q.id === question.id);
        assert.equal(question.level, level.id);
        assert.equal(
          question.options[question.answer].text,
          original.options[original.answer],
        );
        assert.equal(question.options.filter((o) => o.correct).length, 1);
      }
    }
  });
}

test("question selection, answer positions and category order vary", () => {
  const first = createGame(bank, "facil", () => 0);
  const last = createGame(bank, "facil", () => 0.99999);
  assert.notDeepEqual(
    first.map((q) => q.id),
    last.map((q) => q.id),
  );
  assert.notDeepEqual(
    first.map((q) => q.category),
    last.map((q) => q.category),
  );
  assert.notEqual(first[0].answer, last[0].answer);
});

test("missing categories, duplicate IDs and invalid answers are rejected", () => {
  assert.throws(
    () => validateBank(bank.filter((q) => q.category !== "musica")),
    /Faltan preguntas/,
  );
  assert.throws(() => validateBank([...bank, bank[0]]), /único/);
  assert.throws(
    () => validateBank(bank.map((q, i) => (i === 0 ? { ...q, answer: 4 } : q))),
    /Revisa/,
  );
  assert.throws(() => createGame(bank, "unknown"), /Nivel inválido/);
});

test("points reward correct answers and speed, with a maximum of 1000 per answer", () => {
  assert.equal(pointsFor(false, QUESTION_SECONDS), 0);
  assert.equal(pointsFor(true, QUESTION_SECONDS), 1000);
  assert.equal(pointsFor(true, QUESTION_SECONDS / 2), 750);
  assert.equal(pointsFor(true, 0), 500);
  assert.equal(pointsFor(true, 100), 1000);
  assert.equal(pointsFor(true, -5), 500);
});

test("stand bank contains 75 supplied questions, five in every category and difficulty", () => {
  assert.equal(bank.length, 75);
  for (const level of LEVELS) {
    for (const category of CATEGORIES) {
      assert.equal(bank.filter(q => q.level === level.id && q.category === category.id).length, 5);
    }
  }
  for (const q of bank) {
    assert.ok(q.sourceQuestion && q.sourceAnswer);
    assert.ok(q.explanation.includes(q.sourceAnswer));
    assert.ok(q.options.length >= 2 && q.options.length <= 4);
  }
});

test("binary questions shuffle both choices while keeping the supplied correct answer", () => {
  const binary = bank.filter(q => q.options.length === 2);
  assert.ok(binary.length > 0);
  for (const q of binary) {
    const game = createGame([q, ...bank.filter(other => other.category !== q.category || other.level !== q.level)], q.level);
    const selected = game.find(item => item.id === q.id);
    assert.equal(selected.options.length, 2);
    assert.equal(selected.options[selected.answer].text, q.options[q.answer]);
  }
  const invalid = bank.map((q, i) => i === 0 ? {...q, answer: q.options.length} : q);
  assert.throws(() => validateBank(invalid), /Revisa/);
});

test('solo play wins at three correct answers and loses below the target', async () => {
  const { soloWon } = await import('../src/quiz.js');
  assert.equal(soloWon(2), false);
  assert.equal(soloWon(3), true);
  assert.equal(soloWon(5), true);
});
