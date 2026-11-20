import { BEERJS_CORDOBA_LINK } from "../shared/contracts.ts";
import type { HistoryTurn, RouteReason } from "../shared/contracts.ts";

const PHOTOSYNTHESIS_TOPIC = /\bfotos[ií]ntesis\b/i;

const FOLLOW_UP_EXAMPLE = /otro\s+ejemplo|y\s+otro|m[aá]s\s+ejemplos?/i;

export const GREETING =
  /^(hola|buen d[ií]a|buen[oa]s?\s*(d[ií]as|tardes|noches)?|hey|hi)\b/i;

const CLARIFICATION_NEED =
  /^(no\s+entiendo|no\s+comprendo|qu[eé]\??|eh\??|ayuda)\s*$/i;

export const academicPhotosynthesisReply =
  "La fotosíntesis es el proceso por el que las plantas usan la energía de la luz para elaborar azúcares a partir de agua y dióxido de carbono. " +
  "En las plantas ocurre en los cloroplastos y libera oxígeno. " +
  "Por ejemplo, las hojas de un girasol captan la luz para producir azúcares.";

export const academicFollowUpExampleReply =
  "Otro ejemplo de fotosíntesis: las algas verdes también aprovechan la luz para producir azúcares y liberan oxígeno al agua.";

export const academicGenericReply =
  "Puedo explicar el concepto de forma breve y didáctica, pero en esta demo simulada " +
  "solo tengo respuestas preparadas para algunos ejemplos. Reformulá la pregunta o pedí " +
  "una explicación de la fotosíntesis para ver el flujo académico completo.";

export const academicClarificationReply =
  "Para ayudarte con el contenido de estudio, necesitás una pregunta más concreta. " +
  "Por ejemplo: «Explicame qué es la fotosíntesis».";

export function resolveAcademicReply(
  latestUserText: string,
  history: HistoryTurn[],
): string {
  const text = latestUserText.trim();

  if (PHOTOSYNTHESIS_TOPIC.test(text)) {
    return academicPhotosynthesisReply;
  }

  if (FOLLOW_UP_EXAMPLE.test(text)) {
    return history.some((turn) => PHOTOSYNTHESIS_TOPIC.test(turn.text))
      ? academicFollowUpExampleReply
      : academicClarificationReply;
  }

  if (text.length < 8 || CLARIFICATION_NEED.test(text)) {
    return academicClarificationReply;
  }

  return academicGenericReply;
}

export function resolveInstitutionalReply(latestUserText: string): string {
  const entry = findFaqEntry(latestUserText);
  if (entry) {
    return entry.answer;
  }
  return faqUnknownReply(latestUserText);
}

export function resolveFallbackReply(
  latestUserText: string,
  reason: RouteReason,
): string {
  if (reason === "router-unavailable" || reason === "invalid-decision") {
    return (
      "No pude completar la clasificación del router (" +
      reason +
      "). Mientras tanto, puedo ayudarte con explicaciones de estudio " +
      "o consultas institucionales de la FAQ de demo. ¿Qué necesitás?"
    );
  }

  const text = latestUserText.trim();

  if (GREETING.test(text)) {
    return (
      `¡Un saludo para la gente de ${BEERJS_CORDOBA_LINK}! 🍻\n\n` +
      "Puedo ayudarte con explicaciones académicas o con consultas institucionales de la FAQ ficticia. " +
      "¿Qué te gustaría preguntar?"
    );
  }

  if (CLARIFICATION_NEED.test(text) || text.length < 4) {
    return (
      "No tengo contexto suficiente. Contame si buscás una explicación de estudio " +
      "o un dato institucional (horarios, inscripción) de la demo."
    );
  }

  // Off-topic / out-of-scope → reformulation toward demo scope.
  return (
    "Eso queda fuera del alcance de esta demo. Puedo ayudarte con contenidos de estudio " +
    "o con FAQ institucional. Probá reformular la pregunta."
  );
}

export type FaqEntry = {
  id: string;

  keywords: string[];
  answer: string;
};

export const institutionalFaqEntries: readonly FaqEntry[] = [
  {
    id: "secretaria",
    keywords: [
      "secretaria",
      "secretaría",
      "horario",
      "atiende",
      "atencion",
      "atención",
    ],
    answer:
      "Secretaría Académica atiende **de lunes a viernes, de 9 a 17 h**. " +
      "Podés consultar por inscripciones, pedir constancias de alumno regular o averiguar el estado de un trámite.\n\n" +
      "Si ya iniciaste un trámite, tené a mano tu número de legajo y el comprobante de la solicitud.",
  },
  {
    id: "inscripcion",
    keywords: [
      "inscripcion",
      "inscripción",
      "inscribir",
      "matricula",
      "formulario",
      "campus",
    ],
    answer:
      "La inscripción se hace desde **Campus → Inscripciones**.\n\n" +
      "1. Elegí la materia o el curso y revisá los requisitos y el período de inscripción.\n" +
      "2. Completá el formulario con tus datos y adjuntá la documentación que se indique.\n" +
      "3. Enviá la solicitud y guardá el comprobante. Podés consultar el estado en **Mis inscripciones**.\n\n" +
      "Si la materia no aparece o el formulario no está habilitado, consultá con Secretaría Académica.",
  },
];

export function findFaqEntry(question: string): FaqEntry | undefined {
  const normalized = question.toLowerCase();
  return institutionalFaqEntries.find((entry) =>
    entry.keywords.some((keyword) => normalized.includes(keyword)),
  );
}

export function faqUnknownReply(question: string): string {
  return (
    `No tengo esa información para «${question.trim()}». ` +
    "Puedo ayudarte con los horarios de Secretaría Académica o explicarte cómo inscribirte desde el campus."
  );
}
