import "./style.css";
import {
  connect,
  createNote,
  desktop,
  dragSticker,
  fitSticker,
  movePreview,
  noteAction,
  windowAction,
} from "./bridge";
import {
  COLORS,
  escapeHtml,
  intervalLabel,
  type Note,
  type NoteColor,
  type NoteDraft,
} from "./model";
import { icon } from "./icons";

const app = document.querySelector<HTMLDivElement>("#app")!;
const stickerId = new URLSearchParams(location.search).get("sticker");
let notes: Note[] = [];
let tab: "active" | "done" = "active";
let notePage = 0;
const NOTES_PER_PAGE = 2;
let color: NoteColor = "lavender";
let toastTimer: number;
const colorNames: Record<NoteColor, string> = {
  lavender: "Lavanda",
  peach: "Pêssego",
  mint: "Menta",
  butter: "Baunilha",
};

function notify(message: string, error = false): void {
  let toast = document.querySelector<HTMLDivElement>("#toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.role = "status";
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.className = error ? "toast error" : "toast";
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast?.remove(), 4500);
}

function run(action: () => Promise<void>): void {
  void action().catch((error: unknown) =>
    notify(
      typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : "Não foi possível salvar a alteração. Tente novamente.",
      true,
    ),
  );
}

function renderManager(): void {
  app.innerHTML = `
    <main class="manager">
      <header class="titlebar">
        <div class="brand" id="title-drag"><span class="brand-mark">${icon("note")}</span><span>Telembro<span class="brand-dot">.</span></span></div>
        <div class="window-actions">${desktop ? `<button type="button" id="minimize" class="icon-button" aria-label="Minimizar">${icon("minus")}</button><button type="button" id="hide" class="icon-button" aria-label="Recolher para a bandeja">${icon("close")}</button>` : '<span class="preview-badge">PRÉVIA WEB</span>'}</div>
      </header>
      <div class="main-content">
        <section class="intro">
          <h1>Relaxa, eu te lembro! :)<span>.</span></h1>
        </section>
        <form id="note-form">
          <section class="compose-card">
            <label for="task" class="field-label">O que você precisa ser lembrado?</label>
            <textarea id="task" name="task" maxlength="240" placeholder="Estudar, responder uma mensagem..." required rows="2"></textarea>
            <div class="compose-bottom"><div class="color-picker" role="group" aria-label="Cor do sticker">${COLORS.map((item) => `<button class="swatch ${item} ${color === item ? "selected" : ""}" type="button" data-color="${item}" aria-label="${colorNames[item]}" aria-pressed="${color === item}">${icon("check")}</button>`).join("")}</div><span id="char-count" class="char-count">0 / 240</span></div>
          </section>
          <section class="reminder-card">
            <div class="alert-options">
              <div class="setting-row"><div class="setting-icon">${icon("clock")}</div><div class="setting-copy"><label for="repeating">Alerta visual</label></div><label class="switch"><input id="repeating" type="checkbox" checked aria-label="Repetir alerta visual"><span></span></label></div>
              <div class="setting-row sound-row"><div class="setting-icon">${icon("sound")}</div><div class="setting-copy"><label for="sound">Com som</label></div><label class="switch"><input id="sound" type="checkbox" checked aria-label="Reproduzir som no alerta"><span></span></label></div>
            </div>
            <div id="timing" class="timing-row"><span>A cada</span><input id="interval" type="number" min="1" max="525600" value="10" required aria-label="Intervalo do lembrete"><select id="unit" aria-label="Unidade de tempo"><option value="1">minutos</option><option value="60">horas</option></select><span class="timing-for">por</span><select id="duration" aria-label="Duração do alerta"><option value="3">3 seg</option><option value="5" selected>5 seg</option><option value="8">8 seg</option><option value="10">10 seg</option><option value="15">15 seg</option><option value="30">30 seg</option></select></div>
          </section>
          <div class="opacity-setting"><label for="opacity">${icon("eye")} Visibilidade da notinha</label><input id="opacity" type="range" min="25" max="90" value="65" aria-label="Visibilidade em repouso"><output id="opacity-value" for="opacity">65%</output></div>
          <button class="create-button" type="submit">${icon("plus")} Criar meu lembrete ${icon("arrow")}</button>
        </form>
        <section class="notes-section">
          <div class="notes-heading"><h2>Lembretinhos: <span id="active-count">0</span></h2><div class="tabs" role="tablist" aria-label="Status das tarefas"><button role="tab" id="active-tab" aria-selected="true">Ativos</button><button role="tab" id="done-tab" aria-selected="false">Concluídos</button></div></div>
          <div id="notes-list" role="tabpanel" aria-labelledby="active-tab"></div>
          <nav id="notes-pagination" class="notes-pagination" aria-label="Páginas de lembretes" hidden>
            <button type="button" id="previous-page" aria-label="Página anterior">${icon("arrow", "previous-arrow")}</button>
            <span id="page-status" aria-live="polite"></span>
            <button type="button" id="next-page" aria-label="Próxima página">${icon("arrow")}</button>
          </nav>
        </section>
        ${!desktop ? '<p class="web-notice">Você está na prévia. No aplicativo Windows, os stickers ficam por cima dos outros apps.</p>' : ""}
      </div>
    </main>
    ${!desktop ? '<aside id="preview-stickers" aria-label="Prévia dos stickers"></aside>' : ""}`;

  document
    .querySelector("#title-drag")
    ?.addEventListener("pointerdown", (event) => {
      if ((event as PointerEvent).button === 0) run(() => windowAction("drag"));
    });
  document
    .querySelector("#minimize")
    ?.addEventListener("click", () => run(() => windowAction("minimize")));
  document
    .querySelector("#hide")
    ?.addEventListener("click", () => run(() => windowAction("hide")));
  document.querySelector("#task")!.addEventListener("input", () => {
    document.querySelector("#char-count")!.textContent =
      `${document.querySelector<HTMLTextAreaElement>("#task")!.value.length} / 240`;
  });
  document
    .querySelectorAll<HTMLButtonElement>("[data-color]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        color = button.dataset.color as NoteColor;
        document.querySelectorAll("[data-color]").forEach((element) => {
          element.classList.toggle("selected", element === button);
          element.setAttribute("aria-pressed", String(element === button));
        });
        document
          .querySelector(".compose-card")!
          .setAttribute("data-color", color);
      }),
    );
  document
    .querySelector("#repeating")!
    .addEventListener("change", updateTiming);
  document.querySelector("#opacity")!.addEventListener("input", () => {
    const value = document.querySelector<HTMLInputElement>("#opacity")!.value;
    document.querySelector("#opacity-value")!.textContent = `${value}%`;
  });
  document.querySelector("#active-tab")!.addEventListener("click", () => {
    tab = "active";
    notePage = 0;
    renderList();
  });
  document.querySelector("#done-tab")!.addEventListener("click", () => {
    tab = "done";
    notePage = 0;
    renderList();
  });
  document.querySelector("#previous-page")!.addEventListener("click", () => {
    notePage--;
    renderList();
  });
  document.querySelector("#next-page")!.addEventListener("click", () => {
    notePage++;
    renderList();
  });
  document
    .querySelector<HTMLFormElement>("#note-form")!
    .addEventListener("submit", (event) => {
      event.preventDefault();
      const button =
        document.querySelector<HTMLButtonElement>(".create-button")!;
      if (button.disabled) return;
      const draft: NoteDraft = {
        text: document.querySelector<HTMLTextAreaElement>("#task")!.value,
        color,
        intervalMinutes:
          Number(document.querySelector<HTMLInputElement>("#interval")!.value) *
          Number(document.querySelector<HTMLSelectElement>("#unit")!.value),
        durationSeconds: Number(
          document.querySelector<HTMLSelectElement>("#duration")!.value,
        ),
        repeating:
          document.querySelector<HTMLInputElement>("#repeating")!.checked,
        sound: document.querySelector<HTMLInputElement>("#sound")!.checked,
        opacity:
          Number(document.querySelector<HTMLInputElement>("#opacity")!.value) /
          100,
      };
      button.disabled = true;
      run(async () => {
        try {
          await createNote(draft);
          document.querySelector<HTMLTextAreaElement>("#task")!.value = "";
          document.querySelector("#char-count")!.textContent = "0 / 240";
          tab = "active";
          notePage = 0;
          renderList();
          notify("Prontinho! Posicione seu sticker e clique em ✓ para fixar.");
        } finally {
          button.disabled = false;
        }
      });
    });
}

