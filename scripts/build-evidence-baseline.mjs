import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

function walkMarkdown(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkMarkdown(absolute));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(absolute);
  }
  return files.sort();
}

export function normalizeTitle(value) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeUrl(value) {
  try {
    const url = new URL(value.replace(/[),.;]+$/, ""));
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    }
    url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  } catch {
    return value.replace(/[),.;]+$/, "").replace(/\/$/, "");
  }
}

function section(text, heading) {
  const start = new RegExp(`^## ${heading}\\s*$`, "im").exec(text);
  if (!start) return "";
  const tail = text.slice(start.index + start[0].length);
  const next = /^##\s+/m.exec(tail);
  return next ? tail.slice(0, next.index) : tail;
}

function finalNote(text) {
  const frontmatter = /^---\s*\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  return /^status:\s*final\s*$/im.test(frontmatter);
}

function candidateLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line));
}

function entryFromLine(line, sourceFile) {
  const doi = /\b10\.\d{4,9}\/[\w.()/:;-]+/i.exec(line)?.[0]?.replace(/[).,;]+$/, "").toLowerCase() ?? null;
  const arxiv = /(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*)(\d{4}\.\d{4,5})(?:v(\d+))?/i.exec(line);
  const urls = [...line.matchAll(/https?:\/\/[^\s>)\]]+/gi)].map((match) => normalizeUrl(match[0]));
  const linkTitle = /\[([^\]]+)\]\(https?:\/\//.exec(line)?.[1] ?? null;
  const withoutBullet = line.replace(/^[-*]\s+/, "").replace(/https?:\/\/\S+/g, "").trim();
  const title = linkTitle || withoutBullet;
  const normalizedTitle = normalizeTitle(title);
  const arxivId = arxiv?.[1] ?? null;
  const arxivVersion = arxiv?.[2] ? Number(arxiv[2]) : null;
  const canonicalUrl = urls[0] ?? null;
  if (!doi && !arxivId && !canonicalUrl && normalizedTitle.length < 8) return null;
  const aliases = [
    doi ? `doi:${doi}` : null,
    arxivId ? `arxiv:${arxivId}` : null,
    normalizedTitle.length >= 8 ? `title:${normalizedTitle}` : null,
    canonicalUrl ? `url:${canonicalUrl}` : null,
  ].filter(Boolean);
  return {
    key: aliases[0],
    aliases,
    doi,
    arxivId,
    arxivVersion,
    normalizedTitle,
    canonicalUrl,
    reference: withoutBullet,
    sourceFiles: [sourceFile],
  };
}

export function buildEvidenceBaseline(workspace) {
  const root = path.resolve(workspace);
  const sources = [];
  const topicFiles = walkMarkdown(path.join(root, "topics"));
  const topicHashes = {};
  for (const file of topicFiles) {
    const text = fs.readFileSync(file, "utf8");
    const relative = path.relative(root, file).split(path.sep).join("/");
    topicHashes[relative] = createHash("sha256").update(text).digest("hex");
    if (!finalNote(text)) continue;
    for (const line of candidateLines(`${section(text, "References")}\n${section(text, "Sources")}`)) {
      const entry = entryFromLine(line, relative);
      if (entry) sources.push(entry);
    }
  }
  const reportPath = path.join(root, "REPORT.md");
  if (fs.existsSync(reportPath)) {
    const report = fs.readFileSync(reportPath, "utf8");
    for (const line of candidateLines(section(report, "References"))) {
      const entry = entryFromLine(line, "REPORT.md");
      if (entry) sources.push(entry);
    }
  }

  const merged = [];
  for (const source of sources) {
    const matches = merged.filter((entry) => entry.aliases.some((alias) => source.aliases.includes(alias)));
    if (matches.length === 0) {
      merged.push(source);
      continue;
    }
    const existing = matches[0];
    existing.aliases = [...new Set([...existing.aliases, ...source.aliases])].sort();
    existing.sourceFiles = [...new Set([...existing.sourceFiles, ...source.sourceFiles])].sort();
    existing.doi ||= source.doi;
    existing.arxivId ||= source.arxivId;
    existing.arxivVersion = Math.max(existing.arxivVersion ?? 0, source.arxivVersion ?? 0) || null;
    existing.normalizedTitle ||= source.normalizedTitle;
    existing.canonicalUrl ||= source.canonicalUrl;
    for (const duplicate of matches.slice(1)) {
      existing.aliases = [...new Set([...existing.aliases, ...duplicate.aliases])].sort();
      existing.sourceFiles = [...new Set([...existing.sourceFiles, ...duplicate.sourceFiles])].sort();
      merged.splice(merged.indexOf(duplicate), 1);
    }
    existing.key = existing.doi
      ? `doi:${existing.doi}`
      : existing.arxivId
        ? `arxiv:${existing.arxivId}`
        : existing.aliases.find((alias) => alias.startsWith("title:")) ?? existing.aliases[0];
  }
  return {
    schemaVersion: 1,
    reviewId: path.basename(root),
    generatedAt: new Date().toISOString(),
    sourceCount: merged.length,
    topicHashes,
    sources: merged.sort((a, b) => a.key.localeCompare(b.key)),
  };
}

export function verifyLegacyTopicHashes(workspace, baseline) {
  const errors = [];
  if (!baseline || typeof baseline.topicHashes !== "object" || Array.isArray(baseline.topicHashes)) {
    return ["baseline topicHashes is missing or invalid"];
  }
  const root = path.resolve(workspace);
  for (const [relative, expected] of Object.entries(baseline.topicHashes)) {
    const absolute = path.resolve(root, relative);
    const within = path.relative(root, absolute);
    if (within === ".." || within.startsWith(`..${path.sep}`) || path.isAbsolute(within)) {
      errors.push(`legacy topic path escapes workspace: ${relative}`);
      continue;
    }
    if (!fs.existsSync(absolute)) {
      errors.push(`legacy topic is missing: ${relative}`);
      continue;
    }
    const actual = createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
    if (actual !== expected) errors.push(`legacy topic changed: ${relative}`);
  }
  return errors;
}

async function cli() {
  const [first, second, third] = process.argv.slice(2);
  if (first === "verify") {
    if (!second || !third) {
      console.error("Usage: node scripts/build-evidence-baseline.mjs verify <workspace> <baseline.json>");
      process.exitCode = 2;
      return;
    }
    const baseline = JSON.parse(fs.readFileSync(path.resolve(third), "utf8"));
    const errors = verifyLegacyTopicHashes(second, baseline);
    if (errors.length > 0) {
      console.error(errors.join("\n"));
      process.exitCode = 1;
    }
    return;
  }
  const workspace = first;
  const output = second;
  if (!workspace || !output) {
    console.error("Usage: node scripts/build-evidence-baseline.mjs <workspace> <output.json>");
    process.exitCode = 2;
    return;
  }
  const absoluteWorkspace = path.resolve(workspace);
  const absoluteOutput = path.resolve(output);
  const relative = path.relative(absoluteWorkspace, absoluteOutput);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    console.error("Output must stay inside the workspace");
    process.exitCode = 2;
    return;
  }
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
  fs.writeFileSync(absoluteOutput, `${JSON.stringify(buildEvidenceBaseline(absoluteWorkspace), null, 2)}\n`, "utf8");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url).toLowerCase() === invokedPath.toLowerCase()) await cli();
