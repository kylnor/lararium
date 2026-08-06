#!/usr/bin/env node
// Multi-model CLI router for the model-fusion skill. Subscription-authenticated
// CLIs only: billing keys are stripped from every child environment so a stray
// metered key can never silently take over. See SKILL.md for the doctrine.
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
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
  const divider = args.indexOf("--");
  const options = divider === -1 ? [] : args.slice(0, divider);
  const taskParts = divider === -1 ? args : args.slice(divider + 1);
  for (let i = 0; i < options.length; i++) {
    if (options[i] === "--cwd" && options[i + 1]) cwd = options[++i];
  }
  const task = taskParts.join(" ").trim();
  if (!task) throw new Error("task is required after --");
  return { provider, cwd, task };
}

// PATH additions from installers land in .bashrc, which non-interactive shells
// skip, so every bin accepts an absolute-path override rather than trusting PATH.
function readDotenv(name) {
  try {
    const text = readFileSync(`${homedir()}/.env`, "utf-8");
    const line = text.split("\n").find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim() : "";
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
      // Fusion mode passes read-only: there Codex is a critic, not the builder.
      args: ["exec", "--sandbox", sandbox || "workspace-write", "--skip-git-repo-check", task],
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
  if (parsed.provider === "fusion") {
    const briefs = fullFusionTasks(parsed.task);
    const results = await Promise.all(
      Object.entries(briefs).map(([provider, brief]) => runOne(provider, brief, parsed.cwd, "read-only")),
    );
    process.stdout.write(JSON.stringify({ mode: "fusion", results }, null, 2) + "\n");
    return results.every((result) => result.ok) ? 0 : 2;
  }
  const selected = route(parsed.provider, parsed.task);
  const result = await runOne(selected, parsed.task, parsed.cwd);
  process.stdout.write(JSON.stringify({ mode: parsed.provider, selected, result }, null, 2) + "\n");
  return result.ok ? 0 : 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`fusion-run: ${error.message}\n`);
      process.exitCode = 2;
    });
}
