export const CATEGORIES = [
  { id: "inacap", label: "INACAP", symbol: "✳︎", color: "red" },
  { id: "tecnologia", label: "Tecnología", symbol: "⌘", color: "blue" },
  { id: "cultura", label: "Cultura", symbol: "✿", color: "orange" },
  { id: "musica", label: "Música", symbol: "♫", color: "pink" },
  { id: "educacion", label: "Educación", symbol: "✎", color: "green" },
];

export const LEVELS = [
  { id: "facil", label: "Fácil", subtitle: "Para entrar en la onda", stars: 1 },
  { id: "medio", label: "Medio", subtitle: "Subamos el volumen", stars: 2 },
  {
    id: "hardcore",
    label: "Hardcore",
    subtitle: "Solo para leyendas",
    stars: 3,
  },
];

export const QUESTION_SECONDS = 20;

export function shuffled(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function validateBank(bank) {
  if (!Array.isArray(bank) || !bank.length)
    throw new Error("Faltan las preguntas.");
  const ids = new Set();
  for (const q of bank) {
    if (!q.id || ids.has(q.id))
      throw new Error("Cada pregunta necesita un identificador único.");
    ids.add(q.id);
    if (
      !CATEGORIES.some((c) => c.id === q.category) ||
      !LEVELS.some((l) => l.id === q.level)
    ) {
      throw new Error(`Categoría o nivel inválido en ${q.id}.`);
    }
    if (
      typeof q.question !== "string" ||
      !q.question.trim() ||
      !Array.isArray(q.options) ||
      ![2, 3, 4].includes(q.options.length) ||
      q.options.some((o) => typeof o !== "string" || !o.trim()) ||
      new Set(q.options).size !== q.options.length ||
      !Number.isInteger(q.answer) ||
      q.answer < 0 ||
      q.answer >= q.options.length ||
      typeof q.explanation !== "string" ||
      !q.explanation.trim()
    ) {
      throw new Error(
        `Revisa el enunciado, las opciones, la respuesta y la explicación de ${q.id}.`,
      );
    }
  }
  for (const level of LEVELS) {
    for (const category of CATEGORIES) {
      if (
        !bank.some((q) => q.level === level.id && q.category === category.id)
      ) {
        throw new Error(
          `Faltan preguntas de ${category.label} en nivel ${level.label}.`,
        );
      }
    }
  }
  return true;
}

export function createGame(bank, level, random = Math.random) {
  validateBank(bank);
  if (!LEVELS.some((l) => l.id === level)) throw new Error("Nivel inválido.");
  const selected = CATEGORIES.map((category) => {
    const pool = bank.filter(
      (q) => q.level === level && q.category === category.id,
    );
    const question = pool[Math.floor(random() * pool.length)];
    const options = shuffled(
      question.options.map((text, index) => ({
        text,
        correct: index === question.answer,
      })),
      random,
    );
    return {
      ...question,
      options,
      answer: options.findIndex((o) => o.correct),
    };
  });
  return shuffled(selected, random);
}

export function pointsFor(correct, secondsLeft) {
  if (!correct) return 0;
  return (
    500 +
    Math.round(
      (500 * Math.max(0, Math.min(QUESTION_SECONDS, secondsLeft))) /
        QUESTION_SECONDS,
    )
  );
}

export const SOLO_TARGET = 3;
export const soloWon = correctCount => correctCount >= SOLO_TARGET;
