// Drive only the hook's JSON protocol. Command fixtures are never executed by a shell.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const dir = path.dirname(fileURLToPath(import.meta.url));
const guard = process.env.BASH_DENY_GUARD_PATH || path.join(dir, 'reference/bash-deny-guard.py');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-deny-guard-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
let serial = 0;
async function run(command, denies = ['Bash(rm:*)'], extra = {}, harness = null) {
  const settings = path.join(root, `settings-${serial++}.json`);
  fs.writeFileSync(settings, JSON.stringify({ permissions: { deny: denies } }));
  const env = { ...process.env, CLAUDE_SETTINGS_PATH: settings, PYTHONDONTWRITEBYTECODE: '1', ...extra };
  delete env.CLAUDE_PROJECT_DIR;
  const started = performance.now();
  const output = await new Promise((resolve, reject) => {
    const child = spawn('python3', harness ? ['-c', harness, guard] : [guard], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('hook exceeded 5 seconds')); }, 5000);
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', status => { clearTimeout(timeout); resolve({ status, stdout, stderr }); });
    child.stdin.on('error', reject);
    child.stdin.end(JSON.stringify({ tool_name: 'Bash', tool_input: { command } }));
  });
  const elapsed = performance.now() - started;
  assert.equal(output.status, 0, output.stderr);
  assert.equal(output.stderr, '');
  const result = output.stdout.trim() ? JSON.parse(output.stdout).hookSpecificOutput : undefined;
  assert.ok(result === undefined || result.permissionDecision === 'deny', 'only deny or silence');
  if (result) assert.equal(result.hookEventName, 'PreToolUse');
  return { decision: result?.permissionDecision, reason: result?.permissionDecisionReason, elapsed };
}

const D = 'rm -rf /important';
const already = [
  D,
  `cat <<EOF\nx\nEOF\n${D}`,
  `cat <(${D})`,
  `echo "$(${D})"`,
  `if true; then ${D}; fi`,
  `diff <(${D}) b`,
  `ls\n${D}`,
  `ls &\n${D}`,
  `cat <<-EOF\n\tx\n\tEOF\n${D}`,
];
const mustDeny = [
  `grep "a<<b" notes.txt\n${D}`,
  `python3 -c "print(1 << 2)"\n${D}`,
  `/bin/${D}`,
  `ls # don't\n${D}`,
  `echo $((1<<2))\n${D}`,
  `echo a <<<b\n${D}`,
  `"rm" -rf /important`,
  `'rm' -rf /important`,
  `r\\m -rf /important`,
  `(${D})`,
  `{ ${D}; }`,
  `! ${D}`,
  `ls & ${D}`,
  `ls |& ${D}`,
  `time ${D}`,
  `sudo -u root ${D}`,
  `env -i A=1 ${D}`,
  `timeout -s KILL 5 ${D}`,
  `bash -c "${D}"`,
  `eval "${D}"`,
  'echo x | xargs rm -rf',
  'find . -name x -exec rm -rf {} +',
  ...['\\rm', 'command rm', 'nohup rm', 'nice -n 5 rm', 'busybox rm',
    '/usr/bin/env rm', 'doas rm', 'sudo rm', 'env FOO=1 rm', 'timeout 5 rm', 'sudo -E rm']
    .map(head => `${head} -rf /important`),
  `if ${D}; then :; fi`,
  `while ${D}; do :; done`,
  `bash -lc "${D}"`,
  `env -S "${D}"`,
  `cat <<EOF\n$(${D})\nEOF`,
  `bash <<EOF\n${D}\nEOF`,
  `bash <<< "${D}"`,
  `sh -c 'ls; ${D}'`,
  `echo "unterminated\n${D}`,
];
for (const command of already) test(`deny (already): ${JSON.stringify(command)}`, async () => {
  assert.equal((await run(command)).decision, 'deny');
});
for (const command of mustDeny) test(`deny (new): ${JSON.stringify(command)}`, async () => {
  assert.equal((await run(command)).decision, 'deny');
});

const silent = [
  `cat <<EOF\n${D}\nEOF`,
  `cat <<'EOF'\n$(${D})\nEOF`,
  "cat <<EOF\nit's fine\nEOF\nls",
  'git commit -m "$(cat <<\'EOF\'\ndon\'t break\nEOF\n)"',
  'python3 -c "print(1 << 2)"',
  'python3 -c "print(1 << 2)"\nls',
  'grep "a<<b" notes.txt',
  'grep "a<<b" notes.txt\nls -la',
  'echo $((1<<2))',
  "echo $'it\\'s'",
  `ls # ${D}`,
  'git rm --cached f',
  'timeout 5 git rm --cached f',
  'sudo -E git rm --cached f',
  'command -v rm',
  'cat <<EOF | sh\nls\nEOF',
  `echo ${D}`,
  'grep rm notes.txt',
  'echo hi > /tmp/rm',
  'curl http://example.com/#x',
  'python3 script.py',
  'npm run build',
  'ls -la',
];
for (const command of silent) test(`silent: ${JSON.stringify(command)}`, async () => {
  assert.equal((await run(command)).decision, undefined);
});

const additionalDenies = [
  `./${D}`, `../x/${D}`, `r"m" -rf /important`, `r$'\\155' -rf /important`,
  `exec -a alias ${D}`, `builtin ${D}`, `ionice -c 3 ${D}`, `stdbuf -oL ${D}`,
  `setsid --wait ${D}`, `env -u NAME ${D}`, `xargs -I {} ${D}`,
  `sudo --user=root ${D}`, `sudo --unknown rm`, `sudo --unknown value ${D}`,
  `timeout --signal=KILL 5 ${D}`, `env -S 'timeout 5 rm -rf /important'`,
  `env --split-string='${D}'`, `env -Srm -rf /important`,
  `command -- /bin/${D}`, `nohup env A=1 timeout 5 ${D}`,
  `until ${D}; do :; done`, `if true; then :; elif ${D}; then :; else ${D}; fi`,
  `for f in "$(${D})"; do :; done`, `case "$(${D})" in x) :;; esac`,
  `select f in "$(${D})"; do :; done`,
  `cat >(${D})`, `echo "\`${D}\`"`, `echo "$(echo "$(${D})")"`,
  `cat <<EOF1 <<EOF2\na\nEOF1\nb\nEOF2\n${D}`,
  `cat <<'EOF1' <<EOF2\n${D}\nEOF1\n$(${D})\nEOF2`,
  `cat <<EOF\n\`${D}\`\nEOF`,
  `bash <<'EOF'\n${D}\nEOF`, `bash <<-EOF\n\t${D}\n\tEOF`,
  `git commit -m "$(cat <<'EOF'\nquoted\nEOF\n${D}\n)"`,
  `find . -execdir /bin/rm -rf {} \\;`, `find . -ok rm {} +`, `find . -okdir rm {} +`,
  `sh -c 'echo ok' && ${D}`, `eval 'echo ok;' '${D}'`,
  `echo $(unterminated\n${D}`, `echo \`unterminated\n${D}`,
  `cat <(unterminated\n${D}`, `cat >(unterminated\n${D}`,
  `echo "x\nls; ${D}`, `echo foo\\\nbar\n${D}`, `r\\\nm -rf /important`,
  `echo "$(case x in x) ${D};; esac)"`,
  `echo "$(case x in x) case y in y) ${D};; esac;; esac)"`,
  `ls; /bin/${D}`, `echo > # comment\n${D}`, `cat << # comment\n${D}`,
  `bash -O extglob -lc '${D}'`, `eval -- '${D}'`, `env -S '-u NAME ${D}'`,
];
for (const command of additionalDenies) test(`deny (extended): ${JSON.stringify(command)}`, async () => {
  assert.equal((await run(command)).decision, 'deny');
});
const additionalSilent = [
  'command -V rm', 'command -pv rm',
  "echo '$(rm -rf /important)'", "echo '\\rm'",
  `echo "${D}"`, 'echo a#b', `echo rm\\; ls`,
  `cat <<'EOF'\n\`${D}\`\nEOF`,
  `cat <<\\EOF\n$(${D})\nEOF`,
  `cat <<EOF\n\\$(${D})\nEOF`,
  `cat <<EOF1 <<EOF2\n${D}\nEOF1\n${D}\nEOF2`,
  `cat <<EOF | sh\n${D}\nEOF`, `cat <<< '${D}' | sh`,
  `python3 -c '${D}'`, `node -e '${D}'`,
  `for f in rm; do echo "$f"; done`, `select f in rm; do :; done`,
  'case x in rm) echo ok;; rm) echo ok;; esac',
  'sudo -u rm git status', 'env -u rm git status', 'xargs -I rm git status',
  'timeout -s rm 5 git status', 'stdbuf -o rm git status',
  `echo $((1 << 2)) # ${D}`, 'echo "`echo ok`"',
  'bash -c "echo ok" rm', 'find . -name rm -print',
  'echo { rm -rf /important', 'echo } rm -rf /important',
  'echo "$(case x in rm) echo ok;; rm|x) echo ok;; esac)"',
  `echo > # $(${D})`,
];
for (const command of additionalSilent) test(`silent (extended): ${JSON.stringify(command)}`, async () => {
  assert.equal((await run(command)).decision, undefined);
});

