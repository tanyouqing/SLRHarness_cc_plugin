import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parseAndValidateState } from "./state.mjs";
import { parseAndValidateUpdateState } from "./update-state.mjs";

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const REVIEW_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UPDATE_ID = /^update-\d{3}$/;
const TERMINAL_STAGES = new Set(["completed", "completed_with_limitations"]);
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RANKING_VALIDATOR = path.join(PLUGIN_ROOT, "scripts", "validate-ranking-scores.mjs");

function shortAgentName(agentType) {
  if (typeof agentType !== "string") return null;
  return agentType.includes(":") ? agentType.slice(agentType.lastIndexOf(":") + 1) : agentType;
}

function deny(reason) {
  return { allowed: false, reason };
}

function allow() {
  return { allowed: true, reason: null };
}

function inferredProjectRoot(cwd) {
  let current = path.resolve(cwd);
  while (true) {
    const parent = path.dirname(current);
    if (path.basename(parent).toLowerCase() === "workspaces" && REVIEW_SLUG.test(path.basename(current))) {
      return path.dirname(parent);
    }
    if (parent === current) return path.resolve(cwd);
    current = parent;
  }
}

function stableProjectRoot(cwd, configuredRoot) {
  if (typeof configuredRoot === "string" && configuredRoot.trim() !== "") {
    return path.resolve(configuredRoot);
  }
  return inferredProjectRoot(cwd);
}

function workspaceLocation(cwd, target, projectRoot) {
  if (typeof target !== "string" || target.trim() === "") {
    return { location: null, error: "target path is empty" };
  }
  const root = path.resolve(projectRoot);
  const absolute = path.isAbsolute(target) ? path.normalize(target) : path.resolve(cwd, target);
  const projectRelative = path.relative(root, absolute);
  if (
    projectRelative === "" ||
    projectRelative.startsWith(`..${path.sep}`) ||
    projectRelative === ".." ||
    path.isAbsolute(projectRelative)
  ) {
    return { location: null, error: "target is outside the Claude project" };
  }
  const projectParts = projectRelative.split(path.sep);
  if (projectParts[0] !== "workspaces" || projectParts.length < 3 || !REVIEW_SLUG.test(projectParts[1])) {
    return { location: null, error: "target is not inside workspaces/<slug>/" };
  }

  const reviewRoot = path.join(root, "workspaces", projectParts[1]);
  const workspaceParts = projectParts.slice(2);
  if (workspaceParts[0] === "workspaces") {
    return {
      location: null,
      error: "duplicate workspace prefix: cwd is already inside a review; do not prepend workspaces/<slug>/",
    };
  }

  return {
    location: {
      root,
      absolute,
      projectRelative,
      projectParts,
      workspaceRelative: workspaceParts.join(path.sep),
      workspaceParts,
      reviewRoot,
      reviewId: projectParts[1],
    },
    error: null,
  };
}

