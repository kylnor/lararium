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
  {
    // Bare root, bare home, or home with only whitespace/end after it.
    // A scoped subpath (rm -rf ~/Dev/old-build) deliberately does NOT match
    // here; it falls to the "ask" rule below.
    re: /\brm\s+(?:-[a-z]*\s+)*-[a-z]*[rf][a-z]*\s+(?:-[a-z]*\s+)*(?:\/|~\/?|\$HOME\/?)(?:\s|$)/i,
    decision: 'deny',
    reason: 'Recursive delete against / or ~ itself: unconditionally blocked. Scope the path to a specific subdirectory and run it yourself if you truly mean it.',
  },
  {
    re: /\brm\s+(?:-[a-z]*\s+)*-[a-z]*[rf][a-z]*\s+(?:-[a-z]*\s+)*\*(?:\s|$)/i,
    decision: 'deny',
    reason: 'Recursive delete against an unscoped glob (rm -rf *). Name the exact paths to remove instead of a bare wildcard.',
  },
  {
    // Recursive delete of a home-anchored subpath: real work sometimes, typo'd
    // disaster sometimes. Escalate to a human instead of blocking.
    re: /\brm\s+(?:-[a-z]*\s+)*-[a-z]*[rf][a-z]*\s+(?:-[a-z]*\s+)*(?:~\/|\$HOME\/)\S/i,
    decision: 'ask',
    reason: 'Recursive delete inside the home directory. Confirm the path is right before it runs.',
  },
  {
    // --force and the branch can appear in either order, so match a git push
    // that contains a force flag AND names main/master anywhere in the command.
    re: /\bgit\s+push\b(?=[^\n]*(?:--force|-f)\b)(?=[^\n]*\b(?:main|master)\b)/i,
    decision: 'deny',
    reason: 'Force-push to main/master rewrites shared history. Push to a branch and open a PR, or use --force-with-lease on your own branch only.',
  },
  {
    re: /\b(?:curl|wget)\b[^\n]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/i,
    decision: 'deny',
    reason: 'Piping a downloaded script straight into a shell runs unreviewed remote code. Download it to a file, read it, then run it.',
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
