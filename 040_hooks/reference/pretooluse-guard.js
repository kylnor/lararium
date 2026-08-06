#!/usr/bin/env node
/**
 * PreToolUse hook (reference implementation): the safety rail.
 *
 * Fires before every tool call. It can block a call ("deny"), pause for a human
 * ("ask"), or stay silent (allow). This reference version pattern-matches a
 * starter set of dangerous Bash commands: unconditional destruction is denied,
 * ambiguous-but-risky commands are escalated to "ask" so a human decides.
 *
 * Output contract, printed to stdout:
 *   { "hookSpecificOutput": {
 *       "hookEventName": "PreToolUse",
 *       "permissionDecision": "deny",          // or "ask"
 *       "permissionDecisionReason": "why"
 *   } }
 * To allow, print nothing. On any error, print nothing (fail open). Always
 * exit 0: a crashed guard must not wedge the session.
 *
 * THE BIAS: deny only unconditional destruction. Use "ask" for anything
 * ambiguous. Falsely blocking real work is worse than missing an edge case, so
 * keep the deny list tight and specific, not clever.
 *
 * stdin payload: { "tool_name": "Bash", "tool_input": { "command": "..." } }
 *
 * Test standalone:
 *   echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}' | node pretooluse-guard.js
 *   echo '{"tool_name":"Bash","tool_input":{"command":"ls -la"}}'  | node pretooluse-guard.js
 */
'use strict'

