import { generateXpm2 } from "@busy-app/busy-lib";
import { formatHM } from "@shared/datetime";
import { createScreen, type Element } from "./screen";
import { loadValues, type SettingsValues } from "./settings";
import manifest from "./appmeta/manifest.json";

/** The name the app draws under; the device clears elements by this id. */
const APP = manifest.id;

const MINUTE_MS = 60 * 1000;
/** localStorage key of the last dose taken: {name, time}. */
const LAST_KEY = "last";

const WHITE = "#FFFFFFFF";
const GRAY = "#A0A0A0FF";
const AMBER = "#FFB000FF";

/** The capsule left of a due dose, 12 px square: r its red half, w its white half, R and W their shaded edges. */
const PILL = generateXpm2({
  palette: { ".": "none", r: "#F03030", R: "#A01818", w: "#F0F0F0", W: "#A0A0A0" },
  grid: [
    "........rrr.",
    ".......rrrrr",
    "......rrrrrR",
    ".....rrrrrRR",
    "....wrrrrRR.",
    "...wwwrrRR..",
    "..wwwwwRR...",
    ".wwwwwWW....",
    "wwwwwWW.....",
    "wwwwWW......",
    "wwwWW.......",
    ".wWW........",
  ],
});
/** The capsule shakes, two px from side to side, a step every SHAKE_MS. */
const SHAKE_MS = 200;
/** Right of the capsule the dose name and the hint are centered on TEXT_X, in TEXT_W px. */
const TEXT_X = 44;
const TEXT_W = 56;
/**
 * Advances of the bold font for " " to "~", a base-36 digit each, as busy-lib's glyph map has them: its textWidth()
 * would bundle the maps of every font the app names, about 16 KiB of heap.
 */
const BOLD_ADVANCES = "54489982444734467777777777235757a777766775676a877777778b777464755666666665565866665666787665456";

/** The width of text in the bold font; a character the table lacks counts as 7 px. */
function boldWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const advance = BOLD_ADVANCES[ch.charCodeAt(0) - 32];
    width += advance === undefined ? 7 : parseInt(advance, 36);
  }
  return width;
}

type Slot = { name: string; time: string; enabled: boolean };
type Taken = { name: string; time: string };
type Settings = { slots: Slot[]; repeat: number };

/** The defaults of settings.json, for a bar that returns no settings. */
const DEFAULT_SLOTS: Slot[] = [
  { name: "VIT D", time: "21:00", enabled: true },
  { name: "", time: "21:00", enabled: false },
  { name: "", time: "21:00", enabled: false },
  { name: "", time: "21:00", enabled: false },
];
const DEFAULT_REPEAT = 10;

/** Reads the four dose slots (groups slot1..slot4) and the repeat interval. */
async function loadSettings(): Promise<Settings> {
  const values = (await loadValues()) ?? {};
  const slots = DEFAULT_SLOTS.map((fallback, i): Slot => {
    const group = (values[`slot${i + 1}`] ?? {}) as SettingsValues;
    return {
      name: typeof group.name === "string" ? group.name : fallback.name,
      // The bar may keep seconds too ("21:00:00"); doses are matched by the minute.
      time: typeof group.time === "string" ? group.time.slice(0, 5) : fallback.time,
      enabled: typeof group.enabled === "boolean" ? group.enabled : fallback.enabled,
    };
  });
  const repeat = typeof values.repeat_min === "number" ? values.repeat_min : DEFAULT_REPEAT;
  return { slots, repeat };
}

/** "21:00" → minutes since midnight. */
function minutesOf(hm: string): number {
  const [h, m] = hm.split(":");
  return Number(h) * 60 + Number(m);
}

/** The enabled dose that comes next from now, today or tomorrow; null when none is enabled. */
function nextDose(slots: Slot[], now: Date): Slot | null {
  const current = now.getHours() * 60 + now.getMinutes();
  let best: Slot | null = null;
  let bestIn = Infinity;
  for (const slot of slots) {
    if (!slot.enabled) continue;
    const inMinutes = (minutesOf(slot.time) - current + 1440) % 1440;
    if (inMinutes < bestIn) {
      best = slot;
      bestIn = inMinutes;
    }
  }
  return best;
}

/** The last dose taken, as stored on Start; null before the first. */
function readLast(): Taken | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    return raw ? (JSON.parse(raw) as Taken) : null;
  } catch {
    return null;
  }
}

/** Two lines on the front display: a bold one on top, a small one under it. */
function front(top: string, topColor: string, bottom: string): Element[] {
  return [
    { id: "top", type: "text", text: top, font: "bold", color: topColor, x: 36, y: -1, align: "top_mid" },
    { id: "bottom", type: "text", text: bottom, font: "small", color: GRAY, x: 36, y: 8, align: "top_mid" },
  ];
}

