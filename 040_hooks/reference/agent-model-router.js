#!/usr/bin/env node
/**
 * PreToolUse hook (reference implementation): the dispatch router.
 *
 * Fires before a subagent dispatch (the Agent tool). It rewrites the dispatch
 * parameters by policy: certain agents should always run on a certain model, and
 * nobody should have to remember that. This hook fills the gap.
 *
 * It reads the policy map below, and if the dispatched agent has an entry AND the
 * caller did not already pin a model, it re-emits the tool input with the policy
 * model injected. An explicit model on the dispatch call always wins.
 *
 * Output contract: to rewrite the call, print:
 *   { "hookSpecificOutput": {
 *       "hookEventName": "PreToolUse",
 *       "updatedInput": { ...original input, "model": "..." }
 *   } }
 *
 * Note the absence of "permissionDecision". Routing is not authorization: an
 * "allow" here would bypass the permission system for every dispatch this hook
 * touches, which is a much larger claim than "use opus for the architect".
 * To leave the call untouched, print nothing. Fail-soft: any error means no
 * output and the dispatch proceeds exactly as written. Always exit 0.
 *
 * stdin payload: { "tool_name": "Agent", "tool_input": { "subagent_type": "...", ... } }
 *
 * Test standalone:
 *   echo '{"tool_name":"Agent","tool_input":{"subagent_type":"architect","prompt":"x"}}' | node agent-model-router.js
 */
'use strict'

// agent name -> model it should run on. Rename to match your own roster.
//
// Null-prototype on purpose. A plain object literal inherits from
// Object.prototype, so MODEL_POLICY['constructor'] returns a function, which is
// truthy, which meant a subagent named `constructor` or `toString` matched the
// policy and got the rewrite path (and, before the fix below, an auto-approve).
const MODEL_POLICY = Object.assign(Object.create(null), {
  architect: 'opus',
  researcher: 'sonnet',
  reviewer: 'sonnet',
})

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => (input += chunk))
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input)
    if (data.tool_name === 'Agent') {
      const ti = data.tool_input || {}
      const target = typeof ti.subagent_type === 'string'
        ? MODEL_POLICY[ti.subagent_type]
        : undefined
      // Only inject when policy matches and the caller did not pin a model.
      if (typeof target === 'string' && !ti.model) {
        // NOTE: no permissionDecision here, deliberately.
        //
        // This hook used to emit `permissionDecision: "allow"` alongside the
        // rewrite. That is not a no-op: "allow" bypasses the permission system
        // for the call, so a hook whose stated job is "pick a model" was also
        // silently auto-approving every dispatch it touched. Routing is not
        // authorization. Emitting only `updatedInput` applies the model and
        // leaves the normal permission flow exactly where it was.
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            updatedInput: { ...ti, model: target },
          },
        }))
      }
    }
  } catch {
    // Never block a dispatch over a router bug.
  }
  process.exit(0)
})
