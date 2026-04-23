#!/usr/bin/env node
// Generator for Supabase auth email templates. Reads _shell.html + _bodies/*.js,
// writes ready-to-paste HTML into auth/. Run via `npm run build:email-templates`.
//
// Generator placeholders: {{NAME}} (no leading dot). Supabase Go-template vars
// like {{ .ConfirmationURL }} use a different syntax (leading dot, spaces) and
// pass through the generator untouched — which is asserted below.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const shellPath = join(__dirname, "_shell.html");
const bodiesDir = join(__dirname, "_bodies");
const outDir = join(__dirname, "auth");

const shell = readFileSync(shellPath, "utf8");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const bodyFiles = readdirSync(bodiesDir).filter((f) => f.endsWith(".js"));
if (bodyFiles.length === 0) {
  console.error("No body files found in _bodies/");
  process.exit(1);
}

const GENERATOR_PLACEHOLDER_RE = /\{\{[A-Z_]+\}\}/;
const SUPABASE_CONFIRMATION_URL_RE = /\{\{\s*\.ConfirmationURL\s*\}\}/;

let failures = 0;

for (const bodyFile of bodyFiles) {
  const name = basename(bodyFile, ".js");
  const modPath = join(bodiesDir, bodyFile);
  const mod = (await import(pathToFileURL(modPath).href)).default;

  const required = ["preheader", "heading", "ctaLabel", "ctaUrl", "bodyHtml", "plainText", "supportEmail"];
  for (const key of required) {
    if (typeof mod[key] !== "string") {
      console.error(`✗ ${name}: missing or non-string "${key}"`);
      failures++;
      continue;
    }
  }

  const html = shell
    .replaceAll("{{PREHEADER}}", mod.preheader)
    .replaceAll("{{HEADING}}", mod.heading)
    .replace("{{BODY}}", mod.bodyHtml)
    .replaceAll("{{CTA_LABEL}}", mod.ctaLabel)
    .replaceAll("{{CTA_URL}}", mod.ctaUrl)
    .replaceAll("{{FOOTER_NOTE}}", mod.footerNote || "")
    .replaceAll("{{SUPPORT_EMAIL}}", mod.supportEmail);

  // Assertion 1: no generator placeholder survives. Typo like {{HEADNG}} in
  // the shell would otherwise quietly ship to the Dashboard.
  const survivor = html.match(GENERATOR_PLACEHOLDER_RE);
  if (survivor) {
    console.error(`✗ ${name}: unresolved generator placeholder ${survivor[0]}`);
    failures++;
    continue;
  }

  // Assertion 2: the Supabase Go-template CTA variable survived. All four
  // auth templates use it — if it's missing, the template would send a
  // literal "{{ .ConfirmationURL }}" string as a broken link.
  if (!SUPABASE_CONFIRMATION_URL_RE.test(html)) {
    console.error(`✗ ${name}: expected {{ .ConfirmationURL }} in output but not found`);
    failures++;
    continue;
  }

  const output = `<!-- plain-text fallback (paste into Supabase Dashboard's plain-text field):
${mod.plainText}
-->
<!-- GENERATED FILE — edit _bodies/${bodyFile} and run npm run build:email-templates -->
${html}`;

  writeFileSync(join(outDir, `${name}.html`), output);
  console.log(`✓ ${name}.html`);
}

if (failures > 0) {
  console.error(`\n${failures} failure(s) — aborting. Output may be invalid for Dashboard paste.`);
  process.exit(1);
}
console.log(`\nGenerated ${bodyFiles.length} auth email templates in ${outDir}`);