for (const [name, command, expected, reason] of [
  ['arithmetic command shift cannot open a phantom heredoc', `(( x = 1 << 2 ))\n${D}`, 'deny'],
  ['parameter default cannot open a phantom heredoc', `echo ${'${x:-<<EOF}'}\n${D}`, 'deny'],
  ['parameter trimming cannot open a phantom heredoc', `echo ${'${x#<<}'}\n${D}`, 'deny'],
  ['legacy arithmetic shift cannot open a phantom heredoc', `echo $[1<<2]\n${D}`, 'deny'],
  ['arithmetic for header shift cannot open a phantom heredoc', `for ((i=0;i<<2;i++)); do :; done\n${D}`, 'deny'],
  ['function keyword body is checked', `function f { ${D}; }`, 'deny'],
  ['function keyword with parentheses body is checked', `function f() { ${D}; }`, 'deny'],
  ['coproc simple command is checked', `coproc ${D}`, 'deny'],
  ['named coproc group body is checked', `coproc NAME { ${D}; }`, 'deny'],
  ['array initializer words are data', `files=(${D})`, undefined],
  ['array append initializer words are data', `files+=(${D})`, undefined],
  ['array initializer command substitution is checked', `files=($(${D}))`, 'deny'],
  ['array initializer ends at its matching parenthesis', `files=(a b)\n${D}`, 'deny'],
  ['parameter default word is data', 'echo ${x:-rm}', undefined],
  ['multiple arithmetic expansions with shifts are data', 'echo $((1<<2)) $((3<<4))', undefined],
  ['quoted awk shift is data', "awk '{print $1 << 2}' f", undefined],
  ['for header words are data', 'for f in rm a; do echo $f; done', undefined],
  ['case subject and pattern are data', 'case rm in rm) echo x;; esac', undefined],
  ['sudo user value is data', 'sudo -u rm ls', undefined],
  ['xargs replacement value and echo argument are data', 'xargs -I rm echo rm', undefined],
  ['npm rm argument is data', 'npm rm lodash', undefined],
  ['python stdin heredoc body is data', 'python3 - <<EOF\nimport os\nprint("rm -rf /important")\nEOF', undefined],
  ['let shift opens a never-closed heredoc with delimiter 2', `let x=1<<2\n${D}`, 'deny', /heredoc.*2/i],
  ['case arm body is checked', `case x in x) ${D};; esac`, 'deny'],
  ['parameter default command substitution is checked', `echo ${'${x:-$('}${D})}`, 'deny'],
  ['bash stdin flag heredoc is checked', `bash -s <<EOF\n${D}\nEOF`, 'deny'],
  ['sudo shell heredoc is checked', `sudo bash <<EOF\n${D}\nEOF`, 'deny'],
  ['find exec shell command string is checked', `find . -exec sh -c "${D}" \\;`, 'deny'],
  ['CRLF separates commands', `ls\r\n${D}`, 'deny'],
  ['sudo xargs after a pipeline is checked', 'echo x | sudo xargs rm -rf', 'deny'],
  ['nested shell command strings are checked', `bash -c "bash -c '${D}'"`, 'deny'],
]) test(`round 1: ${name}`, async () => {
  const result = await run(command);
  assert.equal(result.decision, expected);
  if (reason) assert.match(result.reason, reason);
});