/**
 * A due dose: the capsule on the left, `step` setting which side it leans to, the name and "START = TAKEN" right of
 * it. A name too wide for the bold font there is written in the small one.
 */
function reminder(name: string, step: number): Element[] {
  return [
    { id: "pill", type: "xpmbitmap", data: PILL, x: step % 2 === 0 ? 0 : 2, y: 2, align: "top_left" },
    { id: "top", type: "text", text: name, font: boldWidth(name) <= TEXT_W ? "bold" : "small", color: AMBER, x: TEXT_X, y: -1, align: "top_mid" },
    { id: "bottom", type: "text", text: "START = TAKEN", font: "small", color: GRAY, x: TEXT_X, y: 8, align: "top_mid" },
  ];
}

/** The back display, 160x80 without the status bar's 12 px on the right: the last dose taken. */
function back(last: Taken | null): Element {
  const text = last ? `Last: ${last.name} ${last.time}` : "Last: --";
  return { id: "last", type: "text", text, font: "normal", color: WHITE, x: 74, y: 40, align: "center", display: "back" };
}

/**
 * Entry point, called at the end of the file: the device runs this script from top to bottom and starts nothing by itself.
 */
function main(): void {
  const report = (err: unknown) => console.error(`${APP}: ${err instanceof Error ? err.message : String(err)}`);
  const screen = createScreen(APP, report);

  let settings: Settings | null = null;
  /** Doses that came due and are not taken yet, oldest first, each with the minute (Date.now() / 60 s) it came due. */
  const pending: { slot: Slot; since: number }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Shakes the capsule; runs only while a reminder is on the display. */
  let shakeTimer: ReturnType<typeof setInterval> | undefined;
  let shake = 0;
  /** The last dose taken, read once: the shaking redraws the back display several times a second. */
  let last = readLast();
  let stopped = false;

  /**
   * The index of the dose to show now, or -1. A due dose is due again every repeat interval after the minute it came
   * due, until Start, but only one is on screen: one that came due this very minute goes first, otherwise the oldest
   * whose reminder minute it is. The others wait for its Start, which shows the next one due in that minute at once.
   */
  function reminding(): number {
    if (!settings) return -1;
    const minute = Math.floor(Date.now() / MINUTE_MS);
    const repeat = settings.repeat;
    const fresh = pending.findIndex((p) => p.since === minute);
    return fresh >= 0 ? fresh : pending.findIndex((p) => (minute - p.since) % repeat === 0);
  }

  function draw(): void {
    if (stopped || !settings) return;
    const now = new Date();
    const due = reminding();
    shaking(due >= 0);
    if (due >= 0) {
      screen.draw([...reminder(pending[due].slot.name, shake), back(last)]);
      return;
    }
    const next = nextDose(settings.slots, now);
    screen.draw([...front(formatHM(now), WHITE, next ? `${next.name} ${next.time}` : "--"), back(last)]);
  }

  /** Starts the shake timer when a reminder comes on the display, stops it when the reminder leaves. */
  function shaking(on: boolean): void {
    if (on && shakeTimer === undefined) {
      shakeTimer = setInterval(() => {
        shake += 1;
        draw();
      }, SHAKE_MS);
    } else if (!on && shakeTimer !== undefined) {
      clearInterval(shakeTimer);
      shakeTimer = undefined;
    }
  }

  /** Once a minute, just after it begins: every dose whose time it is comes due and joins the end of the queue of doses not taken yet. */
  function tick(): void {
    if (stopped) return;
    if (settings) {
      const hm = formatHM(new Date());
      const minute = Math.floor(Date.now() / MINUTE_MS);
      for (const slot of settings.slots) {
        if (slot.enabled && slot.time === hm && !pending.some((p) => p.slot === slot)) pending.push({ slot, since: minute });
      }
    }
    draw();
    timer = setTimeout(tick, MINUTE_MS - (Date.now() % MINUTE_MS) + 50);
  }

  // The listener keeps the app alive; a long Back is handled by the firmware and quits it.
  const unbind = listen("input", (event) => {
    if (stopped || event.key === "encoder" || event.action !== "short") return;
    if (event.key === "start") {
      const due = reminding();
      if (due < 0) return;
      try {
        const taken: Taken = { name: pending[due].slot.name, time: formatHM(new Date()) };
        localStorage.setItem(LAST_KEY, JSON.stringify(taken));
        last = taken;
      } catch (err) {
        report(err);
      }
      pending.splice(due, 1);
      draw();
    } else if (event.key === "back") {
      // Back leaves the app: with the timers cleared and the handler detached, nothing keeps it alive.
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      if (shakeTimer !== undefined) clearInterval(shakeTimer);
      // Not detached from inside the handler itself: the unbind would stop the app while this handler still runs.
      setTimeout(unbind, 0);
    }
  });

  void loadSettings()
    .then((loaded) => {
      settings = loaded;
      tick();
    })
    .catch(report);
}

main();
