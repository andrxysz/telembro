import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  advanceAlerts,
  validateDraft,
  type Note,
  type NoteDraft,
} from "./model";

export const desktop = isTauri();
type Subscriber = (notes: Note[]) => void;
let subscribers: Subscriber[] = [];
let previewNotes: Note[] = [];
let audio: AudioContext | undefined;
const STORAGE_KEY = "telembro.preview.v1";

function savePreview(): void {
  // Write first: a full or blocked storage must not be reported as saved.
  localStorage.setItem(STORAGE_KEY, JSON.stringify(previewNotes));
  for (const subscriber of subscribers)
    subscriber(structuredClone(previewNotes));
}

function playPreviewSound(seconds: number): void {
  audio ??= new AudioContext();
  void audio.resume();
  for (let offset = 0; offset < seconds; offset += 1.2) {
    for (const [delay, frequency] of [
      [0, 784],
      [0.18, 1046.5],
    ]) {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const start = audio.currentTime + offset + delay;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.12, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.32);
    }
  }
}

export async function connect(onChange: Subscriber): Promise<Note[]> {
  if (desktop) {
    await listen<string>("storage-error", (event) => {
      window.dispatchEvent(
        new CustomEvent("telembro-error", { detail: event.payload }),
      );
    });
    await listen<Note[]>("notes-changed", (event) => onChange(event.payload));
    return invoke<Note[]>("list_notes");
  }
  const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  if (!Array.isArray(stored))
    throw new Error("Os lembretes salvos nesta prévia não puderam ser lidos.");
  previewNotes = stored as Note[];
  for (const note of previewNotes) validateDraft(note);
  subscribers.push(onChange);
  window.setInterval(() => {
    const now = Date.now();
    const due = previewNotes.filter(
      (note) =>
        note.completedAt === null && note.repeating && now >= note.nextAlertAt,
    );
    if (advanceAlerts(previewNotes, now)) {
      savePreview();
      const sounding = due.filter((note) => note.sound);
      if (sounding.length)
        playPreviewSound(
          Math.max(...sounding.map((note) => note.durationSeconds)),
        );
    }
  }, 500);
  return structuredClone(previewNotes);
}

export async function createNote(draft: NoteDraft): Promise<void> {
  validateDraft(draft);
  if (desktop) return invoke("create_note", { draft });
  audio ??= new AudioContext();
  void audio.resume();
  const now = Date.now();
  const active = previewNotes.filter(
    (note) => note.completedAt === null,
  ).length;
  if (active >= 12)
    throw new Error("Você já tem 12 stickers. Conclua um para abrir espaço.");
  const previous = structuredClone(previewNotes);
  previewNotes.unshift({
    ...draft,
    text: draft.text.trim(),
    id: crypto.randomUUID(),
    createdAt: now,
    completedAt: null,
    locked: false,
    nextAlertAt: now + draft.intervalMinutes * 60000,
    alertUntil: 0,
    x: null,
    y: null,
  });
  try {
    savePreview();
  } catch (error) {
    previewNotes = previous;
    throw error;
  }
}

export async function noteAction(
  action:
    "lock" | "unlock" | "complete" | "restore" | "delete" | "test" | "focus",
  id: string,
): Promise<void> {
  if (desktop) return invoke("note_action", { action, id });
  const note = previewNotes.find((item) => item.id === id);
  if (!note) return;
  const previous = structuredClone(previewNotes);
  if (action === "lock") note.locked = true;
  if (action === "unlock" || action === "focus") note.locked = false;
  if (action === "complete") {
    note.completedAt = Date.now();
    note.alertUntil = 0;
  }
  if (action === "restore") {
    if (previewNotes.filter((item) => item.completedAt === null).length >= 12)
      throw new Error("Você já tem 12 stickers. Conclua um para abrir espaço.");
    note.completedAt = null;
    note.locked = false;
    note.nextAlertAt = Date.now() + note.intervalMinutes * 60000;
  }
  if (action === "delete")
    previewNotes = previewNotes.filter((item) => item.id !== id);
  if (action === "test")
    note.alertUntil = Date.now() + note.durationSeconds * 1000;
  try {
    savePreview();
  } catch (error) {
    previewNotes = previous;
    throw error;
  }
  if (action === "test" && note.sound) playPreviewSound(note.durationSeconds);
}

export async function movePreview(
  id: string,
  x: number,
  y: number,
): Promise<void> {
  const note = previewNotes.find((item) => item.id === id);
  if (note) {
    note.x = x;
    note.y = y;
    savePreview();
  }
}

export async function windowAction(
  action: "hide" | "minimize" | "drag",
): Promise<void> {
  if (!desktop) return;
  if (action === "hide") return invoke("hide_manager");
  const win = getCurrentWindow();
  if (action === "minimize") await win.minimize();
  if (action === "drag") await win.startDragging();
}

export async function dragSticker(): Promise<void> {
  if (desktop) await getCurrentWindow().startDragging();
}

export async function fitSticker(width: number, height: number): Promise<void> {
  if (desktop) await invoke("fit_sticker", { width, height });
}
