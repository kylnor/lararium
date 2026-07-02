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
 *       "permissionDecision": "allow",
 *       "updatedInput": { ...original input, "model": "..." }
 *   } }
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
const MODEL_POLICY = {
  architect: 'opus',
  researcher: 'sonnet',
  reviewer: 'sonnet',
}

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => (input += chunk))
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input)
    if (data.tool_name === 'Agent') {
      const ti = data.tool_input || {}
      const target = MODEL_POLICY[ti.subagent_type]
      // Only inject when policy matches and the caller did not pin a model.
      if (target && !ti.model) {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
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