// Each rule: a regex, the decision tier, and the reason surfaced on a match.
// The reason should name the danger and, where possible, the safe alternative.
const RULES = [

  // ─────────────────────────────────────────────────────────────────────
  // YOUR RULES GO HERE. Ships empty on purpose.
  //
  // Everything below this block guards against DESTRUCTION. That is not
  // the only thing this file is for. It is also where your own working
  // protocol gets enforced BEFORE a command runs, which is the one thing
  // a rule written in prose can never do.
  //
  // A prose rule (in your CLAUDE.md, in memory, in a doc) can only be
  // recalled, and recall is triggered by relevance scoring over recent
  // turns, so it always trails the action. The reminder arrives two or
  // three turns after the merge you were supposed to not make. This block
  // is how a rule fires first instead of last.
  //
  // ── How to fill it in ──
  //
  // Do not sit down and try to list your rules. You will forget the ones
  // that actually bite and invent ones you don't need. Nobody can recall
  // their own protocol cold; people only recognize one being violated.
  //
  // So wait for that. The next time a reminder lands AFTER you have
  // already done the thing, you are holding both halves of the rule:
  //
  //   the command you just ran   -> the regex
  //   the reminder text          -> the reason
  //
  // Paste them in as a new entry. That reminder has now fired late for
  // the last time. Capture them one at a time as they annoy you; three
  // or four is a complete set for most people.
  //
  //   {
  //     re: /\bgit\s+merge\b/i,   // the command that triggered it
  //     decision: 'ask',          // 'ask' pauses; 'deny' blocks outright
  //     reason: 'Paste the reminder text here, as-is.',
  //   },
  //
  // Use 'ask' for protocol and reserve 'deny' for what you never want
  // under any circumstance. A guard that cries wolf gets disabled, and a
  // disabled guard protects nothing. First match wins, so put specific
  // rules above general ones.
  // ─────────────────────────────────────────────────────────────────────

  // ── Stock rules: unconditional destruction, safe to leave as-is ──
  //
  // These are DEFENCE IN DEPTH, not the primary control. bash-deny-guard.py
  // does the structural work (real tokenization, binary normalization, fail
  // closed) and 040_hooks/sandbox/ does the capability work. These rules are a
  // fast, readable first pass over the raw string, and they are still only
  // pattern matching: `rm` here is the literal word `rm`, so `/bin/rm` and
  // `busybox rm` are the other guard's job, not this one. Read
  // 040_hooks/README.md for which control covers what.
  //
  // Shared flag fragment. Accepts short clusters (-rf, -fr, -R -f) and long
  // forms (--recursive, --force), in any order and any number. The v2.15
  // version only understood short clusters, so `rm --recursive --force /`
  // walked straight past a rule whose entire purpose was to stop it.
  {
    // Bare root, bare home, or home with only whitespace/end after it.
    // A scoped subpath (rm -rf ~/Dev/old-build) deliberately does NOT match
    // here; it falls to the "ask" rule below.
    // Quotes are optional around the target: `rm -rf "$HOME"` is the single
    // most likely spelling of this command and the old rule missed it because
    // the quote broke the anchor.
    re: /\brm\b(?:\s+(?:-[a-zA-Z]*[rRf][a-zA-Z]*|--(?:recursive|force|dir)))+(?:\s+(?:-[a-zA-Z]+|--[a-z-]+))*\s+(['"]?)(?:\/|~\/?|\$\{?HOME\}?\/?)\1(?=\s|$|;|&|\||#)/,
    decision: 'deny',
    reason: 'Recursive delete against / or ~ itself: unconditionally blocked. Scope the path to a specific subdirectory and run it yourself if you truly mean it.',
  },
  {
    re: /\brm\b(?:\s+(?:-[a-zA-Z]*[rRf][a-zA-Z]*|--(?:recursive|force|dir)))+(?:\s+(?:-[a-zA-Z]+|--[a-z-]+))*\s+(['"]?)\*\1(?=\s|$|;|&|\||#)/,
    decision: 'deny',
    reason: 'Recursive delete against an unscoped glob (rm -rf *). Name the exact paths to remove instead of a bare wildcard.',
  },
  {
    // Recursive delete of a home-anchored subpath: real work sometimes, typo'd
    // disaster sometimes. Escalate to a human instead of blocking.
    re: /\brm\b(?:\s+(?:-[a-zA-Z]*[rRf][a-zA-Z]*|--(?:recursive|force|dir)))+(?:\s+(?:-[a-zA-Z]+|--[a-z-]+))*\s+['"]?(?:~\/|\$\{?HOME\}?\/)\S/,
    decision: 'ask',
    reason: 'Recursive delete inside the home directory. Confirm the path is right before it runs.',
  },
  {
    // --force and the branch can appear in either order, so match a git push
    // that contains a force flag AND names main/master anywhere in the command.
    // `-f` needs its own alternative that is not satisfied by the `-f` inside
    // `--force`, hence the explicit boundary.
    re: /\bgit\s+push\b(?=[^\n]*(?:--force(?:-with-lease)?\b|(?:^|\s)-[a-zA-Z]*f[a-zA-Z]*(?=\s|$)))(?=[^\n]*\b(?:main|master)\b)/i,
    decision: 'deny',
    reason: 'Force-push to main/master rewrites shared history. Push to a branch and open a PR, or use --force-with-lease on your own branch only.',
  },
  {
    // The `+` refspec is a force-push with no force flag anywhere in sight.
    // Same effect, different spelling, and the v2.15 rule did not see it.
    re: /\bgit\s+push\b[^\n]*\s\+(?:refs\/heads\/)?(?:main|master)\b/i,
    decision: 'deny',
    reason: 'A leading "+" on a refspec is a force-push. Pushing +main rewrites shared history exactly like --force does. Push to a branch and open a PR.',
  },
  {
    // Any fetcher into any interpreter. The v2.15 rule listed only sh/bash, so
    // `| zsh` and `| python3` (identical risk) sailed through.
    re: /\b(?:curl|wget|fetch|aria2c|httpie|http)\b[^\n]*\|\s*(?:sudo\s+|doas\s+|env\s+)*(?:ba|z|k|da|fi|c|t?c)?sh\b|\b(?:curl|wget|fetch|aria2c)\b[^\n]*\|\s*(?:sudo\s+|doas\s+|env\s+)*(?:python[0-9.]*|perl|ruby|node|deno|bun|php|lua|osascript)\b/i,
    decision: 'deny',
    reason: 'Piping a downloaded script straight into an interpreter runs unreviewed remote code. Download it to a file, read it, then run it.',
  },
  {
    // The sensitive word must be a full underscore-delimited segment of the
    // var name (MY_TOKEN, API_KEY_PROD yes; KEYBOARD_LAYOUT no).
    re: /\b(?:echo|printf)\b[^\n]*\$(?:\{)?(?:[A-Z0-9]+_)*(?:TOKEN|SECRET|KEY|PASSWORD|PASSWD|CREDENTIALS?)(?:_[A-Z0-9]+)*\b[^\n]*(?:>>?|\|\s*tee)\s*\S/i,
    decision: 'deny',
    reason: 'Writing an env secret into a file leaks it to disk (and often to git). Reference the variable at runtime instead of materializing it.',
  },
  {
    // Reversible, so not a deny: but it is almost never what you want.
    re: /\bchmod\s+(?:-[a-zA-Z]+\s+)*777\b/,
    decision: 'ask',
    reason: 'chmod 777 makes a path world-writable. Use the least permission that works (755 for dirs, 644 for files, 600 for secrets), or confirm to proceed.',
  },
]

function decide(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  }))
}

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => (input += chunk))
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input)
    // This starter set only guards Bash. Add tool-specific checks (Write/Edit
    // paths, MCP write payloads) as your surface grows.
    if (data.tool_name === 'Bash') {
      const command = (data.tool_input && data.tool_input.command) || ''
      for (const rule of RULES) {
        if (rule.re.test(command)) {
          decide(rule.decision, rule.reason)
          break
        }
      }
    }
  } catch {
    // JSON parse or match error: fail open (no output = allow).
  }
  process.exit(0)
})
