import chalk from "chalk";
import { execFileSync } from "node:child_process";
import {
  loadOverviews,
  addOverview,
  removeOverview,
  findOverview,
  updateOverview,
  attachSessionToOverview,
  detachSessionFromOverview,
  type Overview,
} from "../lib/overviews.js";
import { loadSessions, findSession, type Session } from "../lib/sessions.js";
import { loadConfig } from "../lib/config.js";
import {
  createSession,
  killSession,
  sessionExists,
  paneExists,
  splitPaneAt,
  killPane,
  setPaneTitle,
  setSessionPaneBorderStatus,
  isInsideTmux,
} from "../lib/tmux.js";

function generateId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `ov_${slug}`;
}

function resolveSessionPaneId(session: Session): string | null {
  if (session.tmuxPane && paneExists(session.tmuxPane)) {
    return session.tmuxPane;
  }
  if (session.tmuxSession && sessionExists(session.tmuxSession)) {
    try {
      const output = execFileSync(
        "tmux",
        ["list-panes", "-t", session.tmuxSession, "-F", "#{pane_id}"],
        { encoding: "utf-8" },
      ).trim();
      const panes = output.split("\n").filter(Boolean);
      return panes[0] || null;
    } catch {
      return null;
    }
  }
  return null;
}

function getOverviewPaneIds(tmuxSessionName: string): string[] {
  try {
    const output = execFileSync(
      "tmux",
      ["list-panes", "-t", tmuxSessionName, "-F", "#{pane_id}"],
      { encoding: "utf-8" },
    ).trim();
    return output.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function getOverviewPaneCount(tmuxSessionName: string): number {
  return getOverviewPaneIds(tmuxSessionName).length;
}

/**
 * Arrange session panes into the overview tmux session using swap-pane.
 * Uses a smart layout: progressively fills a grid, then creates new windows.
 */
function arrangeOverviewPanes(
  overviewTmuxSession: string,
  sessions: Session[],
  maxPanes: number,
): void {
  // First pane: swap it with the first session's pane
  const existingPanes = getOverviewPaneIds(overviewTmuxSession);
  if (existingPanes.length === 0 || sessions.length === 0) return;

  let currentPaneIndex = 0;

  for (const session of sessions) {
    const sessionPaneId = resolveSessionPaneId(session);
    if (!sessionPaneId) continue;

    let targetPaneId: string;

    if (currentPaneIndex === 0) {
      // Use the initial pane of the overview session
      targetPaneId = existingPanes[0];
    } else {
      // Create a new pane using smart layout logic
      const paneCount = getOverviewPaneCount(overviewTmuxSession);

      if (paneCount >= maxPanes) {
        // Create a new window within the overview session
        execFileSync(
          "tmux",
          ["new-window", "-t", overviewTmuxSession, "-c", session.worktreePath],
          { stdio: "ignore" },
        );
        const newPanes = getOverviewPaneIds(overviewTmuxSession);
        targetPaneId = newPanes[newPanes.length - 1];
      } else {
        const panes = getOverviewPaneIds(overviewTmuxSession);
        let direction: "h" | "v";
        let splitTarget: string;

        switch (paneCount) {
          case 1:
            direction = "h";
            splitTarget = panes[0];
            break;
          case 2:
            direction = "v";
            splitTarget = panes[1];
            break;
          case 3:
            direction = "v";
            splitTarget = panes[0];
            break;
          default:
            direction = "h";
            splitTarget = panes[panes.length - 1];
            break;
        }

        targetPaneId = splitPaneAt(splitTarget, session.worktreePath, direction);
      }
    }

    // Swap the session's pane into the overview layout
    try {
      execFileSync(
        "tmux",
        ["swap-pane", "-s", sessionPaneId, "-t", targetPaneId],
        { stdio: "ignore" },
      );
      // After swap: sessionPaneId is now in the overview, targetPaneId went to the session's tmux
      setPaneTitle(sessionPaneId, session.id);
    } catch {
      // If swap fails, the target pane stays as-is
    }

    currentPaneIndex++;
  }
}

/**
 * Swap all session panes back from the overview to their original tmux sessions.
 */
function restoreOverviewPanes(
  overviewTmuxSession: string,
  sessions: Session[],
): void {
  // For each session, its pane is currently in the overview.
  // The displaced pane is in the session's original tmux session.
  // We need to swap them back.
  for (const session of sessions) {
    const sessionPaneId = resolveSessionPaneId(session);
    if (!sessionPaneId) continue;

    // The session's pane is currently in the overview layout.
    // We need to find where the displaced pane ended up (in the session's tmux session).
    // Since swap-pane swapped them, the session's original location now has the overview's empty pane.
    // We can swap them back by swapping again.
    // But we need to know which pane in the overview corresponds to this session.
    // Since we set the pane title, we can find it.
    try {
      const output = execFileSync(
        "tmux",
        ["list-panes", "-t", overviewTmuxSession, "-F", "#{pane_id}\t#{pane_title}"],
        { encoding: "utf-8" },
      ).trim();
      const lines = output.split("\n").filter(Boolean);
      for (const line of lines) {
        const [paneId, title] = line.split("\t");
        if (title === session.id && paneId) {
          // This is the session's pane in the overview — swap it back
          // The displaced pane should be in the session's tmux session
          const displacedId = resolveSessionPaneId(session);
          if (displacedId && displacedId !== paneId) {
            execFileSync(
              "tmux",
              ["swap-pane", "-s", paneId, "-t", displacedId],
              { stdio: "ignore" },
            );
          }
          break;
        }
      }
    } catch {
      // ignore
    }
  }
}

interface OverviewCreateOptions {
  maxPanes?: number;
}

export async function overviewCreateCommand(
  name: string,
  options: OverviewCreateOptions,
): Promise<void> {
  const existing = findOverview(name);
  if (existing) {
    console.error(chalk.red(`Overview '${name}' already exists.`));
    process.exit(1);
  }

  const config = loadConfig();
  const maxPanes = options.maxPanes ?? config.maxPanesPerWindow;

  const overview: Overview = {
    id: generateId(name),
    name,
    sessionIds: [],
    maxPanes,
  };

  addOverview(overview);
  console.log(chalk.green("✔"), `Overview '${name}' created (max ${maxPanes} panes).`);
}

export async function overviewListCommand(): Promise<void> {
  const overviews = loadOverviews();
  if (overviews.length === 0) {
    console.log(chalk.blue("▸"), "No overviews.");
    return;
  }

  for (const ov of overviews) {
    const sessions = ov.sessionIds.length;
    const active = ov.tmuxSession && sessionExists(ov.tmuxSession) ? chalk.green(" (active)") : "";
    console.log(`  ${chalk.bold(ov.name)} — ${sessions} session(s), max ${ov.maxPanes}${active}`);
  }
}

export async function overviewShowCommand(name: string): Promise<void> {
  const overview = findOverview(name);
  if (!overview) {
    console.error(chalk.red(`Overview '${name}' not found.`));
    process.exit(1);
  }

  // Filter to running sessions only
  const allSessions = loadSessions();
  const validSessions = overview.sessionIds
    .map((id) => allSessions.find((s) => s.id === id))
    .filter((s): s is Session => !!s && s.status === "running");

  if (validSessions.length === 0) {
    console.error(chalk.yellow("No running sessions in this overview."));
    process.exit(1);
  }

  const tmuxName = `cr_${overview.id}`;

  // Kill existing overview session if present
  if (sessionExists(tmuxName)) {
    killSession(tmuxName);
  }

  // Create a new overview tmux session
  const cwd = validSessions[0].worktreePath;
  createSession(tmuxName, cwd);
  setSessionPaneBorderStatus(tmuxName);
  updateOverview(overview.id, { tmuxSession: tmuxName });

  // Arrange session panes
  arrangeOverviewPanes(tmuxName, validSessions, overview.maxPanes);

  // Switch or attach
  if (isInsideTmux()) {
    console.log(chalk.green("✔"), `Switching to overview '${name}'...`);
    execFileSync("tmux", ["switch-client", "-t", tmuxName], {
      stdio: "inherit",
    });
  } else {
    console.log(chalk.green("✔"), `Attaching to overview '${name}'...`);
    execFileSync("tmux", ["attach-session", "-t", tmuxName], {
      stdio: "inherit",
    });
  }
}

export async function overviewAttachCommand(
  name: string,
  sessionId: string,
): Promise<void> {
  const overview = findOverview(name);
  if (!overview) {
    console.error(chalk.red(`Overview '${name}' not found.`));
    process.exit(1);
  }

  const session = findSession(sessionId);
  if (!session) {
    console.error(chalk.red(`Session '${sessionId}' not found.`));
    process.exit(1);
  }

  if (session.status !== "running") {
    console.error(chalk.red(`Session '${sessionId}' is not running.`));
    process.exit(1);
  }

  if (overview.sessionIds.includes(sessionId)) {
    console.error(chalk.yellow(`Session '${sessionId}' is already in overview '${name}'.`));
    return;
  }

  if (overview.sessionIds.length >= overview.maxPanes) {
    console.error(chalk.red(`Overview '${name}' is full (${overview.maxPanes} max panes).`));
    process.exit(1);
  }

  // Check session isn't in another overview
  const allOverviews = loadOverviews();
  const otherOverview = allOverviews.find(
    (o) => o.id !== overview.id && o.sessionIds.includes(sessionId),
  );
  if (otherOverview) {
    console.error(
      chalk.red(`Session '${sessionId}' is already in overview '${otherOverview.name}'. Detach it first.`),
    );
    process.exit(1);
  }

  attachSessionToOverview(overview.id, sessionId);
  console.log(chalk.green("✔"), `Session '${sessionId}' attached to overview '${name}'.`);
}

export async function overviewDetachCommand(
  name: string,
  sessionId: string,
): Promise<void> {
  const overview = findOverview(name);
  if (!overview) {
    console.error(chalk.red(`Overview '${name}' not found.`));
    process.exit(1);
  }

  if (!overview.sessionIds.includes(sessionId)) {
    console.error(chalk.yellow(`Session '${sessionId}' is not in overview '${name}'.`));
    return;
  }

  detachSessionFromOverview(overview.id, sessionId);
  console.log(chalk.green("✔"), `Session '${sessionId}' detached from overview '${name}'.`);
}

export async function overviewDeleteCommand(name: string): Promise<void> {
  const overview = findOverview(name);
  if (!overview) {
    console.error(chalk.red(`Overview '${name}' not found.`));
    process.exit(1);
  }

  // If the overview tmux session is active, restore panes and kill it
  if (overview.tmuxSession && sessionExists(overview.tmuxSession)) {
    const allSessions = loadSessions();
    const validSessions = overview.sessionIds
      .map((id) => allSessions.find((s) => s.id === id))
      .filter((s): s is Session => !!s);

    restoreOverviewPanes(overview.tmuxSession, validSessions);
    killSession(overview.tmuxSession);
  }

  removeOverview(overview.id);
  console.log(chalk.green("✔"), `Overview '${name}' deleted.`);
}