for (const [name, command, expected, reason] of [
  ['probe 3 row 1: arithmetic expansion substitution is checked', `echo $(( $(${D}) + 1 ))`, 'deny'],
  ['probe 3 row 2: shell option terminator precedes command string', `bash -c -- '${D}'`, 'deny'],
  ['probe 3 row 3: leading continuation and indentation create no word', `\\\n  ${D}`, 'deny'],
  ['probe 3 row 4: wrapper continuation and indentation create no word', `sudo \\\n  ${D}`, 'deny'],
  ['probe 3 row 5: delimiter continuation does not quote heredoc', `cat <<EO\\\nF\n$(${D})\nEOF`, 'deny'],
  ['probe 3 row 6: carriage return before hash is part of a word', `echo \r#x; ${D}`, 'deny'],
  ['probe 3 row 7: esac subject and pattern do not close case', `echo "$(case esac in esac) ${D};; esac)"`, 'deny'],
  ['probe 3 row 8: esac argument does not expose later pattern', 'case x in x) echo esac;; rm) echo ok;; esac', undefined],
  ['probe 3 row 9: ANSI octal NUL truncates quoted piece', "$'rm\\0ignored' -rf /important", 'deny'],
  ['probe 3 row 10: conditional extglob parentheses are data', '[[ rm == @(rm) ]]', undefined],
  ['probe 3 row 11: conditional command substitution is checked', `[[ -n $(${D}) ]]`, 'deny'],
  ['probe 3 row 12: conditional OR exposes following command', `[[ a == b ]] || ${D}`, 'deny'],
  ['probe 3 row 13: continued ordinary argument stays data', 'ls \\\n  -la', undefined],
  ['probe 3 row 14: separator after continued argument exposes command', `ls \\\n  -la; ${D}`, 'deny'],
  ['arithmetic expansion backticks are checked', `echo $(( \`${D}\` + 1 ))`, 'deny'],
  ['quoted arithmetic expansion substitution is checked', `echo "$(( $(${D}) + 1 ))"`, 'deny'],
  ['arithmetic command substitution is checked', `(( x = $(${D}) + 1 ))`, 'deny'],
  ['arithmetic command backticks are checked', `(( x = \`${D}\` + 1 ))`, 'deny'],
  ['arithmetic for substitution is checked', `for ((i=$(${D});i<3;i++)); do :; done`, 'deny'],
  ['arithmetic for backticks are checked', `for ((i=0;i<\`${D}\`;i++)); do :; done`, 'deny'],
  ['legacy arithmetic substitution is checked', `echo $[$(${D}) + 1]`, 'deny'],
  ['legacy arithmetic backticks are checked', `echo $[\`${D}\` + 1]`, 'deny'],
  ['heredoc arithmetic substitution is checked', `cat <<EOF\n$(( $(${D}) + 1 ))\nEOF`, 'deny'],
  ['arithmetic groups and shifts remain data', 'echo $(( (1 << 2) + (3 >> 1) ))', undefined],
  ['shell grouped flags then terminator precede command string', `bash -lc -- '${D}'`, 'deny'],
  ['shell flag after c precedes command string', `bash -c -e '${D}'`, 'deny'],
  ['shell value option after c precedes command string', `bash -c -O extglob -- '${D}'`, 'deny'],
  ['shell grouped c and value option precede command string', `bash -ecO extglob -- '${D}'`, 'deny'],
  ['shell terminator without c leaves script argument as data', `bash -- '${D}'`, undefined],
  ['shell command string ends before positional arguments', `bash -c -- 'echo ok' '${D}'`, undefined],
  ['multiple leading continuations and tabs create no word', `\\\n\t\\\n  ${D}`, 'deny'],
  ['nested wrapper continuation creates no word', `sudo \\\n\tenv \\\n  ${D}`, 'deny'],
  ['continuation before heredoc delimiter creates no operand', `cat <<\\\n  EOF\n$(${D})\nEOF`, 'deny'],
  ['continued delimiter still expands backticks', `cat <<E\\\nOF\n\`${D}\`\nEOF`, 'deny'],
  ['quoted continued delimiter still suppresses expansion', `cat <<"EO\\\nF"\n$(${D})\nEOF`, undefined],
  ['explicit empty command word remains a word', `"" \\\n  ${D}`, undefined],
  ['explicit empty wrapper command word remains a word', `sudo \\\n  "" ${D}`, undefined],
  ['explicit empty word joined to command name is retained', `""r\\\nm -rf /important`, 'deny'],
  ['continuation before comment preserves word boundary', `\\\n  # ${D}\nls`, undefined],
  ['tab then carriage return before hash is part of a word', `echo\t\r#x && ${D}`, 'deny'],
  ['carriage return inside argument does not start comment', `echo a\r#x; ${D}`, 'deny'],
  ['carriage return followed by newline still separates commands', `ls\r\n${D}`, 'deny'],
  ['carriage return suffix is denied', 'rm\r -rf /important', 'deny', /carriage return/i],
  ['carriage return prefix is denied', '\rrm -rf /important', 'deny', /carriage return/i],
  ['vertical tab before hash is part of a word', `echo \v#x; ${D}`, 'deny'],
  ['in subject and pattern remain data', `echo "$(case in in in) ${D};; esac)"`, 'deny'],
  ['case subject and pattern remain data', `echo "$(case case in case) ${D};; esac)"`, 'deny'],
  ['esac argument leaves following case body checked', `echo "$(case x in x) echo esac; ${D};; esac)"`, 'deny'],
  ['in and case arguments leave later patterns as data', 'case x in x) echo in case;; rm) echo ok;; esac', undefined],
  ['multiline case patterns are data', 'case x in\nrm\n) echo ok;;\nesac', undefined],
  ['quoted esac pattern leaves body checked', `echo "$(case x in 'esac') ${D};; esac)"`, 'deny'],
  ['esac alternative after an arm does not expose rm pattern', 'echo "$(case x in x) :;; esac|rm) echo ok;; esac)"', undefined],
  ['esac alternative after an arm leaves body checked', `echo "$(case x in x) :;; esac|y) ${D};; esac)"`, 'deny'],
  ['esac after a pattern alternative does not close case', `echo "$(case x in x) :;; y|esac) ${D};; esac)"`, 'deny'],
  ['empty case closes before following command', `case x in esac; ${D}`, 'deny'],
  ['conditional spelling in case pattern is data', 'case x in [[ ) echo ok;; rm) echo ok;; esac', undefined],
  ['ANSI hex NUL truncates quoted piece', "$'rm\\x00ignored' -rf /important", 'deny'],
  ['ANSI Unicode NUL truncates quoted piece', "$'rm\\u0000ignored' -rf /important", 'deny'],
  ['ANSI long Unicode NUL truncates quoted piece', "$'rm\\U00000000ignored' -rf /important", 'deny'],
  ['ANSI octal byte overflow to NUL truncates piece', "$'rm\\400ignored' -rf /important", 'deny'],
  ['ANSI NUL preserves following word piece', "r$'\\0ignored'm -rf /important", 'deny'],
  ['ANSI NUL resets at next quoted piece', "$'r\\0ignored'$'m' -rf /important", 'deny'],
  ['ANSI NUL does not discard following suffix', "$'rm\\0ignored'other -rf /important", undefined],
  ['ANSI NUL still consumes escaped quote', "$'rm\\0ignored\\'still ignored' -rf /important", 'deny'],
  ['conditional negated extglob parentheses are data', '[[ rm == !(rm|ls) ]]', undefined],
  ['conditional logical groups are data', '[[ ( rm == rm ) && ( rm != ls ) ]]', undefined],
  ['conditional backticks are checked', `[[ -n \`${D}\` ]]`, 'deny'],
  ['conditional pattern substitution is checked', `[[ x == @($(${D})) ]]`, 'deny'],
  ['conditional quoted substitutions are checked', `[[ -n "$(${D})" ]]`, 'deny'],
  ['conditional AND exposes following command', `[[ a == a ]] && ${D}`, 'deny'],
  ['conditional semicolon exposes following command', `[[ a == b ]]; ${D}`, 'deny'],
  ['conditional newline exposes following command', `[[ a == b ]]\n${D}`, 'deny'],
  ['conditional closer inside quotes is data', '[[ "]]" == @(rm) ]]', undefined],
  ['conditional single quotes suppress substitutions', `[[ '$(${D})' == @(rm) ]]`, undefined],
]) test(`round 2: ${name}`, async () => {
  const result = await run(command);
  assert.equal(result.decision, expected);
  if (reason) assert.match(result.reason, reason);
});

for (const [name, command, expected, reason] of [
  ['probe 4 row 1: conditional comment quotes cannot hide following command', `[[ -n x # '\n]]; ${D}\n# '\necho ]]`, 'deny'],
  ['probe 4 row 2: apostrophe in conditional comment is data', "[[ -n x # don't delete\n]] && echo ok", undefined],
  ['probe 4 row 3: conditional comment ends at newline before logical operator', '[[ -n x # plain comment\n&& -n y ]] && echo ok', undefined],
  ['probe 4 row 4: conditional comment leaves following command checked', `[[ -n x # c\n]] && ${D}`, 'deny'],
  ['probe 4 row 5: hash inside conditional word is literal', '[[ $x == a#b ]] && echo ok', undefined],
  ['probe 4 row 6: literal opening brace in parameter prefix pattern is data', 'echo "${value#*{}"', undefined],
  ['probe 4 row 7: escaped closing brace in parameter suffix pattern is data', 'echo ${value%\\}*}', undefined],
  ['probe 4 row 8: literal opening brace in parameter replacement pattern is data', 'echo "${value//{/[}"', undefined],
  ['probe 4 row 9: literal parameter brace leaves following command checked', 'echo "${value#*{}"; ' + D, 'deny'],
  ['probe 4 row 10: parameter default substitution is checked', 'echo ${x:-$(' + D + ')}', 'deny'],
  ['probe 4 row 11: nested parameter defaults close independently', 'echo "${x:-${y:-z}}"', undefined],
  ['probe 4 row 12: open parameter expansion in unquoted heredoc is denied', 'cat <<EOF\n${x:-oops\nEOF', 'deny', /parameter expansion/i],
  ['probe 4 row 13: quoted heredoc leaves open parameter text literal', "cat <<'EOF'\n${x:-oops\nEOF", undefined],
  ['probe 4 row 14: heredoc expands closed parameters and preserves escaped opener', 'cat <<EOF\n${x:-fine} and $y and \\${literal\nEOF', undefined],
  ['probe 4 row 15: heredoc parameter default substitution is checked', 'cat <<EOF\n${x:-$(' + D + ')}\nEOF', 'deny'],
  ['probe 4 row 16: lone dollar and brace in heredoc are literal', 'cat <<EOF\nprice is $5 {not an expansion\nEOF', undefined],
]) test(`round 4: ${name}`, async () => {
  const result = await run(command);
  assert.equal(result.decision, expected);
  if (reason) assert.match(result.reason, reason);
});

