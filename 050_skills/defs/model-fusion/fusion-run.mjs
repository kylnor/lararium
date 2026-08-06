#!/usr/bin/env node
// Multi-model CLI router for the model-fusion skill. Subscription-authenticated
// CLIs only: billing keys are stripped from every child environment so a stray
// metered key can never silently take over. See SKILL.md for the doctrine.
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
// Aliased: runOne's Promise executor binds a local `resolve`, and an
// unaliased path import would be shadowed there - silently, and only for
// whoever adds a path call inside it later.
import { resolve as resolvePath, sep } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

const VALID = new Set(["auto", "claude", "codex", "gemini", "grok", "fusion"]);
const CODE = /\b(code|repo|repository|implement|fix|debug|test|build|refactor|typescript|javascript|python|migration|commit|lint|ci)\b/i;
const WIDE = /\b(video|audio|image|pdf|transcript|documents?|corpus|compare (?:all|these)|large context|research packet)\b/i;

export function route(provider, task) {
  if (provider !== "auto") return provider;
  if (CODE.test(task)) return "codex";
  if (WIDE.test(task)) return "gemini";
  return "claude";
}

export function parseArgs(argv) {
  const args = [...argv];
  const provider = String(args.shift() || "auto").toLowerCase();
  if (!VALID.has(provider)) throw new Error(`unknown provider: ${provider}`);
  let cwd = process.cwd();
  let write = false;
  const divider = args.indexOf("--");
  const options = divider === -1 ? [] : args.slice(0, divider);
  const taskParts = divider === -1 ? args : args.slice(divider + 1);
  for (let i = 0; i < options.length; i++) {
    if (options[i] === "--cwd" && options[i + 1]) cwd = options[++i];
    else if (options[i] === "--write") write = true;
  }
  const task = taskParts.join(" ").trim();
  if (!task) throw new Error("task is required after --");
  return { provider, cwd, task, write };
}

/**
 * Trust gate.
 *
 * This runner passes --skip-trust to Gemini and --skip-git-repo-check to Codex.
 * Both flags exist to defeat a safety prompt those CLIs show before operating
 * on a workspace they do not recognize, and both are required to run headless.
 * Fine. But it means fusion will happily point three third-party agents at
 * whatever --cwd you hand it, with their own guardrails switched off, which is
 * precisely the posture 060_lab/ exists to prevent. Shipping both in one repo
 * without saying so was the contradiction.
 *
 * So the cwd is now stated out loud on every run, and can be constrained:
 *
 *   FUSION_TRUSTED_ROOTS=/Users/you/Dev:/Users/you/work
 *
 * When set, a cwd outside those roots is refused. Unset means "anywhere",
 * which is the old behaviour and still the default - this is opt-in hardening,
 * not a breaking change. If the code you want a second opinion on is code you
 * do not trust, the answer is not this tool. Read it in the lab first.
 */
export function assertTrustedCwd(cwd) {
  const roots = (process.env.FUSION_TRUSTED_ROOTS || "").split(":").filter(Boolean);
  if (!roots.length) return;
  const resolved = resolvePath(cwd);
  const ok = roots.some((r) => {
    const root = resolvePath(r);
    return resolved === root || resolved.startsWith(root + sep);
  });
  if (!ok) {
    throw new Error(
      `refusing to run in ${resolved}\n` +
      `  FUSION_TRUSTED_ROOTS is set and does not cover it:\n` +
      roots.map((r) => `    ${resolvePath(r)}`).join("\n") + "\n" +
      `  These agents run with their own workspace-trust prompts disabled, so the\n` +
      `  directory is the only boundary left. For code you do not trust, use 060_lab/.`
    );
  }
}

