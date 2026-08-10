/**
 * check-jobs.mjs — Fetches each URL in jobs.json and checks if the posting is still open.
 *
 * Open = Apply button present on the page.
 * Closed = 404/410 status, or page contains "no longer" / "closed" language without an Apply button.
 *
 * Usage:
 *   node scripts/check-jobs.mjs              # check all jobs
 *   node scripts/check-jobs.mjs --url <url>  # check a single URL
 *   node scripts/check-jobs.mjs --json       # output results as JSON
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

// ─── Company detection from URL ────────────────────────────────────────────

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
  { pattern: /jobs\.lever\.co/, company: "Lever ATS" },
  { pattern: /boards\.greenhouse\.io/, company: "Greenhouse ATS" },
  { pattern: /myworkdayjobs\.com/, company: "Workday ATS" },
  { pattern: /linkedin\.com\/jobs/, company: "LinkedIn" },
  { pattern: /wellfound\.com\/jobs/, company: "Wellfound" },
  { pattern: /jobs\.ashbyhq\.com/, company: "Ashby ATS" },
];

function detectCompany(url) {
  for (const { pattern, company } of COMPANY_MAP) {
    if (pattern.test(url)) return company;
  }
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Unknown";
  }
}

// ─── "Apply" button detection ───────────────────────────────────────────────
// Looks for an Apply button/link. Patterns are intentionally broad to catch
// "Apply now", "Apply for this job", "Apply on company site", etc.

const APPLY_PATTERNS = [
  /\bapply\s+(?:now|for\s+this|to\s+this)/i,
  /<[^>]*(?:class|id|aria-label)[^>]*apply[^>]*>/i,
  /(?:href|action)[^"']*apply[^"']*"/i,
  /value=["']Apply["']/i,
  />Apply</i,
];

const CLOSED_PATTERNS = [
  /no longer (?:accepting|available|active)/i,
  /this (?:job|position|role|posting) (?:has been|is) (?:closed|filled|removed|expired|archived)/i,
  /job (?:has )?expired/i,
  /position (?:has been )?filled/i,
  /posting is closed/i,
  /not accepting applications/i,
];

function analyzeHtml(html) {
  const hasApply = APPLY_PATTERNS.some((p) => p.test(html));
  const hasClosed = CLOSED_PATTERNS.some((p) => p.test(html));

  if (hasApply) return { status: "open", reason: "Apply button found" };
  if (hasClosed) return { status: "closed", reason: "Closed language found" };
  return { status: "unknown", reason: "No apply button or closed language detected" };
}

// ─── Fetch with retries ──────────────────────────────────────────────────────

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: controller.signal, redirect: "follow" });
    const html = await res.text();
    return { ok: true, status: res.status, html };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Check a single job ──────────────────────────────────────────────────────

async function checkJob(job) {
  const company = detectCompany(job.url);
  const result = await fetchPage(job.url);

  if (!result.ok) {
    return { ...job, company, status: "error", reason: result.error };
  }

  if (result.status === 404 || result.status === 410) {
    return { ...job, company, status: "closed", reason: `HTTP ${result.status}` };
  }

  if (result.status >= 400) {
    return { ...job, company, status: "error", reason: `HTTP ${result.status}` };
  }

  const { status, reason } = analyzeHtml(result.html);
  return { ...job, company, status, reason };
}

// ─── Main ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const singleUrl = args.includes("--url") ? args[args.indexOf("--url") + 1] : null;

const jobsFile = join(repoRoot, "jobs.json");
if (!existsSync(jobsFile)) {
  console.error("jobs.json not found");
  process.exit(1);
}

const { jobs } = JSON.parse(readFileSync(jobsFile, "utf-8"));

const toCheck = singleUrl
  ? [{ url: singleUrl, title: singleUrl }]
  : jobs;

if (toCheck.length === 0) {
  console.log("No jobs to check. Add some to jobs.json.");
  process.exit(0);
}

const results = [];
for (const job of toCheck) {
  if (!jsonOutput) process.stdout.write(`Checking ${job.url} … `);
  const result = await checkJob(job);
  results.push(result);

  if (!jsonOutput) {
    const icon = result.status === "open" ? "✅" : result.status === "closed" ? "❌" : "⚠️";
    console.log(`${icon} ${result.status.toUpperCase()} — ${result.company}${result.title ? ` · ${result.title}` : ""} (${result.reason})`);
  }
}

if (jsonOutput) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const open = results.filter((r) => r.status === "open").length;
  const closed = results.filter((r) => r.status === "closed").length;
  const unknown = results.filter((r) => r.status === "unknown" || r.status === "error").length;
  console.log(`\nSummary: ${open} open · ${closed} closed · ${unknown} unknown/error`);
}