function updateTiming(): void {
  const enabled =
    document.querySelector<HTMLInputElement>("#repeating")!.checked;
  document.querySelector("#timing")!.classList.toggle("disabled", !enabled);
  document
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      "#timing input, #timing select, #sound",
    )
    .forEach((input) => (input.disabled = !enabled));
  document.querySelector(".sound-row")!.classList.toggle("disabled", !enabled);
}

function renderList(): void {
  const active = notes.filter((note) => note.completedAt === null);
  document.querySelector("#active-count")!.textContent = String(active.length);
  for (const status of ["active", "done"])
    document
      .querySelector(`#${status}-tab`)!
      .setAttribute("aria-selected", String(tab === status));
  const list = document.querySelector("#notes-list")!;
  list.setAttribute("aria-labelledby", `${tab}-tab`);
  const matching = notes.filter((note) =>
    tab === "active" ? note.completedAt === null : note.completedAt !== null,
  );
  const pageCount = Math.max(1, Math.ceil(matching.length / NOTES_PER_PAGE));
  notePage = Math.max(0, Math.min(notePage, pageCount - 1));
  const visible = matching.slice(
    notePage * NOTES_PER_PAGE,
    (notePage + 1) * NOTES_PER_PAGE,
  );
  document.querySelector<HTMLElement>("#notes-pagination")!.hidden =
    pageCount <= 1;
  document.querySelector<HTMLButtonElement>("#previous-page")!.disabled =
    notePage === 0;
  document.querySelector<HTMLButtonElement>("#next-page")!.disabled =
    notePage === pageCount - 1;
  document.querySelector("#page-status")!.textContent =
    `${notePage + 1} de ${pageCount}`;
  list.innerHTML = visible.length
    ? visible
        .map(
          (note) => `
    <article class="note-row ${note.completedAt !== null ? "completed" : ""}">
      <span class="note-thumb ${note.color}">${icon(note.completedAt !== null ? "check" : "note")}</span>
      <div class="note-info"><p>${escapeHtml(note.text)}</p><span data-countdown="${note.id}">${note.completedAt !== null ? "Uma coisa a menos! Ufa." : `${note.repeating ? `A cada ${intervalLabel(note.intervalMinutes)}` : "Sempre à vista"} · ${note.locked ? "Fixado" : "Posicionando"}`}</span></div>
      <div class="note-row-actions">${
        note.completedAt !== null
          ? `<button class="icon-button" data-action="restore" data-id="${note.id}" aria-label="Restaurar lembrete">${icon("undo")}</button><button class="icon-button" data-action="delete" data-id="${note.id}" aria-label="Excluir lembrete">${icon("trash")}</button>`
          : `<button class="icon-button" data-action="test" data-id="${note.id}" aria-label="Testar alerta">${icon("bell")}</button><button class="icon-button" data-action="focus" data-id="${note.id}" aria-label="Reposicionar sticker">${icon("move")}</button><button class="complete-button" data-action="complete" data-id="${note.id}" aria-label="Concluir tarefa">${icon("check")}</button>`
      }</div>
    </article>`,
        )
        .join("")
    : `<div class="empty-state"><span class="empty-icon">${icon(tab === "active" ? "sparkle" : "check")}</span><p>${tab === "active" ? "Sem planos por agora?!" : "Tudo em ordem :D"}</p><span>${tab === "active" ? "Crie seu primeiro lembrete ali em cima." : "As tarefas concluídas vão aparecer aqui."}</span></div>`;
  list.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) =>
    button.addEventListener("click", () =>
      run(async () => {
        await noteAction(
          button.dataset.action as Parameters<typeof noteAction>[0],
          button.dataset.id!,
        );
        if (button.dataset.action === "complete")
          notify("Feito! Mais um espacinho livre na cabeça.");
      }),
    ),
  );
}

