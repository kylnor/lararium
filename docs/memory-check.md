# Check your memory

Start with one saved preference and prove that your assistant can retrieve and correct it.
This is a manual acceptance test, not background tracking. Nothing is sent to the template author.

## 1. Check the files

From the installed template folder, run:

```sh
node hooks/memory-check.mjs .
```

The check reads the standard brain files and optional soul file. It prints file status and
modification times, not contents. Exit 0 means the required files are readable and nonempty;
it does not mean the files are personalized, the assistant saves conversations, or hooks work.
Exit 1 means required files need attention. Exit 2 means the command needs a folder argument.
If you have deliberately moved your files, inspect their actual paths instead.

## 2. Save and read back

Ask your assistant:

> Create a temporary memory test file at brain/memory-check.md. Record this synthetic preference:
> "For this test, I prefer three-item summaries." Mark it as a user-provided test preference,
> include today's date, then read the file back from disk and show me what you saved.

Check that it actually wrote and read the file. A promise to save is not evidence of a write.
Keep this test separate from your real preferences.

## 3. Recall in a fresh conversation

Start a new conversation in the same folder. Do not paste the preference. Ask:

> Read brain/memory-check.md. What summary format did I ask for in that test? Name the source file.

Pass: it retrieves three-item summaries from the file. If it cannot, check the working folder,
file access, and actual file location. This verifies explicit retrieval, not automatic loading.

## 4. Correct and recall again

In that conversation, say:

> Update the test preference to one-paragraph summaries. Mark the old preference as superseded,
> keep it in a clearly labeled history section, and read back the current preference from disk.

Start another fresh conversation and ask the question from step 3 again.
Pass: it identifies one-paragraph summaries as current and does not blend the old and new answers.

## 5. Check uncertainty

Ask what font you selected for this test. No font was specified.
Pass: it says the test file does not establish a font preference. It must not invent one.

## 6. Test automatic loading separately

The template ships its startup and session-end hooks switched on for conversations opened in
the installed folder (`.claude/settings.json`). Repeat a fresh-session question about a harmless fact in the actual
configured briefing files without naming the file. Inspect the hook output as well as the answer.
The reference startup hook reads a small set of files; it does not search every card. A fact in
another file will still need retrieval. Hook installation is specific to your assistant.

For session-end capture, verify that the expected output file changed after a real
session ended and inspect its contents. The reference heartbeat keeps a short mechanical tail;
it is not a complete transcript archive or a verified list of facts. Keep user statements separate
from assistant suggestions when turning that tail into durable notes.

## Automatic loop acceptance test

Use a disposable installation, opened in Claude Code from inside its folder and trusted when
asked. Its shipped `.claude/settings.json` already registers the memory SessionStart and
SessionEnd hooks. Use synthetic information. These instructions are for Claude Code; other assistants need their own
verified lifecycle integration.

1. Start a session and state a harmless project choice, such as selecting a terracotta pot for basil.
2. Wait for a completed response, then exit normally. Verify `soul/heartbeat.md` exists below
   the installed folder and contains that exchange with separate user and assistant labels.
3. Start a genuinely new session, not a resumed one. Ask which pot was selected without naming
   a file or repeating the choice. Verify the startup hook injected the heartbeat.
4. Correct the choice, exit normally, and repeat the fresh-session question.
5. Move or rename the folder, open it again, and repeat the fresh-session question. It must still
   answer: the hooks find the folder from their own location.
6. Record failure honestly if hooks do not fire. A manually executed hook is a component test,
   not proof of lifecycle wiring. Missing transcripts should preserve the previous heartbeat.

The file check reports whether `.claude/settings.json` registers both memory hooks. If you wired
the hooks globally with `LARARIUM_ROOT` instead, set the same variable in the shell that runs the
check; a mismatching root is reported as needing attention.

## Finish

Remove only the temporary brain/memory-check.md file you created for this test. Record which checks
passed, failed, or were skipped. Do not report automatic memory as working when only explicit
file retrieval was tested. Repeat after moving files or changing your assistant's configuration.
