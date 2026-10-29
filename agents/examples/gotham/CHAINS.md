# Gotham Framework: Workflow Chains

Suggested dispatch sequences for common mission types. These are patterns, not rules: adapt to the situation.

## Common Chains

| Mission Type | Chain |
|---|---|
| **New Feature** | Barbara (research) > Robin/Nightwing (build) > Alfred (review + push) |
| **Bug Fix** | Red Robin (diagnose) > Robin (fix) > Alfred (review + push) |
| **Schema Change** | Lucius (design) > Nightwing (implement) > Alfred (review + push) |
| **Security Audit** | Red Hood (red-team) > Batgirl (scan) > Alfred (remediate + push) |
| **Performance Issue** | Red Robin (profile) > Robin (optimize) > Alfred (verify + push) |
| **Infrastructure** | Batwing (implement) > Signal (health check) > Alfred (review) |
| **Memory curation** | Huginn (gather) > Muninn (gate + tidy) |
| **Brain upkeep** | Gardener (feed proposals) > Mimir (clean + audit) |

## Notes

- Alfred is almost always the last link: quality gate before anything ships.
- Barbara front-loads research so builders don't waste cycles exploring.
- Red Robin and Red Hood serve different purposes: Red Robin diagnoses, Red Hood attacks.
- Nightwing over Robin when the feature requires architectural judgment.
- Signal is read-only: flags issues but doesn't fix them.
- Lucius designs systems; he doesn't implement them. Pair with a builder.
- Subagents without direct MCP binding reach the index via your system's authenticated shell helper.

## Maintenance

- Keep agent defs in sync with the dispatch doctrine here.
- The Voice Floor block in each agent should match your assistant's actual register. If you rewrite your assistant's voice (`soul/core.md`), propagate the tone changes to the Voice Floor blocks.
- Agents without a Voice Floor (mirror, muninn, oracle) are intentional: never auto-add it to those.