function stickerMarkup(note: Note): string {
  const alerting = note.alertUntil > Date.now();
  return `<article class="sticker ${note.color} ${note.locked ? "locked" : "unlocked"} ${alerting ? "alerting" : ""}" style="--rest-opacity:${note.opacity}" data-sticker="${note.id}" tabindex="0" aria-label="${escapeHtml(note.text)}. ${note.locked ? "Clique duas vezes para mover." : "Arraste para posicionar."}">
    <div class="sticker-top"><span class="sticker-label">${icon(alerting ? "bell" : "note")} ${alerting ? "EI, NÃO ESQUECE!" : "NÃO ESQUECE!"}</span>${!note.locked ? `<div class="sticker-actions"><button data-sticker-action="lock" class="sticker-lock" aria-label="Fixar sticker nesta posição">${icon("check")}</button></div>` : ""}</div>
    <p class="sticker-text">${escapeHtml(note.text)}</p>
    <div class="sticker-footer"><span>${note.locked ? icon("pin") : icon("move")} ${note.locked ? "Dois cliques para mover" : "Arraste e clique em ✓ para fixar"}</span><span class="sticker-timer">${note.repeating ? icon(note.sound ? "sound" : "muted") : ""}</span></div>
  </article>`;
}

function bindSticker(container: HTMLElement, note: Note): void {
  const sticker = container.querySelector<HTMLElement>(".sticker")!;
  sticker.addEventListener("contextmenu", (event) => event.preventDefault());
  sticker.addEventListener("dblclick", (event) => {
    if (note.locked && !(event.target as HTMLElement).closest("button"))
      run(() => noteAction("unlock", note.id));
  });
  sticker.addEventListener("keydown", (event) => {
    if (event.target !== sticker) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      run(() => noteAction(note.locked ? "unlock" : "lock", note.id));
    }
  });
  container
    .querySelectorAll<HTMLButtonElement>("[data-sticker-action]")
    .forEach((button) =>
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        run(() =>
          noteAction(
            button.dataset.stickerAction as "lock" | "complete",
            note.id,
          ),
        );
      }),
    );
  sticker.addEventListener("pointerdown", (event) => {
    if (
      note.locked ||
      event.button !== 0 ||
      (event.target as HTMLElement).closest("button")
    )
      return;
    if (desktop) {
      run(dragSticker);
      return;
    }
    event.preventDefault();
    const rect = container.getBoundingClientRect();
    const offsetX = event.clientX - rect.left,
      offsetY = event.clientY - rect.top;
    sticker.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent): void => {
      container.style.left = `${Math.max(0, Math.min(innerWidth - rect.width, moveEvent.clientX - offsetX))}px`;
      container.style.top = `${Math.max(0, Math.min(innerHeight - rect.height, moveEvent.clientY - offsetY))}px`;
      container.style.right = "auto";
      container.style.bottom = "auto";
    };
    const end = (): void => {
      sticker.removeEventListener("pointermove", move);
      sticker.removeEventListener("pointerup", end);
      sticker.removeEventListener("pointercancel", end);
      const final = container.getBoundingClientRect();
      run(() => movePreview(note.id, final.left, final.top));
    };
    sticker.addEventListener("pointermove", move);
    sticker.addEventListener("pointerup", end);
    sticker.addEventListener("pointercancel", end);
  });
}