// PATH additions from installers land in .bashrc, which non-interactive shells
// skip, so every bin accepts an absolute-path override rather than trusting PATH.
function readDotenv(name) {
  try {
    const text = readFileSync(`${homedir()}/.env`, "utf-8");
    const line = text.split("\n").find((l) => l.startsWith(`${name}=`));
    if (!line) return "";
    // Strip surrounding quotes. KEY="abc" in a .env is the common spelling, and
    // passing the quotes through as part of the credential fails auth with an
    // error that blames the key rather than the parser.
    return line.slice(name.length + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  } catch {
    return "";
  }
}

function cleanEnv(provider) {
  const env = { ...process.env };
  const keys = {
    claude: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
    codex: ["OPENAI_API_KEY", "CODEX_API_KEY"],
    // Grok authenticates from ~/.grok/auth.json (subscription OAuth). Strip
    // every metered key so a stray one can never silently take over.
    grok: ["XAI_API_KEY", "GROK_API_KEY", "GROK_CODE_XAI_API_KEY"],
    gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  }[provider];
  for (const key of keys) delete env[key];
  // Personal-account OAuth is dead for the Gemini CLI (see SKILL.md), so this
  // leg runs on a key. It should be a key from a Google Cloud project with NO
  // billing account: it throttles instead of charging. Any paid keys in ~/.env
  // stay untouched for the rest of your stack.
  if (provider === "gemini") {
    const free = process.env.GEMINI_FUSION_API_KEY || readDotenv("GEMINI_FUSION_API_KEY");
    if (free) env.GEMINI_API_KEY = free;
  }
  return env;
}

function command(provider, task, sandbox) {
  if (provider === "codex") {
    return {
      bin: process.env.FUSION_CODEX_BIN || "codex",
      // --skip-git-repo-check: the Gemini --skip-trust twin; codex exec refuses
      // to run outside a git repo without it, and fusion runs in arbitrary cwds.
      // See assertTrustedCwd for why that combination is worth constraining.
      //
      // Default is READ-ONLY. It used to be workspace-write for single runs,
      // which meant `fusion codex -- "look at this"` could edit the tree while
      // reading it. Asking for a second opinion should not be a write
      // operation; pass --write when you actually want the builder.
      args: ["exec", "--sandbox", sandbox || "read-only", "--skip-git-repo-check", task],
    };
  }
  if (provider === "grok") {
    return {
      bin: process.env.FUSION_GROK_BIN || `${homedir()}/.grok/bin/grok`,
      args: ["-p", task],
    };
  }
  if (provider === "gemini") {
    // --skip-trust: the CLI refuses to run headless in an untrusted workspace.
    // -m: a fresh free-tier project cannot reach the CLI's default model.
    return {
      bin: process.env.FUSION_GEMINI_BIN || "gemini",
      args: ["--skip-trust", "-m", process.env.FUSION_GEMINI_MODEL || "gemini-flash-latest", "-p", task],
    };
  }
  return {
    bin: process.env.FUSION_CLAUDE_BIN || "claude",
    args: ["-p", task],
  };
}

async function runOne(provider, task, cwd, sandbox) {
  await access(cwd);
  const spec = command(provider, task, sandbox);
  const started = Date.now();
  return new Promise((resolve) => {
    const child = execFile(spec.bin, spec.args, {
      cwd,
      env: cleanEnv(provider),
      timeout: Number(process.env.FUSION_TIMEOUT_MS || 20 * 60 * 1000),
      maxBuffer: 16 * 1024 * 1024,
      killSignal: "SIGKILL",
    });
    // codex exec reads "additional input" from stdin whenever it is a pipe, and
    // execFile leaves the pipe open, so an unclosed stdin hangs that leg forever.
    child.stdin?.end();
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) =>
      resolve({ provider, ok: false, elapsed_ms: Date.now() - started, error: error.message, stderr: stderr.slice(-1200) }),
    );
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ provider, ok: true, elapsed_ms: Date.now() - started, output: stdout.trim() });
      } else {
        resolve({
          provider,
          ok: false,
          elapsed_ms: Date.now() - started,
          error: `${provider} exited ${code}`,
          stderr: stderr.slice(-1200),
        });
      }
    });
  });
}

function fullFusionTasks(task) {
  return {
    claude: `Act as the strategist. Analyze the objective, constraints, tradeoffs, and likely failure modes. Do not implement. Task:\n${task}`,
    codex: `Act as the implementation engine. Produce the concrete implementation or operational plan, verify claims where possible, and identify exact blockers. Task:\n${task}`,
    gemini: `Act as the independent evidence auditor. Look for missing context, unsupported assumptions, counterarguments, and a better alternative. Do not merely agree. Task:\n${task}`,
    grok: `Act as the red team. Argue the strongest case that this is the wrong approach, name the failure mode nobody has priced in, and say what you would do instead. Be blunt. Do not hedge. Task:\n${task}`,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  assertTrustedCwd(parsed.cwd);
  // Stated out loud because the agents this launches have their own workspace
  // trust prompts disabled. If this line ever names a directory you did not
  // mean, that is the warning you would otherwise not get.
  process.stderr.write(`fusion: ${parsed.provider} in ${resolvePath(parsed.cwd)}` +
    `${parsed.write ? " (WRITE enabled)" : ""}\n`);
  if (parsed.provider === "fusion") {
    const briefs = fullFusionTasks(parsed.task);
    const results = await Promise.all(
      Object.entries(briefs).map(([provider, brief]) => runOne(provider, brief, parsed.cwd, "read-only")),
    );
    process.stdout.write(JSON.stringify({ mode: "fusion", results }, null, 2) + "\n");
    return results.every((result) => result.ok) ? 0 : 2;
  }
  const selected = route(parsed.provider, parsed.task);
  const result = await runOne(selected, parsed.task, parsed.cwd,
    parsed.write ? "workspace-write" : "read-only");
  process.stdout.write(JSON.stringify({ mode: parsed.provider, selected, result }, null, 2) + "\n");
  return result.ok ? 0 : 2;
}

// pathToFileURL, not string concatenation: a path containing a space or any
// other character needing percent-encoding never matches the naive form, so
// the script silently does nothing when run from such a directory.
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`fusion-run: ${error.message}\n`);
      process.exitCode = 2;
    });
}