// These rows were checked against real bash. They are synthetic data, passed only to the hook JSON protocol.
for (const [name, command, expected] of [
  ["probe 8 row 1: regex hash cannot hide trailing command", "[[ x =~ (#) ]]; " + D + "\necho ]]", 'deny'],
  ["probe 8 row 2: closed regex hash group stays silent", "[[ x =~ (#) ]]", undefined],
  ["probe 8 row 3: regex hash leaves fallback command checked", "[[ x =~ (#) ]] || " + D + "", 'deny'],
  ["probe 8 row 4: attached regex group preserves hash alternative", "[[ x =~ a(#|b) ]]; " + D + "", 'deny'],
  ["probe 8 row 5: anchored regex preserves hash alternative", "[[ x =~ ^(a|#b)$ ]] || " + D + "", 'deny'],
  ["probe 8 row 6: regex group preserves blanks", "[[ x =~ (a b) ]] || " + D + "", 'deny'],
  ["probe 8 row 7: regex group preserves blank-separated hash", "[[ x =~ (a # b) ]] || " + D + "", 'deny'],
  ["probe 8 row 8: nested regex groups preserve hash", "[[ x =~ ((#)) ]] || " + D + "", 'deny'],
  ["probe 8 row 9: regex bracket word preserves hash", "[[ x =~ [#] ]] || " + D + "", 'deny'],
  ["probe 8 row 11: embedded regex hash stays literal", "[[ x =~ a#b ]] || " + D + "", 'deny'],
  ["probe 8 row 12: comment after regex group ignores apostrophe", "[[ x =~ (a) # c'omment\n]] || " + D + "", 'deny'],
  ["probe 8 row 13: comment after conditional ignores apostrophe", "[[ x =~ (a) ]] # c'omment\n" + D + "", 'deny'],
  ["probe 8 row 14: conditional grouping leaves following command checked", "[[ ( -n x ) ]] && " + D + "", 'deny'],
  ["probe 8 row 15: comment after conditional group ignores apostrophe", "[[ ( -n x ) # don't\n]] && " + D + "", 'deny'],
  ["probe 8 row 16: hash at conditional group boundary starts comment", "[[ (# don't\n-n x ) ]] && " + D + "", 'deny'],
  ["probe 8 row 17: unary tests and logical groups leave command checked", "[[ -n x && ( -z y || -n z ) ]] && " + D + "", 'deny'],
  ["probe 8 row 20: escaped opening parenthesis does not open regex group", "[[ x =~ \\(# ]] || " + D + "", 'deny'],
  ["probe 8 row 21: trailing conditional comment cannot hide next command", "[[ x =~ (#) ]] && echo no\n# trailing don't\n" + D + "", 'deny'],
  ["probe 8 row 22: regex operand command substitution is checked", "[[ x =~ $(" + D + ") ]]", 'deny'],
  ["probe 8 row 23: regex group command substitution is checked", "[[ x =~ ($(" + D + ")) ]]", 'deny'],
  ["probe 8 row 24: heredoc parameter single quote cannot hide substitution", "cat <<EOF\n${x:-'$(" + D + ")'}\nEOF", 'deny'],
  ["probe 8 row 25: heredoc parameter double quote expands substitution", "cat <<EOF\n${x:-\"$(" + D + ")\"}\nEOF", 'deny'],
  ["probe 8 row 26: heredoc parameter single quote cannot hide backtick", "cat <<EOF\n${x:-'`" + D + "`'}\nEOF", 'deny'],
  ["probe 8 row 27: open parameter quote fails closed before following command", "cat <<EOF\n${x:-'}\nEOF\n" + D + "", 'deny'],
  ["probe 8 row 30: open parameter double quote fails closed", "cat <<EOF\n${x:-\"}\nEOF\n" + D + "", 'deny'],
  ["probe 8 row 31: parameter quoted closing brace preserves boundary", "cat <<EOF\n${x:-'a}b'}\nEOF\n" + D + "", 'deny'],
  ["probe 8 row 32: parameter escaped closing brace preserves boundary", "cat <<EOF\n${x:-\\}}\nEOF\n" + D + "", 'deny'],
  ["probe 8 row 33: parameter ANSI quote preserves following command", "cat <<EOF\n${x:-$'a'}\nEOF\n" + D + "", 'deny'],
  ["probe 8 row 34: nested heredoc parameter quotes cannot hide substitution", "cat <<EOF\n${x:-${y:-'$(" + D + ")'}}\nEOF", 'deny'],
  ["probe 8 row 35: quoted heredoc parameter text stays inert", "cat <<'EOF'\n${x:-'$(" + D + ")'}\nEOF", undefined],
  ["probe 8 row 36: ordinary heredoc apostrophes do not quote substitution", "cat <<EOF\n'$(" + D + ")'\nEOF", 'deny'],
  ["probe 8 row 37: nested command plain single quotes stay inert", "cat <<EOF\n$(echo '$(" + D + ")')\nEOF", undefined],
  ["probe 8 row 38: nested command parameter quotes cannot hide substitution", "cat <<EOF\n$(echo ${x:-'$(" + D + ")'})\nEOF", 'deny'],
  ["probe 8 row 39: unquoted parameter default conservatively scans single quotes", "echo ${x:-'$(" + D + ")'}", 'deny'],
  ["probe 8 row 40: double-quoted parameter default scans single quotes", "echo \"${x:-'$(" + D + ")'}\"", 'deny'],
  ["probe 8 row 41: heredoc arithmetic parameter leaves following command checked", "cat <<EOF\n$((1 + ${x:-'2'}))\nEOF\n" + D + "", 'deny'],
  ["probe 8 row 42: here-string parameter scans single quotes", "cat <<< \"${x:-'$(" + D + ")'}\"", 'deny'],
  ["probe 8 row 45: parameter prefix pattern conservatively scans single quotes", "echo \"${x#'$(" + D + ")'}\"", 'deny'],
  ["probe 8 row 46: parameter suffix pattern conservatively scans single quotes", "echo \"${x%'$(" + D + ")'}\"", 'deny'],
  ["probe 8 row 47: parameter replacement pattern conservatively scans single quotes", "echo \"${x/'$(" + D + ")'/b}\"", 'deny'],
  ["probe 8 row 48: parameter replacement text scans single quotes", "echo \"${x/a/'$(" + D + ")'}\"", 'deny'],
  ["probe 8 row 49: parameter case pattern conservatively scans single quotes", "echo \"${x^^'$(" + D + ")'}\"", 'deny'],
  ["probe 8 row 50: parameter alternate value scans single quotes", "echo \"${x:+'$(" + D + ")'}\"", 'deny'],
  ["probe 8 row 51: set parameter alternate value scans single quotes", "x=1; echo \"${x:+'$(" + D + ")'}\"", 'deny'],
  ["probe 8 row 52: parameter assignment value scans single quotes", "echo \"${x:='$(" + D + ")'}\"", 'deny'],
  ["probe 8 row 53: parameter offset scans single quotes", "echo \"${x:'$(" + D + ")'}\"", 'deny'],
  ["probe 8 row 54: heredoc parameter prefix pattern scans single quotes", "cat <<EOF\n${x#'$(" + D + ")'}\nEOF", 'deny'],
  ["probe 8 row 55: heredoc parameter replacement pattern scans single quotes", "cat <<EOF\n${x/'$(" + D + ")'/b}\nEOF", 'deny'],
  ["probe 8 row 56: arithmetic parameter default scans single quotes", "echo $(( ${x:-'$(" + D + "; echo 1)'} + 1 ))", 'deny'],
  ["probe 8 row 57: arithmetic expansion scans single quotes", "echo $(( 1 + '$(" + D + "; echo 1)' ))", 'deny'],
  ["probe 8 row 58: arithmetic command parameter default scans single quotes", "(( y = ${x:-'$(" + D + "; echo 1)'} ))", 'deny'],
  ["probe 8 row 59: array element parameter default scans single quotes", "a=( ${x:-'$(" + D + ")'} )", 'deny'],
  ["probe 8 row 60: double-quoted array element parameter scans single quotes", "a=( \"${x:-'$(" + D + ")'}\" )", 'deny'],
  ["probe 8 row 61: nested double-quoted parameter scans single quotes", "echo ${x:-\"${y:-'$(" + D + ")'}\"}", 'deny'],
  ["probe 8 row 62: nested command parameter default scans single quotes", "echo \"${x:-$(echo ${y:-'$(" + D + ")'})}\"", 'deny'],
  ["probe 8 row 64: split single quotes in parameter cannot hide substitution", "echo \"${x:-'a'$(" + D + ")'b'}\"", 'deny'],
  ["probe 8 row 65: unquoted here-string parameter scans single quotes", "cat <<< ${x:-'$(" + D + ")'}", 'deny'],
  ["probe 8 row 66: quoted conditional parameter scans single quotes", "[[ \"${x:-'$(" + D + ")'}\" == a ]]", 'deny'],
  ["probe 8 row 67: unquoted conditional parameter scans single quotes", "[[ ${x:-'$(" + D + ")'} == a ]]", 'deny'],
  ["probe 8 row 68: case subject parameter scans single quotes", "case \"${x:-'$(" + D + ")'}\" in a) ;; esac", 'deny'],
  ["probe 8 row 69: quoted assignment parameter scans single quotes", "y=\"${x:-'$(" + D + ")'}\"", 'deny'],
  ["probe 8 row 70: unquoted assignment parameter scans single quotes", "y=${x:-'$(" + D + ")'}", 'deny'],
  ["probe 8 row 71: quoted parameter scans single-quoted backtick", "echo \"${x:-'`" + D + "`'}\"", 'deny'],
  ["probe 8 row 72: quoted parameter scans ANSI-quoted substitution", "echo \"${x:-$'$(" + D + ")'}\"", 'deny'],
  ["probe 8 row 73: quoted parameter locale quote expands substitution", "echo \"${x:-$\"$(" + D + ")\"}\"", 'deny'],
  ["probe 8 row 74: quoted arithmetic parameter scans single quotes", "echo \"$((${x:-'$(" + D + "; echo 1)'}))\"", 'deny'],
  ["probe 8 row 75: quoted array parameter subscript scans single quotes", "echo \"${a['$(" + D + ")']}\"", 'deny'],
  ["probe 8 row 76: escaped apostrophes in parameter do not hide substitution", "echo \"${x:-\\'$(" + D + ")\\'}\"", 'deny'],
  ["probe 8 row 77: regex blank group leaves following command checked", "[[ x =~ (a b) ]]; " + D + "", 'deny'],
  ["probe 8 row 78: regex semicolon group leaves following command checked", "[[ x =~ (a;b) ]]; " + D + "", 'deny'],
  ["probe 8 row 79: regex bare alternation stays in operand", "[[ x =~ a|b ]]; " + D + "", 'deny'],
  ["probe 8 row 80: regex alternation before hash group stays in operand", "[[ x =~ a|(#) ]]; " + D + "", 'deny'],
  ["probe 8 row 82: escaped closing parenthesis keeps regex hash in group", "[[ x =~ (\\)#) ]]; " + D + "\necho ]]", 'deny'],
  ["probe 8 row 83: regex group backtick substitution is checked", "[[ x =~ (`" + D + "`) ]]", 'deny'],
  ["probe 8 row 84: regex group double-quoted substitution is checked", "[[ x =~ (\"$(" + D + ")\") ]]", 'deny'],
  ["probe 8 row 85: regex group single-quoted substitution stays inert", "[[ x =~ ('$(" + D + ")') ]]", undefined],
  ["probe 8 row 86: regex group parameter substitution is checked", "[[ x =~ (${y:-$(" + D + ")}) ]]", 'deny'],
  ["probe 8 row 87: regex group newline and hash stay literal", "[[ x =~ (a\n#) ]]; " + D + "", 'deny'],
  ["probe 8 row 90: negated regex term recognizes group", "[[ ! x =~ (#) ]]; " + D + "", 'deny'],
  ["probe 8 row 91: logical disjunction resets regex operator tracking", "[[ x =~ (#) || y =~ (#) ]]; " + D + "", 'deny'],
  ["probe 8 row 94: regex operand may touch operator", "[[ x =~(#) ]]; " + D + "", 'deny'],
  ["probe 8 row 96: initial regex spelling is a left operand", "[[ =~ =~ (#) ]]; " + D + "", 'deny'],
  ["probe 8 row 97: unary operand regex spelling is data", "[[ -n =~ ]] && " + D + "", 'deny'],
  ["probe 8 row 98: equality right operand regex spelling is data", "[[ x == =~ ]] ; " + D + "", 'deny'],
  ["probe 8 row 100: inequality embedded hash stays literal", "[[ x != a#b ]]; " + D + "", 'deny'],
  ["probe 8 row 102: enabled extended pattern preserves hash alternative", "shopt -s extglob\n[[ x == @(#|a) ]]; " + D + "", 'deny'],
  ["probe 8 row 103: conditional extended pattern preserves hash alternative", "[[ x == @(#|a) ]]; " + D + "", 'deny'],
  ["probe 8 row 104: extended pattern preserves blanks", "[[ x == +(a b) ]]; " + D + "", 'deny'],
  ["probe 8 row 105: extended pattern leaves following comment and command checked", "[[ x == *(#) ]] # c\n" + D + "", 'deny'],
  ["probe 8 row 106: unquoted parameter offset scans single quotes", "x=abc; echo ${x:'$(" + D + "; echo 1)'}", 'deny'],
  ["probe 8 row 107: quoted parameter offset scans single quotes", "x=abc; echo \"${x:'$(" + D + "; echo 1)'}\"", 'deny'],
  ["probe 8 row 108: parameter length scans single quotes", "x=abc; echo ${x:0:'$(" + D + "; echo 1)'}", 'deny'],
  ["probe 8 row 109: parameter offset command substitution is checked", "x=abc; echo ${x:$(" + D + "; echo 1)}", 'deny'],
  ["probe 8 row 110: unquoted array parameter subscript scans single quotes", "a=(1 2); echo ${a['$(" + D + "; echo 1)']}", 'deny'],
  ["probe 8 row 111: unquoted array parameter subscript expands substitution", "a=(1 2); echo ${a[$(" + D + "; echo 1)]}", 'deny'],
  ["probe 8 row 112: quoted array parameter subscript expands substitution", "a=(1 2); echo \"${a[$(" + D + "; echo 1)]}\"", 'deny'],
  ["probe 8 row 113: subscripted assignment scans single quotes", "a['$(" + D + "; echo 1)']=1", 'deny'],
  ["probe 8 row 114: subscripted assignment expands substitution", "a[$(" + D + "; echo 1)]=1", 'deny'],
  ["probe 8 row 115: array initializer subscript expands substitution", "a=([$(" + D + "; echo 1)]=1)", 'deny'],
  ["probe 8 row 116: array initializer subscript scans single quotes", "a=(['$(" + D + "; echo 1)']=1)", 'deny'],
  ["probe 8 row 117: arithmetic command scans single quotes", "(( '$(" + D + "; echo 1)' ))", 'deny'],
  ["probe 8 row 118: arithmetic command expands double-quoted substitution", "(( y = \"$(" + D + "; echo 1)\" ))", 'deny'],
  ["probe 8 row 119: arithmetic for header scans single quotes", "for (( i='$(" + D + "; echo 1)'; i<1; i++ )); do :; done", 'deny'],
  ["probe 8 row 120: legacy arithmetic scans single quotes", "echo $[ '$(" + D + "; echo 1)' ]", 'deny'],
  ["probe 8 row 121: arithmetic scans ANSI-quoted substitution", "echo $(( $'$(" + D + "; echo 1)' ))", 'deny'],
  ["probe 8 row 122: arithmetic double quotes expand substitution", "echo $(( \"'$(" + D + "; echo 1)'\" ))", 'deny'],
  ["probe 8 row 123: arithmetic single-quoted close preserves following command", "echo $(( ')' )); " + D + "", 'deny'],
  ["probe 8 row 124: arithmetic quoted close does not close unit", "echo $(( 1 + ')' + 1 )) ; " + D + "", 'deny'],
  ["probe 8 row 125: double-quoted arithmetic scans single quotes", "echo \"$(( '$(" + D + "; echo 1)' ))\"", 'deny'],
  ["probe 8 row 126: let single-quoted argument stays inert", "let 'y=$(" + D + ")'", undefined],
  ["probe 8 row 127: regex single-quoted operand stays inert", "[[ x =~ '$(" + D + ")' ]]", undefined],
  ["probe 8 row 128: regex double-quoted operand expands substitution", "[[ x =~ \"$(" + D + ")\" ]]", 'deny'],
  ["probe 8 row 129: embedded regex single-quoted span stays inert", "[[ x =~ a'$(" + D + ")'b ]]", undefined],
  ["probe 8 row 130: regex group preserves single-quoted blank", "[[ x =~ ('a b'|c) ]]; " + D + "", 'deny'],
  ["probe 8 row 131: regex group preserves double-quoted blank", "[[ x =~ (a|\"b c\") ]]; " + D + "", 'deny'],
  ["probe 8 row 132: regex group preserves escaped blank", "[[ x =~ (a\\ b) ]]; " + D + "", 'deny'],
  ["probe 8 row 133: regex character class and hash group stay in operand", "[[ x =~ ^[[:space:]]*(#|$) ]]; " + D + "", 'deny'],
  ["probe 8 row 134: regex groups close before logical conjunction", "[[ x =~ ^(a|b)+$ && y == z ]] || " + D + "", 'deny'],
  ["probe 8 row 135: regex groups preserve escaped dot", "[[ x =~ ^([0-9]+)\\.([0-9]+)$ ]] || " + D + "", 'deny'],
  ["probe 8 row 136: variable regex left operand leaves fallback checked", "[[ $x =~ ^-?[0-9]+$ ]] || " + D + "", 'deny'],
  ["probe 8 row 137: unary regex spelling followed by regex term is tracked", "[[ -n =~ && x =~ (#) ]]; " + D + "", 'deny'],
  ["probe 8 row 138: conditional group contains regex term", "[[ ( x =~ (#) ) ]]; " + D + "", 'deny'],
  ["probe 8 row 139: negated conditional group contains regex term", "[[ ! ( x =~ (#) ) ]]; " + D + "", 'deny'],
  ["probe 8 row 140: unary disjunction resets regex term tracking", "[[ -z x || x =~ (#) ]]; " + D + "", 'deny'],
  ["probe 8 row 141: conjunction allows regex spelling as left operand", "[[ x == y && =~ =~ (#) ]]; " + D + "", 'deny'],
  ["probe 8 row 142: file unary operand regex spelling is data", "[[ -f =~ ]]; " + D + "", 'deny'],
  ["probe 8 row 143: comparison right operand regex spelling is data", "[[ x < =~ ]]; " + D + "", 'deny'],
  ["probe 8 row 144: numeric comparison right operand regex spelling is data", "[[ x -eq =~ ]] ; " + D + "", 'deny'],
  ["probe 8 row 145: standalone regex spelling is an operand", "[[ =~ ]]; " + D + "", 'deny'],
  ["probe 8 row 147: negated standalone regex spelling is an operand", "[[ ! =~ ]] ; " + D + "", 'deny'],
  ["probe 8 row 148: regex conditional newline exposes following command", "[[ x =~ (#) ]]\n" + D + "", 'deny'],
  ["probe 8 row 150: adjacent conditional logical operators expose commands", "[[ x =~ (#) ]]&& " + D + "; [[ x =~ (#) ]]|| " + D + "", 'deny'],
  ["probe 8 row 151: if conditional regex leaves else command checked", "if [[ x =~ (#) ]]; then :; else " + D + "; fi", 'deny'],
  ["probe 8 row 152: while conditional regex leaves later command checked", "while [[ x =~ (#) ]]; do :; done; " + D + "", 'deny'],
  ["probe 8 row 153: escaped regex blank keeps hash inside operand", "[[ x =~ a\\ # ]] ; " + D + "", 'deny'],
  ["probe 8 row 154: boundary hash after regex operand starts comment", "[[ x =~ a #comment\n]]; " + D + "", 'deny'],
  ["probe 8 row 155: boundary comment after regex group ignores quote", "[[ x =~ (#) #comment 'q\n]]; " + D + "", 'deny'],
  ["probe 8 row 157: balanced empty nested regex groups preserve following command", "[[ x =~ (()) ]]; " + D + "", 'deny'],
  ["probe 8 row 160: escaped opening parenthesis leaves following command checked", "[[ x =~ \\( ]]; " + D + "", 'deny'],
  ["probe 8 row 161: regex quantifier before hash group stays in operand", "[[ x =~ a{1,2}(#) ]]; " + D + "", 'deny'],
  ["probe 8 row 162: regex group metacharacters stay literal", "[[ x =~ (<|>|&|;) ]]; " + D + "", 'deny'],
  ["probe 8 row 166: regex alternation preserves terminal hash", "[[ x =~ a|b|# ]]; " + D + "", 'deny'],
  ["probe 8 row 167: regex bare vertical bar is an operand", "[[ x =~ | ]]; " + D + "", 'deny'],
  ["probe 8 row 169: variable regex prefix attaches to hash group", "[[ x =~ $y(#) ]]; " + D + "", 'deny'],
  ["probe 8 row 170: parameter regex prefix attaches to hash group", "[[ x =~ ${y}(#) ]]; " + D + "", 'deny'],
  ["probe 8 row 171: quoted regex prefix attaches to hash group", "[[ x =~ \"a\"(#) ]]; " + D + "", 'deny'],
  ["probe 8 row 172: heredoc parameter double quotes expand substitution between apostrophes", "cat <<EOF\n${x:-\"'$(" + D + ")'\"}\nEOF", 'deny'],
  ["probe 8 row 173: unterminated heredoc parameter quote fails closed", "cat <<EOF\n${x:-a'b}\nEOF\n" + D + "", 'deny'],
  ["probe 8 row 174: heredoc arithmetic scans single quotes", "cat <<EOF\n$(( '$(" + D + "; echo 1)' ))\nEOF", 'deny'],
  ["probe 8 row 175: escaped heredoc parameter opener leaves ordinary substitution visible", "cat <<EOF\n\\${x:-'$(" + D + ")'}\nEOF", 'deny'],
  ["probe 8 row 176: escaped heredoc parameter apostrophes leave substitution visible", "cat <<EOF\n${x:-\\'$(" + D + ")\\'}\nEOF", 'deny'],
  ["probe 8 row 177: separate parameter quote spans preserve following command", "echo \"${x:-'a'}\" \"${y:-'b'}\"; " + D + "", 'deny'],
  ["probe 8 row 178: parameter single quote preserves both closing braces", "echo \"${x:-'}'}\"; " + D + "", 'deny'],
  ["probe 8 row 179: parameter single quote preserves double quote", "echo \"${x:-'\"'}\"; " + D + "", 'deny'],
  ["probe 8 row 180: parameter single quote preserves embedded double quote", "echo \"${x:-'a\"b'}\" ; " + D + "", 'deny'],
  ["probe 8 row 181: nested quoted substitution parse failure cannot hide command", "echo \"${x:-'$(echo ')')'}\"; " + D + "", 'deny'],
  ["probe 8 row 184: parameter pattern quoted braces preserve following command", "echo \"${x#'}'}\"; " + D + "", 'deny'],
]) test(`round 5: ${name}`, async () => {
  assert.equal((await run(command)).decision, expected);
});