function renderStickers(): void {
  if (stickerId) {
    const note = notes.find(
      (item) => item.id === stickerId && item.completedAt === null,
    );
    app.innerHTML = note ? stickerMarkup(note) : "";
    if (note) {
      bindSticker(app, note);
      const bounds = app
        .querySelector<HTMLElement>(".sticker")!
        .getBoundingClientRect();
      run(() =>
        fitSticker(Math.ceil(bounds.width) + 12, Math.ceil(bounds.height) + 12),
      );
    }
    return;
  }
  if (desktop) return;
  const container = document.querySelector<HTMLElement>("#preview-stickers")!;
  container.innerHTML = "";
  notes
    .filter((note) => note.completedAt === null)
    .forEach((note, index) => {
      const wrapper = document.createElement("div");
      wrapper.className = "preview-sticker";
      wrapper.innerHTML = stickerMarkup(note);
      container.append(wrapper);
      const bounds = wrapper.getBoundingClientRect();
      const x = note.x ?? innerWidth - bounds.width - 24 - index * 18;
      const y = note.y ?? 85 + index * 32;
      wrapper.style.left = `${Math.max(0, Math.min(innerWidth - bounds.width, x))}px`;
      wrapper.style.top = `${Math.max(0, Math.min(innerHeight - bounds.height, y))}px`;
      bindSticker(wrapper, note);
    });
}

async function start(): Promise<void> {
  if (stickerId) {
    document.body.classList.add("sticker-window");
    document.documentElement.classList.add("sticker-window");
  } else {
    document.body.classList.toggle("desktop", desktop);
    renderManager();
  }
  try {
    notes = await connect((next) => {
      notes = next;
      if (!stickerId) renderList();
      renderStickers();
    });
    if (!stickerId) renderList();
    renderStickers();
  } catch (error) {
    document
      .querySelector<HTMLButtonElement>(".create-button")
      ?.setAttribute("disabled", "");
    notify(`Não foi possível abrir seus lembretes: ${String(error)}`, true);
  }
}

// Native WebView context menus must never cover another application's controls.
if (desktop)
  document.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("telembro-error", (event) =>
  notify((event as CustomEvent<string>).detail, true),
);
void start();
