import fs from "node:fs";
import path from "node:path";
import { getCereusDir, ensureCereusDir } from "./config.js";

export interface Overview {
  id: string;
  name: string;
  sessionIds: string[];
  maxPanes: number;
  tmuxSession?: string;
}

const OVERVIEWS_FILE = path.join(getCereusDir(), "overviews.json");

export function loadOverviews(): Overview[] {
  if (!fs.existsSync(OVERVIEWS_FILE)) {
    return [];
  }
  const raw = fs.readFileSync(OVERVIEWS_FILE, "utf-8");
  return JSON.parse(raw);
}

export function saveOverviews(overviews: Overview[]): void {
  ensureCereusDir();
  fs.writeFileSync(OVERVIEWS_FILE, JSON.stringify(overviews, null, 2) + "\n");
}

export function addOverview(overview: Overview): void {
  const overviews = loadOverviews();
  overviews.push(overview);
  saveOverviews(overviews);
}

export function removeOverview(id: string): void {
  const overviews = loadOverviews().filter((o) => o.id !== id);
  saveOverviews(overviews);
}

export function findOverview(idOrName: string): Overview | undefined {
  return loadOverviews().find((o) => o.id === idOrName || o.name === idOrName);
}

export function updateOverview(
  id: string,
  update: Partial<Overview>,
): void {
  const overviews = loadOverviews();
  const idx = overviews.findIndex((o) => o.id === id);
  if (idx !== -1) {
    overviews[idx] = { ...overviews[idx], ...update };
    saveOverviews(overviews);
  }
}

export function attachSessionToOverview(
  overviewId: string,
  sessionId: string,
): void {
  const overviews = loadOverviews();
  const overview = overviews.find((o) => o.id === overviewId);
  if (overview && !overview.sessionIds.includes(sessionId)) {
    overview.sessionIds.push(sessionId);
    saveOverviews(overviews);
  }
}

export function detachSessionFromOverview(
  overviewId: string,
  sessionId: string,
): void {
  const overviews = loadOverviews();
  const overview = overviews.find((o) => o.id === overviewId);
  if (overview) {
    overview.sessionIds = overview.sessionIds.filter((s) => s !== sessionId);
    saveOverviews(overviews);
  }
}
