# jobs

Brainrot Creations job posting tracker — checks if job URLs are still open by looking for the Apply button.

## How it works

1. Add job URLs to `jobs.json`
2. Run `npm run check` — each URL is fetched and checked for an Apply button
3. Open = Apply button found · Closed = 404 or "no longer available" language · Unknown = neither detected

GitHub Actions runs the check daily at 9am UTC automatically.

## Add a job

```bash
node scripts/add-job.mjs --url "https://..." --title "Role Name"
```

Or edit `jobs.json` directly:

```json
{
  "jobs": [
    {
      "url": "https://www.google.com/about/careers/applications/jobs/results/...",
      "title": "Software Engineer",
      "added": "2026-08-10"
    }
  ]
}
```

## Check all jobs

```bash
npm run check
```

Output as JSON:

```bash
node scripts/check-jobs.mjs --json
```

Check a single URL without adding it:

```bash
node scripts/check-jobs.mjs --url "https://..."
```

## Supported companies

Auto-detected from URL: Google, Meta, Microsoft, Apple, Amazon, Netflix, OpenAI, Anthropic, Stripe, LinkedIn, and any Greenhouse / Lever / Workday / Ashby ATS link.
