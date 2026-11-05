export const COLORS = ["lavender", "peach", "mint", "butter"] as const;
export type NoteColor = (typeof COLORS)[number];

export interface NoteDraft {
  text: string;
  color: NoteColor;
  intervalMinutes: number;
  repeating: boolean;
  sound: boolean;
  durationSeconds: number;
  opacity: number;
}

export interface Note extends NoteDraft {
  id: string;
  createdAt: number;
  completedAt: number | null;
  locked: boolean;
  nextAlertAt: number;
  alertUntil: number;
  x: number | null;
  y: number | null;
}

export const DEFAULT_DRAFT: NoteDraft = {
  text: "",
  color: "lavender",
  intervalMinutes: 10,
  repeating: true,
  sound: true,
  durationSeconds: 5,
  opacity: 0.65,
};

export function validateDraft(draft: NoteDraft): void {
  if (!draft.text.trim() || draft.text.trim().length > 240)
    throw new Error("Escreva uma tarefa com até 240 caracteres.");
  if (!COLORS.includes(draft.color)) throw new Error("Escolha uma cor válida.");
  if (
    !Number.isSafeInteger(draft.intervalMinutes) ||
    draft.intervalMinutes < 1 ||
    draft.intervalMinutes > 525600
  )
    throw new Error("Escolha um intervalo entre 1 minuto e 1 ano.");
  if (
    !Number.isInteger(draft.durationSeconds) ||
    draft.durationSeconds < 3 ||
    draft.durationSeconds > 30
  )
    throw new Error("O alerta deve durar entre 3 e 30 segundos.");
  if (
    !Number.isFinite(draft.opacity) ||
    draft.opacity < 0.25 ||
    draft.opacity > 0.9
  )
    throw new Error("Escolha uma visibilidade entre 25% e 90%.");
}

export function intervalLabel(minutes: number): string {
  if (minutes % 60 === 0)
    return `${minutes / 60} ${minutes === 60 ? "hora" : "horas"}`;
  return `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
}

export function remainingLabel(note: Note, now = Date.now()): string {
  if (!note.repeating) return "Sem alerta";
  if (note.alertUntil > now) return "Te lembrando agora";
  const minutes = Math.max(1, Math.ceil((note.nextAlertAt - now) / 60000));
  return `Em ${intervalLabel(minutes)}`;
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

/** One alert after sleep, with the next deadline measured from the actual wake-up. */
export function advanceAlerts(notes: Note[], now: number): boolean {
  let changed = false;
  for (const note of notes) {
    if (note.completedAt !== null) continue;
    if (note.alertUntil && note.alertUntil <= now) {
      note.alertUntil = 0;
      changed = true;
    }
    if (note.repeating && now >= note.nextAlertAt) {
      note.alertUntil = now + note.durationSeconds * 1000;
      note.nextAlertAt = now + note.intervalMinutes * 60000;
      changed = true;
    }
  }
  return changed;
}
