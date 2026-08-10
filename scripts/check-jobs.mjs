/**
 * check-jobs.mjs — Checks job postings and updates README + status cache.
 *
 * Per-job logic:
 *   - Reads schedule from jobs.json (hourly / daily / weekly)
 *   - Skips a job if it was checked within its schedule window
 *   - Fetches the page, looks for Apply button → open/closed
 *   - Extracts job title, company, location from JSON-LD or page meta
 *   - If a job transitions open → closed: creates a GitHub Issue via `gh`
 *   - Updates status-cache.json and regenerates the README job table
 *
 * Usage:
 *   node scripts/check-jobs.mjs            # normal run
 *   node scripts/check-jobs.mjs --force    # ignore schedule, check everything
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const jobsFile = join(repoRoot, "jobs.json");
const cacheFile = join(repoRoot, "status-cache.json");
const readmeFile = join(repoRoot, "README.md");

const force = process.argv.includes("--force");

// ─── Schedule windows ────────────────────────────────────────────────────────

const SCHEDULE_MS = {
  hourly: 55 * 60 * 1000,
  daily: 23 * 60 * 60 * 1000,
  weekly: 6 * 24 * 60 * 60 * 1000,
};

function isDue(cachedEntry, schedule) {
  if (force || !cachedEntry?.lastChecked) return true;
  const windowMs = SCHEDULE_MS[schedule] ?? SCHEDULE_MS.daily;
  return Date.now() - new Date(cachedEntry.lastChecked).getTime() >= windowMs;
}

// ─── Company detection ───────────────────────────────────────────────────────

const COMPANY_MAP = [
  { pattern: /google\.com\/about\/careers/, company: "Google" },
  { pattern: /careers\.google\.com/, company: "Google" },
  { pattern: /metacareers\.com/, company: "Meta" },
  { pattern: /careers\.microsoft\.com/, company: "Microsoft" },
  { pattern: /jobs\.apple\.com/, company: "Apple" },
  { pattern: /amazon\.jobs/, company: "Amazon" },
  { pattern: /jobs\.netflix\.com/, company: "Netflix" },
  { pattern: /openai\.com\/careers/, company: "OpenAI" },
  { pattern: /anthropic\.com\/careers/, company: "Anthropic" },
  { pattern: /stripe\.com\/jobs/, company: "Stripe" },
  { pattern: /jobs\.lever\.co/, company: "Lever" },
  { pattern: /boards\.greenhouse\.io/, company: "Greenhouse" },
  { pattern: /myworkdayjobs\.com/, company: "Workday" },
  { pattern: /linkedin\.com\/jobs/, company: "LinkedIn" },
  { pattern: /wellfound\.com\/jobs/, company: "Wellfound" },
  { pattern: /jobs\.ashbyhq\.com/, company: "Ashby" },
];

function detectCompany(url) {
  for (const { pattern, company } of COMPANY_MAP) {
    if (pattern.test(url)) return company;
  }
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "Unknown"; }
}

// ─── Page fetch ──────────────────────────────────────────────────────────────

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: controller.signal, redirect: "follow" });
    const html = await res.text();
    return { ok: true, httpStatus: res.status, html };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Open/closed detection ───────────────────────────────────────────────────

const APPLY_PATTERNS = [
  /\bapply\s+(now|for\s+this|to\s+this)/i,
  /<[^>]*(class|id|aria-label)[^>]*=["'][^"']*apply[^"']*["'][^>]*>/i,
  />Apply</i,
  /value=["']Apply["']/i,
];

const CLOSED_PATTERNS = [
  /no longer (?:accepting|available|active)/i,
  /this (?:job|position|role|posting) (?:has been|is) (?:closed|filled|removed|expired)/i,
  /job (?:has )?expired/i,
  /position (?:has been )?filled/i,
  /not accepting applications/i,
];

function detectStatus(html) {
  if (APPLY_PATTERNS.some((p) => p.test(html))) return { status: "open", reason: "Apply button found" };
  if (CLOSED_PATTERNS.some((p) => p.test(html))) return { status: "closed", reason: "Closed language found" };
  return { status: "unknown", reason: "No apply button or closed language detected" };
}

// ─── Job detail extraction (JSON-LD + fallbacks) ─────────────────────────────

function extractDetails(html, url) {
  // Try JSON-LD first (Google, Greenhouse, Lever, etc. all emit this)
  const ldMatch = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (ldMatch) {
    for (const block of ldMatch) {
      try {
        const inner = block.replace(/<[^>]+>/g, "");
        const data = JSON.parse(inner);
        const job = Array.isArray(data) ? data.find((d) => d["@type"] === "JobPosting") : (data["@type"] === "JobPosting" ? data : null);
        if (job) {
          const location = job.jobLocation?.address
            ? [job.jobLocation.address.addressLocality, job.jobLocation.address.addressRegion, job.jobLocation.address.addressCountry].filter(Boolean).join(", ")
            : job.jobLocation?.name ?? null;
          return {
            title: job.title ?? null,
            location: location ?? null,
            description: job.description ? job.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200).trim() + "…" : null,
          };
        }
      } catch {}
    }
  }

  // Fallback: <title> tag
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const rawTitle = titleMatch ? titleMatch[1].trim() : null;
  const cleanTitle = rawTitle ? rawTitle.split(/[|\-–—]/)[0].trim() : null;

  // Fallback: OG description
  const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? null;

  return { title: cleanTitle, location: null, description: ogDesc };
}

// ─── GitHub Issue notification ───────────────────────────────────────────────

function createGitHubIssue(job, details, message) {
  const title = `🔴 Job closed: ${details.title ?? job.url}`;
  const body = [
    `**Company:** ${details.company}`,
    details.title ? `**Role:** ${details.title}` : null,
    details.location ? `**Location:** ${details.location}` : null,
    `**URL:** ${job.url}`,
    message ? `**Note:** ${message}` : null,
    "",
    `This posting no longer shows an Apply button.`,
  ].filter((l) => l !== null).join("\n");

  try {
    execSync(`gh issue create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`, {
      stdio: "pipe",
      cwd: repoRoot,
    });
    console.log(`  📬 GitHub Issue created for closed job`);
  } catch {
    console.log(`  ⚠️  Could not create GitHub Issue (gh CLI not available or not authenticated)`);
  }
}

// ─── README update ───────────────────────────────────────────────────────────

function updateReadme(allJobs, cache) {
  const rows = allJobs.map((job) => {
    const cached = cache[job.url];
    if (!cached) return null;
    const statusIcon = cached.status === "open" ? "✅ Open" : cached.status === "closed" ? "❌ Closed" : "❓ Unknown";
    const title = cached.title ? `[${cached.title}](${job.url})` : `[View posting](${job.url})`;
    const checked = cached.lastChecked ? cached.lastChecked.slice(0, 10) : "—";
    return `| ${title} | ${cached.company ?? "—"} | ${cached.location ?? "—"} | ${statusIcon} | ${checked} | ${job.message ?? "—"} |`;
  }).filter(Boolean);

  const table = [
    "| Job | Company | Location | Status | Last Checked | Notes |",
    "|-----|---------|----------|--------|-------------|-------|",
    ...rows,
  ].join("\n");

  const section = `## Tracked Jobs\n\n${rows.length ? table : "_No jobs checked yet. Add URLs to `jobs.json` and run the check._"}`;

  let readme = existsSync(readmeFile) ? readFileSync(readmeFile, "utf-8") : "";

  if (readme.includes("## Tracked Jobs")) {
    readme = readme.replace(/## Tracked Jobs[\s\S]*?(?=\n## |\n---|\s*$)/, section + "\n\n");
  } else {
    readme = readme.trimEnd() + "\n\n" + section + "\n";
  }

  writeFileSync(readmeFile, readme);
}

// ─── Main ────────────────────────────────────────────────────────────────────

const { jobs } = JSON.parse(readFileSync(jobsFile, "utf-8"));
const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf-8")) : {};

let checked = 0;
let anyChanged = false;

for (const job of jobs) {
  const schedule = job.schedule ?? "daily";
  const cached = cache[job.url];

  if (!isDue(cached, schedule)) {
    console.log(`⏭  Skipping (not due yet, schedule=${schedule}): ${job.url}`);
    continue;
  }

  process.stdout.write(`Checking [${schedule}] ${job.url} … `);

  const fetch = await fetchPage(job.url);
  const company = detectCompany(job.url);

  let status, reason;
  let title = null, location = null, description = null;

  if (!fetch.ok) {
    status = "error"; reason = fetch.error;
  } else if (fetch.httpStatus === 404 || fetch.httpStatus === 410) {
    status = "closed"; reason = `HTTP ${fetch.httpStatus}`;
  } else if (fetch.httpStatus >= 400) {
    status = "error"; reason = `HTTP ${fetch.httpStatus}`;
  } else {
    ({ status, reason } = detectStatus(fetch.html));
    const details = extractDetails(fetch.html, job.url);
    title = details.title;
    location = details.location;
    description = details.description;
  }

  const icon = status === "open" ? "✅" : status === "closed" ? "❌" : "⚠️";
  const displayTitle = title ?? company;
  console.log(`${icon} ${status.toUpperCase()} — ${displayTitle}${location ? ` · ${location}` : ""} (${reason})`);

  // Detect open → closed transition
  if (cached?.status === "open" && status === "closed") {
    anyChanged = true;
    createGitHubIssue(job, { company, title, location }, job.message);
  }

  cache[job.url] = {
    status,
    company,
    title: title ?? cached?.title ?? null,
    location: location ?? cached?.location ?? null,
    description: description ?? cached?.description ?? null,
    lastChecked: new Date().toISOString(),
  };

  checked++;
}

if (checked > 0) {
  writeFileSync(cacheFile, JSON.stringify(cache, null, 2) + "\n");
  updateReadme(jobs, cache);
  console.log(`\nUpdated status-cache.json and README.md (${checked} job${checked !== 1 ? "s" : ""} checked)`);
} else {
  console.log("\nNo jobs were due for checking.");
}