for (const [name, command, expected, reason] of [
  ['regex leading vertical bars cannot hide following command', `[[ x =~ ||(#) ]]; ${D}\necho ]]`, 'deny'],
  ['regex leading vertical bars stay inside operand', '[[ x =~ ||(#) ]]', undefined],
  ['unclosed regex group is a parse problem', '[[ x =~ ( ]]', 'deny', /unterminated regex group/i],
  ['unclosed extended pattern group is a parse problem', '[[ x == @( ]]', 'deny', /unterminated pattern group/i],
  ['parameter quoted substitution parse problem propagates', "echo ${x:-'$(echo'}", 'deny', /unterminated \$\( substitution/i],
  ['arithmetic quoted substitution parse problem propagates', "echo $(( '$(echo' ))", 'deny', /unterminated \$\( substitution/i],
  ['assignment subscript quoted substitution parse problem propagates', "a['$(echo']=1", 'deny', /unterminated \$\( substitution/i],
  ['initializer subscript quoted substitution parse problem propagates', "a=(['$(echo']=1)", 'deny', /unterminated \$\( substitution/i],
  ['heredoc legacy arithmetic scans single quotes', `cat <<EOF\n$[ '$(${D})' ]\nEOF`, 'deny'],
  ['ordinary array element single quotes stay inert', `a=('$(${D})')`, undefined],
]) test(`round 5: ${name}`, async () => {
  const result = await run(command);
  assert.equal(result.decision, expected);
  if (reason) assert.match(result.reason, reason);
});

for (const [name, command, expected] of [
  ['subscripted assignment scans quoted substitution', `arr['$(${D})']=1`, 'deny'],
  ['subscripted append assignment scans quoted substitution', `arr['$(${D})']+=1`, 'deny'],
  ['array initializer entry scans quoted subscript substitution', `arr=(['$(${D})']=1)`, 'deny'],
  ['ordinary subscript argument scans unquoted substitution', `ls arr[$(${D})]`, 'deny'],
]) test(`round 6: ${name}`, async () => {
  assert.equal((await run(command)).decision, expected);
});

for (const [name, command, expected] of [
  ['time preserves assignment position', `time a['$(${D})']=1`, 'deny'],
  ['portable time preserves assignment position', `time -p a['$(${D})']=1`, 'deny'],
  ['negation before time preserves assignment position', `! time a['$(${D})']=1`, 'deny'],
  ['negation after time preserves assignment position', `time ! a['$(${D})']=1`, 'deny'],
  ['time preserves consecutive assignments', `time x=1 a['$(${D})']=1`, 'deny'],
  ['declare scans assignment subscript', `declare a['$(${D})']=1`, 'deny'],
  ['typeset scans assignment subscript', `typeset a['$(${D})']=1`, 'deny'],
  ['local conservatively scans assignment subscript', `local a['$(${D})']=1`, 'deny'],
  ['readonly conservatively scans assignment subscript', `readonly a['$(${D})']=1`, 'deny'],
  ['export conservatively scans assignment subscript', `export a['$(${D})']=1`, 'deny'],
  ['bare assignment scans subscript', `a['$(${D})']=1`, 'deny'],
  ['bare append assignment scans subscript', `a['$(${D})']+=1`, 'deny'],
  ['leading assignment preserves assignment position', `x=1 a['$(${D})']=1`, 'deny'],
  ['negation preserves assignment position', `! a['$(${D})']=1`, 'deny'],
  ['redirection preserves assignment position', `>/dev/null a['$(${D})']=1`, 'deny'],
  ['if condition preserves assignment position', `if a['$(${D})']=1; then :; fi`, 'deny'],
  ['conjunction preserves assignment position', `true && a['$(${D})']=1`, 'deny'],
  ['coproc preserves assignment position', `coproc a['$(${D})']=1`, 'deny'],
  ['newline after time preserves assignment position', `time\na['$(${D})']=1`, 'deny'],
  ['portable time and negation preserve assignment position', `time -p ! a['$(${D})']=1`, 'deny'],
  ['quoted declaration command is normalized', `"declare" a['$(${D})']=1`, 'deny'],
  ['declaration command basename is normalized', `/bin/typeset a['$(${D})']=1`, 'deny'],
  ['declaration options preserve assignment position', `declare -a a['$(${D})']=1`, 'deny'],
  ['declaration later arguments preserve assignment position', `declare x a['$(${D})']=1`, 'deny'],
  ['declaration consecutive assignments scan every subscript', `declare a[0]=1 b['$(${D})']=1`, 'deny'],
  ['leading assignment before declaration scans subscript', `x=1 declare a['$(${D})']=1`, 'deny'],
  ['timed declaration scans subscript', `time -p declare a['$(${D})']=1`, 'deny'],
  ['timed conditional scans subscript assignment in body', `time [[ x == x ]] && a['$(${D})']=1`, 'deny'],
  ['timed group scans subscript assignment in body', `time -p { a['$(${D})']=1; }`, 'deny'],
  ['time with option terminator scans subscript', `time -- a['$(${D})']=1`, 'deny'],
  ['command wrapper before declaration scans subscript', `command declare a['$(${D})']=1`, 'deny'],
  ['builtin wrapper before declaration scans subscript', `builtin declare a['$(${D})']=1`, 'deny'],
  ['let scans subscript', `let a['$(${D})']=1`, 'deny'],
  ['read scans subscript', `read a['$(${D})'] </dev/null`, 'deny'],
  ['test variable lookup scans subscript', `test -v a['$(${D})']`, 'deny'],
  ['printf variable destination scans subscript', `printf -v a['$(${D})'] x`, 'deny'],
]) test(`round 7: ${name}`, async () => {
  assert.equal((await run(command)).decision, expected);
});

const parseDenials = [
  ['unbalanced double quote', 'echo "unbalanced', /quote/i],
  ['heredoc never closes before denied text', `cat <<EOF\n${D}`, /heredoc.*EOF/i],
  ['malformed commit heredoc delimiter quote', 'git commit -m "$(cat <<\'EOF\ndon\'t break\nEOF\n)"', /heredoc.*EOF/i],
  ['single quote', "echo 'abc", /single quote/i],
  ['ANSI-C quote', "echo $'abc", /ANSI-C quote/i],
  ['command substitution', 'echo $(ls', /\$\( substitution/i],
  ['backtick substitution', 'echo `ls', /` substitution/i],
  ['input process substitution', 'cat <(ls', /<\( substitution/i],
  ['output process substitution', 'cat >(ls', />\( substitution/i],
  ['parameter expansion', 'echo ${x:-y', /parameter expansion/i],
  ['arithmetic expansion', 'echo $((1 + 2', /arithmetic expansion/i],
  ['arithmetic command', '(( x = 1', /arithmetic command/i],
  ['legacy arithmetic expansion', 'echo $[1 + 2', /legacy arithmetic expansion/i],
  ['array initializer', 'files=(a b', /array initializer/i],
  ['conditional', '[[ -f x', /conditional/i],
  ['shell command string quote', `bash -c 'echo "abc'`, /quote/i],
  ['eval quote', `eval 'echo "abc'`, /quote/i],
  ['env split string quote', `env -S 'echo "abc'`, /quote/i],
  ['shell heredoc quote', 'bash <<EOF\necho "abc\nEOF', /quote/i],
  ['shell here-string quote', `bash <<< 'echo "abc'`, /quote/i],
  ['unquoted heredoc substitution', 'cat <<EOF\n$(ls\nEOF', /substitution/i],
  ['unquoted heredoc arithmetic expansion', 'cat <<EOF\n$((1 + 2\nEOF', /arithmetic expansion/i],
  ['heredoc without body newline', 'cat <<EOF', /heredoc.*EOF/i],
  ['heredoc terminator has trailing space', `cat <<EOF\nx\nEOF \n${D}`, /heredoc.*EOF/i],
  ['tab-stripped heredoc terminator has leading space', 'cat <<-EOF\n\tx\n EOF', /heredoc.*EOF/i],
  ['heredoc terminator shares substitution closing line', 'echo "$(cat <<EOF\nx\nEOF)"', /heredoc.*EOF/i],
  ['heredoc substitution closes before body newline', 'echo "$(cat <<EOF)"', /heredoc.*EOF/i],
  ['NUL byte in JSON command', 'echo a\0b', /NUL byte/i],
  ['carriage return in CRLF command', 'ls\r\nls', /carriage return/i],
];
for (const [name, command, reason] of parseDenials) {
  for (const verbose of ['0', '1']) test(`round 3 parse denial: ${name}, verbose=${verbose}: ${JSON.stringify(command)}`, async () => {
    const result = await run(command, ['Bash(rm:*)'], { SMART_APPROVE_VERBOSE: verbose });
    assert.equal(result.decision, 'deny');
    assert.match(result.reason, reason);
    assert.match(result.reason, /^Command not analyzed: .+\. This guard denies what it cannot parse while deny patterns are configured\./);
    assert.doesNotMatch(result.reason, /guard error/i);
  });
}

const wellFormedCommands = [
  'ls -la | grep foo | wc -l',
  'git status && git diff --stat',
  'cat <<EOF > out.txt\nhello $USER\nEOF',
  `cat <<'EOF' > out.txt\nit's a "test\n$(not run)\nEOF`,
  'cat <<-EOF\n\tindented\n\tEOF',
  '[[ -f a.txt && $x == *.md ]] && echo yes',
  '[[ $a =~ ^[0-9]+$ ]] || exit 1',
  'case "$1" in\n  start) echo go ;;\n  stop|halt) echo no ;;\n  *) echo what ;;\nesac',
  'python3 -c "print(1 << 2)"',
  "python3 -c 'x = 8 >> 1; print(x)'",
  'node -e "console.log(1 << 4)"',
  'echo $((1 << 10))',
  '(( x = 1 << 2 )); echo $x',
  'for ((i = 0; i < 3; i++)); do echo $i; done',
  'for f in *.txt; do wc -l "$f"; done',
  'while read -r line; do echo "$line"; done < input.txt',
  'grep "a<<b" notes.txt',
  `echo 'it''s' "fine"`,
  'echo "nested $(basename "$(pwd)")"',
  'files=(a b c); echo "${files[@]}"',
  'x=${y:-default}; echo ${#x}',
  'find . -name "*.py" -exec wc -l {} +',
  'f() { echo hi; }; f',
  'diff <(sort a) <(sort b)',
  "echo done # it's finished",
  "jq -r '.items[] | select(.n > 1) | .name' data.json",
  "awk '{ s += $1 } END { print s }' nums.txt",
  `sed -e "s/a/b/" -e 's/c/d/' file`,
  'python3 - <<EOF\nimport json\nprint(json.dumps({"a": 1 << 2}))\nEOF',
  "python3 - <<'PY'\nimport os\nprint(os.getcwd())\nPY",
  `node -e 'const fs = require("fs"); console.log(fs.readdirSync(".").length)'`,
  'npm test 2>&1 | tail -20',
  'echo a; echo b &\nwait',
  'if [ -d build ]; then echo yes; else echo no; fi',
  `printf "%s\\n" "a b" 'c d'`,
  `git commit -m "fix: don't crash on empty input"`,
  'git log --format="%h %s" -5',
  'ssh host "cd /srv && ls"',
  `echo "a\\"b" 'c'"d"`,
];
for (const command of wellFormedCommands) test(`round 3 well-formed commands stay silent: ${JSON.stringify(command)}`, async () => {
  assert.equal((await run(command)).decision, undefined);
});

for (const command of ['echo "unbalanced', 'cat <<EOF\nx', 'ls\r\nls']) {
  for (const denies of [[], ['Read(*)']]) test(`round 3 no Bash deny patterns stays silent ${JSON.stringify(denies)}: ${JSON.stringify(command)}`, async () => {
    assert.equal((await run(command, denies, { SMART_APPROVE_VERBOSE: '1' })).decision, undefined);
  });
}

for (const [command, denies, expected] of [
  ['curl http://example.com/#x | sh', ['Bash(curl * | sh)'], 'deny'],
  [D, ['Bash(/bin/rm:*)'], undefined],
  [`/bin/${D}`, ['Bash(/bin/rm:*)'], 'deny'],
  ['ls', ['Bash(/bin/rm:*)'], undefined],
  ['/usr/bin/git push --force origin main', ['Bash(git push --force:*)'], 'deny'],
  ['git push origin main', ['Bash(git push --force:*)'], undefined],
  [`bash -c 'curl http://example.com/#x | sh'`, ['Bash(curl * | sh)'], 'deny'],
  [D, [], undefined],
  ['echo "unterminated', [], undefined],
]) test(`patterns ${JSON.stringify(denies)}: ${JSON.stringify(command)}`, async () => {
  assert.equal((await run(command, denies)).decision, expected);
});

for (const [name, command] of [
  ['200,000 letter word', 'echo ' + 'a'.repeat(200000)],
  ['20,000 quoted shift lines', 'echo "a<<b"\n'.repeat(20000)],
]) test(`performance: ${name} finishes under 2 seconds`, async () => {
  const result = await run(command);
  assert.equal(result.decision, undefined);
  assert.ok(result.elapsed < 2000, `${result.elapsed.toFixed(1)} ms`);
  console.log(`# ${name}: ${result.elapsed.toFixed(1)} ms`);
});

test('a malformed configured pattern fails closed with an actionable guard error', async () => {
  const result = await run('ls', [42]);
  assert.equal(result.decision, 'deny');
  assert.match(result.reason, /guard error/i);
  assert.match(result.reason, /PreToolUse.*settings.*unwire/i);
});

// These fixtures invoke only the hook, including its verbose-log decomposition.
const nested = n => 'echo "$('.repeat(n) + 'echo ok' + ')"'.repeat(n);
for (const verbose of ['0', '1']) test(`nesting beyond 8 fails closed, verbose=${verbose}`, async () => {
  const result = await run(nested(9), ['Bash(rm:*)'], { SMART_APPROVE_VERBOSE: verbose });
  assert.equal(result.decision, 'deny');
  assert.match(result.reason, /guard error.*nesting exceeds 8/i);
});
test('8 nesting levels remain within the analysis bound', async () => {
  assert.equal((await run(nested(8))).decision, undefined);
});
test('no denies stays silent even on over-deep input and verbose decomposition', async () => {
  assert.equal((await run(nested(9), [], { SMART_APPROVE_VERBOSE: '1' })).decision, undefined);
});

for (const location of [root, path.join(root, 'missing.json')]) test(`unreadable settings ${path.basename(location)} mean no patterns`, async () => {
  assert.equal((await run(D, [], { CLAUDE_SETTINGS_PATH: location })).decision, undefined);
});

test('a crash while building a verbose reason still emits an actionable deny', async () => {
  const harness = [
    'import importlib.util, sys',
    'spec = importlib.util.spec_from_file_location("guard", sys.argv[1])',
    'guard = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(guard)',
    'def crash(reason): raise RuntimeError("reason fixture")',
    'guard._build_reason = crash',
    'guard.main()',
  ].join('\n');
  const result = await run(D, ['Bash(rm:*)'], { SMART_APPROVE_VERBOSE: '1' }, harness);
  assert.equal(result.decision, 'deny');
  assert.match(result.reason, /guard error.*reason fixture/i);
});