function isReviewRoot(cwd, target, projectRoot) {
  if (typeof target !== "string" || target.trim() === "") return false;
  const root = path.resolve(projectRoot);
  const absolute = path.isAbsolute(target) ? path.normalize(target) : path.resolve(cwd, target);
  const relative = path.relative(root, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
  const parts = relative.split(path.sep);
  return parts.length === 2 && parts[0] === "workspaces" && REVIEW_SLUG.test(parts[1]);
}

function writePaths(input) {
  const paths = [];
  for (const key of ["file_path", "path", "notebook_path"]) {
    if (typeof input?.[key] === "string") paths.push(input[key]);
  }
  if (Array.isArray(input?.edits)) {
    for (const edit of input.edits) {
      if (typeof edit?.file_path === "string") paths.push(edit.file_path);
      if (typeof edit?.path === "string") paths.push(edit.path);
    }
  }
  return [...new Set(paths)];
}

function tokenize(command) {
  const tokens = [];
  let current = "";
  let quote = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (quote) return null;
  if (current) tokens.push(current);
  return tokens;
}

function validPaperSearchYear(value) {
  const match = /^(19|20)(\d{2})(?:-(19|20)(\d{2}))?$/.exec(value);
  if (!match) return false;
  if (match[3] === undefined) return true;
  const start = Number(`${match[1]}${match[2]}`);
  const end = Number(`${match[3]}${match[4]}`);
  return start <= end;
}

function evaluatePaperSearchShell(command) {
  if (typeof command !== "string" || command.trim() === "") {
    return deny("paper-search shell command is empty");
  }
  if (/[;&|`$<>\r\n]/.test(command)) {
    return deny("paper-search command contains chaining, substitution, redirection, or a newline");
  }

  const tokens = tokenize(command.trim());
  if (!tokens || tokens.length === 0) return deny("paper-search command could not be parsed safely");
  if (tokens[0] !== "paper-search") {
    return deny("scopers and workers may run only the paper-search CLI through shell tools");
  }
  if (tokens.length === 2 && tokens[1] === "sources") return allow();
  if (tokens[1] !== "search") {
    return deny("paper-search access is limited to the sources and search subcommands");
  }
  if (tokens.length < 3 || tokens[2].trim() === "" || tokens[2].startsWith("-")) {
    return deny("paper-search search requires one quoted, non-empty query argument");
  }

  const seen = new Set();
  for (let index = 3; index < tokens.length; index += 2) {
    const option = tokens[index];
    const value = tokens[index + 1];
    if (!new Set(["-n", "-s", "-y"]).has(option) || value === undefined || seen.has(option)) {
      return deny("paper-search search allows each of -n, -s, and -y at most once");
    }
    seen.add(option);
    if (option === "-n" && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 20)) {
      return deny("paper-search -n must be an integer from 1 through 20");
    }
    if (option === "-s" && value !== "all" && !/^[a-z0-9][a-z0-9_-]*(?:,[a-z0-9][a-z0-9_-]*)*$/.test(value)) {
      return deny("paper-search -s must be all or a comma-separated list of source identifiers");
    }
    if (option === "-y" && !validPaperSearchYear(value)) {
      return deny("paper-search -y must be a year or ascending year range between 1900 and 2099");
    }
  }
  return allow();
}

function isSafeWorkspacePath(cwd, candidate, projectRoot, allowedAreas = null) {
  const { location } = workspaceLocation(cwd, candidate, projectRoot);
  if (!location) return false;
  if (!allowedAreas) return true;
  return allowedAreas.includes(location.workspaceParts[0]);
}

function gitOutput(workspace, args) {
  return execFileSync("git", ["-C", workspace, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function evaluateRankingValidator(cwd, tokens, projectRoot) {
  if (tokens.length !== 4 || tokens[0] !== "node" || !samePath(tokens[1], RANKING_VALIDATOR)) {
    return deny("manager may invoke only the bundled ranking validator with one approved scope and one topic note");
  }
  const scopeResult = workspaceLocation(cwd, tokens[2], projectRoot);
  const noteResult = workspaceLocation(cwd, tokens[3], projectRoot);
  if (scopeResult.error || !scopeResult.location) {
    return deny(`ranking validator scope path is invalid: ${scopeResult.error}`);
  }
  if (noteResult.error || !noteResult.location) {
    return deny(`ranking validator note path is invalid: ${noteResult.error}`);
  }
  if (!samePath(scopeResult.location.reviewRoot, noteResult.location.reviewRoot)) {
    return deny("ranking validator scope and note must belong to the same workspace");
  }
  const scopeParts = scopeResult.location.workspaceParts;
  const isRootScope = scopeParts.length === 1 && scopeParts[0] === "SCOPE.md";
  const isUpdateScope =
    scopeParts.length === 3 &&
    scopeParts[0] === "updates" &&
    UPDATE_ID.test(scopeParts[1]) &&
    scopeParts[2] === "SCOPE_APPROVED.md";
  if (!(isRootScope || isUpdateScope)) {
    return deny("ranking validator scope must be SCOPE.md or updates/update-NNN/SCOPE_APPROVED.md");
  }
  if (noteResult.location.workspaceParts[0] !== "topics" || path.extname(noteResult.location.absolute).toLowerCase() !== ".md") {
    return deny("ranking validator target must be one Markdown note under workspace topics/");
  }
  return allow();
}

function updateStatePath(workspace, updateId) {
  return path.join(workspace, ".slr", "updates", updateId, "state.json");
}

function readUpdateState(workspace, updateId) {
  return JSON.parse(fs.readFileSync(updateStatePath(workspace, updateId), "utf8"));
}

function activeUpdateIds(workspace) {
  const root = path.join(workspace, ".slr", "updates");
  if (!fs.existsSync(root)) return [];
  const active = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !UPDATE_ID.test(entry.name)) continue;
    try {
      const state = readUpdateState(workspace, entry.name);
      if (!TERMINAL_STAGES.has(state.stage)) {
        active.push(entry.name);
      } else {
        try {
          gitOutput(workspace, ["rev-parse", "--verify", `${entry.name}-complete`]);
        } catch {
          active.push(entry.name);
        }
      }
    } catch {
      active.push(entry.name);
    }
  }
  return active.sort();
}

function baselineReport(workspace, baselineRef) {
  return execFileSync("git", ["-C", workspace, "show", `${baselineRef}:REPORT.md`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function validateRoundTag(workspace, tag) {
  const match = /^round-([1-9][0-9]*)$/.exec(tag);
  if (!match) return deny("manager may create only round-N tags for N >= 1");
  const round = Number(match[1]);
  let subject;
  let state;
  try {
    if (gitOutput(workspace, ["status", "--porcelain"]) !== "") {
      return deny(`${tag} requires a clean workspace after the review commit`);
    }
    subject = gitOutput(workspace, ["log", "-1", "--pretty=%s"]);
    state = JSON.parse(fs.readFileSync(path.join(workspace, ".slr", "state.json"), "utf8"));
  } catch (error) {
    return deny(`cannot verify ${tag}: ${error.message}`);
  }
  if (!subject.startsWith(`round-${round}-review:`)) {
    return deny(`${tag} must point to a round-${round}-review commit; current HEAD is "${subject}"`);
  }
  if (state.currentRound !== round || state.roundMetrics?.round !== round) {
    return deny(`${tag} requires state.currentRound and roundMetrics.round to equal ${round}`);
  }
  return allow();
}

function validateFinalTag(workspace) {
  let subject;
  let state;
  try {
    if (gitOutput(workspace, ["status", "--porcelain"]) !== "") {
      return deny("slr-complete requires a clean workspace after the final commit");
    }
    subject = gitOutput(workspace, ["log", "-1", "--pretty=%s"]);
    state = JSON.parse(fs.readFileSync(path.join(workspace, ".slr", "state.json"), "utf8"));
  } catch (error) {
    return deny(`cannot verify slr-complete: ${error.message}`);
  }
  if (!subject.startsWith("final:")) return deny("slr-complete must point to a final commit");
  if (!TERMINAL_STAGES.has(state.stage)) return deny("slr-complete requires a terminal review state");
  return allow();
}

function validateUpdateStartTag(workspace, tag) {
  const match = /^(update-\d{3})-start$/.exec(tag);
  if (!match) return deny("update start tag must match update-NNN-start");
  const updateId = match[1];
  try {
    if (gitOutput(workspace, ["status", "--porcelain"]) !== "") {
      return deny(`${tag} requires a clean workspace after the start commit`);
    }
    const subject = gitOutput(workspace, ["log", "-1", "--pretty=%s"]);
    const state = readUpdateState(workspace, updateId);
    if (!subject.startsWith(`${updateId}-start:`)) return deny(`${tag} must point to an ${updateId}-start commit`);
    if (state.stage !== "researching" || state.currentRound !== 0) {
      return deny(`${tag} requires an approved researching update before round 1`);
    }
    return allow();
  } catch (error) {
    return deny(`cannot verify ${tag}: ${error.message}`);
  }
}

function validateUpdateRoundTag(workspace, tag) {
  const match = /^(update-\d{3})-round-([1-9][0-9]*)$/.exec(tag);
  if (!match) return deny("update round tag must match update-NNN-round-N");
  const [, updateId, roundText] = match;
  const round = Number(roundText);
  try {
    if (gitOutput(workspace, ["status", "--porcelain"]) !== "") {
      return deny(`${tag} requires a clean workspace after the update review commit`);
    }
    const subject = gitOutput(workspace, ["log", "-1", "--pretty=%s"]);
    const state = readUpdateState(workspace, updateId);
    if (!subject.startsWith(`${updateId}-round-${round}-review:`)) {
      return deny(`${tag} must point to an ${updateId}-round-${round}-review commit`);
    }
    if (state.currentRound !== round || state.roundMetrics?.round !== round) {
      return deny(`${tag} requires update currentRound and roundMetrics.round to equal ${round}`);
    }
    return allow();
  } catch (error) {
    return deny(`cannot verify ${tag}: ${error.message}`);
  }
}

function validateUpdateCompleteTag(workspace, tag) {
  const match = /^(update-\d{3})-complete$/.exec(tag);
  if (!match) return deny("update completion tag must match update-NNN-complete");
  const updateId = match[1];
  try {
    if (gitOutput(workspace, ["status", "--porcelain"]) !== "") {
      return deny(`${tag} requires a clean workspace after the update final commit`);
    }
    const subject = gitOutput(workspace, ["log", "-1", "--pretty=%s"]);
    const state = readUpdateState(workspace, updateId);
    if (!subject.startsWith(`${updateId}-final:`)) return deny(`${tag} must point to an ${updateId}-final commit`);
    if (!TERMINAL_STAGES.has(state.stage)) return deny(`${tag} requires a terminal update state`);
    return allow();
  } catch (error) {
    return deny(`cannot verify ${tag}: ${error.message}`);
  }
}

function evaluateManagerTag(workspace, tokens) {
  if (tokens.length === 5 && tokens[4] === "--list") return allow();

  if (tokens.length === 5 && tokens[4] === "slr-complete") {
    return validateFinalTag(workspace);
  }

  if (tokens.length === 5 && /^round-/.test(tokens[4])) {
    return validateRoundTag(workspace, tokens[4]);
  }

  if (tokens.length === 5 && /^update-\d{3}-start$/.test(tokens[4])) {
    return validateUpdateStartTag(workspace, tokens[4]);
  }

  if (tokens.length === 5 && /^update-\d{3}-round-/.test(tokens[4])) {
    return validateUpdateRoundTag(workspace, tokens[4]);
  }

  if (tokens.length === 5 && /^update-\d{3}-complete$/.test(tokens[4])) {
    return validateUpdateCompleteTag(workspace, tokens[4]);
  }

  if (
    tokens.length === 7 &&
    tokens[4] === "-f" &&
    /^round-/.test(tokens[5]) &&
    tokens[6] === "HEAD"
  ) {
    return validateRoundTag(workspace, tokens[5]);
  }

  if (
    tokens.length === 7 &&
    tokens[4] === "-f" &&
    /^update-\d{3}-round-/.test(tokens[5]) &&
    tokens[6] === "HEAD"
  ) {
    return validateUpdateRoundTag(workspace, tokens[5]);
  }

  return deny("manager may create only verified review or update checkpoints; only round tags may be repaired with -f <tag> HEAD");
}

function evaluateManagerShell(cwd, command, projectRoot) {
  if (typeof command !== "string" || command.trim() === "") return deny("manager shell command is empty");
  if (/[;&|`$<>\r\n]/.test(command)) {
    return deny("manager shell command contains chaining, substitution, redirection, or a newline");
  }
  const tokens = tokenize(command.trim());
  if (!tokens || tokens.length === 0) return deny("manager shell command could not be parsed safely");

  if (tokens[0] === "node") return evaluateRankingValidator(cwd, tokens, projectRoot);

  if (tokens[0] === "git") {
    if (tokens.length < 4 || tokens[1] !== "-C") return deny("manager Git commands must use git -C <workspace>");
    if (!isReviewRoot(cwd, tokens[2], projectRoot)) {
      return deny("manager Git target must resolve to the absolute workspaces/<slug> review root");
    }
    const workspace = path.isAbsolute(tokens[2]) ? path.normalize(tokens[2]) : path.resolve(cwd, tokens[2]);
    const allowedGit = new Set(["status", "diff", "log", "show", "add", "commit", "tag", "rev-parse"]);
    if (!allowedGit.has(tokens[3])) return deny(`manager Git subcommand is not allowed: ${tokens[3]}`);
    if (tokens.slice(4).some((token) => /^--output(?:=|$)/.test(token))) {
      return deny("manager Git commands may not write output files");
    }
    if (tokens[3] === "add" && !(tokens.length === 5 && tokens[4] === "-A")) {
      return deny("manager may stage changes only with git -C <workspace> add -A");
    }
    if (tokens[3] === "commit") {
      const regular = tokens.length === 6 && tokens[4] === "-m" && tokens[5].trim() !== "";
      const empty =
        tokens.length === 7 &&
        tokens[4] === "--allow-empty" &&
        tokens[5] === "-m" &&
        tokens[6].trim() !== "";
      if (!(regular || empty)) {
        return deny("manager commits must use commit -m <message> or commit --allow-empty -m <message>");
      }
    }
    if (tokens[3] === "tag") {
      return evaluateManagerTag(workspace, tokens);
    }
    return allow();
  }

  if (tokens[0] === "mkdir") {
    const candidates = tokens.slice(1).filter((token) => token !== "-p");
    if (
      candidates.length === 0 ||
      !candidates.every((item) => isSafeWorkspacePath(cwd, item, projectRoot, ["topics", "assets"]))
    ) {
      return deny("manager mkdir targets must stay under workspace topics/ or assets/");
    }
    return allow();
  }

  return deny("manager shell access is limited to the ranking validator, allowlisted git -C, and mkdir commands");
}

function evaluateManagerStateWrite(location, input, toolName) {
  if (toolName !== "Write") return deny("state.json must be replaced atomically with Write, not patched with Edit");
  if (typeof input?.content !== "string") return deny("state.json Write requires complete JSON content");
  let previous = null;
  if (fs.existsSync(location.absolute)) {
    try {
      previous = JSON.parse(fs.readFileSync(location.absolute, "utf8"));
    } catch {
      return deny("existing state.json is invalid; stop for manual recovery");
    }
  }
  const result = parseAndValidateState(input.content, previous);
  if (result.errors.length > 0) return deny(`invalid state update: ${result.errors.join("; ")}`);
  return allow();
}

function evaluateManagerUpdateStateWrite(location, input, toolName) {
  if (toolName !== "Write") return deny("update state.json must be replaced atomically with Write, not patched with Edit");
  if (typeof input?.content !== "string") return deny("update state.json Write requires complete JSON content");
  let previous = null;
  if (fs.existsSync(location.absolute)) {
    try {
      previous = JSON.parse(fs.readFileSync(location.absolute, "utf8"));
    } catch {
      return deny("existing update state.json is invalid; stop for manual recovery");
    }
  }
  const result = parseAndValidateUpdateState(input.content, previous);
  if (result.errors.length > 0) return deny(`invalid update state: ${result.errors.join("; ")}`);
  return allow();
}

function evaluateUpdateReportWrite(location, input, toolName, updateId) {
  if (toolName !== "Write" || typeof input?.content !== "string") {
    return deny("update mode requires a complete REPORT.md Write so its historical prefix can be verified");
  }
  try {
    const state = readUpdateState(location.reviewRoot, updateId);
    const baseline = baselineReport(location.reviewRoot, state.baselineRef);
    if (!input.content.startsWith(baseline)) {
      return deny(`REPORT.md must preserve the exact ${state.baselineRef} report as its prefix`);
    }
  } catch (error) {
    return deny(`cannot verify update report preservation: ${error.message}`);
  }
  return allow();
}

export function evaluateHook(input) {
  const agent = shortAgentName(input?.agent_type);
  if (!new Set(["slr-scoper", "slr-worker", "slr-manager", "slr-paper-writer"]).has(agent)) return allow();

  const toolName = input?.tool_name;
  const toolInput = input?.tool_input ?? {};
  const cwd = input?.cwd ?? process.cwd();
  const projectRoot = stableProjectRoot(
    cwd,
    input?.project_dir ?? process.env.CLAUDE_PROJECT_DIR,
  );

  if (SHELL_TOOLS.has(toolName)) {
    if (agent === "slr-paper-writer") {
      return deny("slr-paper-writer has no shell or search-CLI access");
    }
    if (agent === "slr-manager") return evaluateManagerShell(cwd, toolInput.command, projectRoot);
    return evaluatePaperSearchShell(toolInput.command);
  }

  if (!WRITE_TOOLS.has(toolName)) return allow();
  if (agent === "slr-scoper") return deny("slr-scoper is read-only");

  const targets = writePaths(toolInput);
  if (targets.length === 0) return deny(`${agent} write tool call has no resolvable target path`);

  for (const target of targets) {
    const resolved = workspaceLocation(cwd, target, projectRoot);
    if (!resolved.location) return deny(`${agent}: ${resolved.error}`);
    const location = resolved.location;
    const area = location.workspaceParts[0];

    if (agent === "slr-paper-writer") {
      if (location.workspaceRelative !== path.join("paper", "REVIEW_PAPER.md")) {
        return deny("slr-paper-writer may write only paper/REVIEW_PAPER.md");
      }
      continue;
    }

    if (agent === "slr-worker") {
      if (!new Set(["topics", "assets"]).has(area)) {
        return deny("slr-worker may write only under topics/ or assets/");
      }
      const activeIds = activeUpdateIds(location.reviewRoot);
      if (activeIds.length > 1) return deny("multiple active updates make worker ownership ambiguous");
      if (activeIds.length === 1) {
        const updateId = activeIds[0];
        const expected = area === "topics"
          ? ["topics", "updates", updateId]
          : ["assets", "updates", updateId];
        if (!expected.every((part, index) => location.workspaceParts[index] === part)) {
          return deny(`active ${updateId}: worker may write only its incremental topics/assets subtree`);
        }
      }
      continue;
    }

    if (location.workspaceRelative === "SCOPE_ORIGINAL.md") {
      return deny("SCOPE_ORIGINAL.md is immutable");
    }
    if (location.workspaceParts.includes(".git")) return deny("direct writes to Git metadata are forbidden");

    const activeIds = activeUpdateIds(location.reviewRoot);
    if (activeIds.length > 1) return deny("multiple active updates make manager ownership ambiguous");
    const activeUpdate = activeIds[0] ?? null;
    if (activeUpdate) {
      const isReport = location.workspaceRelative === "REPORT.md";
      const isUpdateTask =
        location.workspaceParts.length === 3 &&
        area === "updates" &&
        location.workspaceParts[1] === activeUpdate &&
        location.workspaceParts[2] === "TASKS.md";
      const isUpdateState =
        location.workspaceParts.length === 4 &&
        area === ".slr" &&
        location.workspaceParts[1] === "updates" &&
        location.workspaceParts[2] === activeUpdate &&
        location.workspaceParts[3] === "state.json";
      const isUpdateTopic =
        new Set(["topics", "assets"]).has(area) &&
        location.workspaceParts[1] === "updates" &&
        location.workspaceParts[2] === activeUpdate;
      if (!(isReport || isUpdateTask || isUpdateState || isUpdateTopic)) {
        return deny(`active ${activeUpdate}: manager may change only its task/state/output subtree and REPORT.md`);
      }
      if (isReport) {
        const result = evaluateUpdateReportWrite(location, toolInput, toolName, activeUpdate);
        if (!result.allowed) return result;
      }
      if (isUpdateState) {
        const result = evaluateManagerUpdateStateWrite(location, toolInput, toolName);
        if (!result.allowed) return result;
      }
      continue;
    }

    const rootAllowed = new Set(["SCOPE.md", "TASKS.md", "REPORT.md"]);
    const rootName = location.workspaceParts.length === 1 ? location.workspaceParts[0] : null;
    const isState =
      location.workspaceParts.length === 2 && area === ".slr" && location.workspaceParts[1] === "state.json";
    const isResearchOutput = new Set(["topics", "assets"]).has(area);
    if (!(rootAllowed.has(rootName) || isState || isResearchOutput)) {
      return deny("slr-manager may write only SCOPE.md, TASKS.md, REPORT.md, state.json, topics/, or assets/");
    }
    if (isState) {
      const result = evaluateManagerStateWrite(location, toolInput, toolName);
      if (!result.allowed) return result;
    }
  }

  return allow();
}

async function main() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try {
    input = JSON.parse(raw);
  } catch (error) {
    console.error(`SLR Harness guard received invalid JSON: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  const decision = evaluateHook(input);
  if (!decision.allowed) {
    console.error(`SLR Harness guard: ${decision.reason}`);
    process.exitCode = 2;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url).toLowerCase() === invokedPath.toLowerCase()) {
  await main();
}
