import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const EXPECTED_BRANCH = 'task/v2-bootstrap';
const PROJECT_DIR = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());

const PROTECTED_EXACT = new Set([
  'MASTER_SPEC.md',
  'FLOORS_1_10_DESIGN.md',
  'CURRENT_AUTHORITY_INDEX.json',
  'AI_PROJECT_POLICY.json',
  'AGENTS.md',
  'CHATGPT_PROJECT_INSTRUCTIONS1.md',
  'PROJECT_STATUS.json',
  'PROJECT_HANDOVER.md',
  'PROJECT_SOURCE_MANIFEST.md',
  'CLAUDE.md',
  '.claude/settings.json',
  '.claude/hooks/enforce-handoff.mjs',
  'docs/v2/CLAUDE_HANDOFF.md',
  'docs/v2/PRODUCT_AND_SYSTEM_SPEC.md',
  'docs/v2/VISUAL_DIRECTION.md',
  'docs/v2/DECISION_REGISTER.json',
  'CHATGPT_PROJECT_INSTRUCTIONS2.md',
  'CATS_TOWER_AI_NATIVE_BUILD_PROTOCOL1.md',
  'CATS_TOWER_PRODUCT_SNAPSHOT1.md',
  'index.html',
  'app.js',
  'game-core.js',
  'game-data.js',
  'styles.css',
  'sw.js'
]);

const PROTECTED_PREFIXES = [
  'canonical/',
  'simulation/',
  'quality-reviews/',
  'step4/'
];

const deny = (reason) => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  }));
  process.exit(0);
};

const normalizeRepoPath = (inputPath) => {
  if (typeof inputPath !== 'string' || inputPath.length === 0) return '';
  const absolute = resolve(PROJECT_DIR, inputPath);
  const rel = relative(PROJECT_DIR, absolute).split(sep).join('/');
  if (rel === '..' || rel.startsWith('../')) return `OUTSIDE:${rel}`;
  return rel;
};

const isProtectedPath = (repoPath) =>
  PROTECTED_EXACT.has(repoPath) ||
  PROTECTED_PREFIXES.some((prefix) => repoPath.startsWith(prefix));

const readInput = () => {
  const raw = readFileSync(0, 'utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
};

let input;
try {
  input = readInput();
} catch (error) {
  deny(`Cat's Tower handoff guard could not parse hook input: ${error.message}`);
}

const toolName = input.tool_name || '';
const toolInput = input.tool_input || {};

let branch;
let dirty;
try {
  branch = execFileSync('git', ['branch', '--show-current'], {
    cwd: PROJECT_DIR,
    encoding: 'utf8'
  }).trim();
  dirty = execFileSync('git', ['status', '--porcelain'], {
    cwd: PROJECT_DIR,
    encoding: 'utf8'
  }).trim();
} catch (error) {
  deny(`Cat's Tower handoff guard could not verify repository state: ${error.message}`);
}

if (branch !== EXPECTED_BRANCH) {
  if (toolName === 'Bash') {
    const command = String(toolInput.command || '').trim();
    const exactSwitch = /^(git\s+(switch|checkout)\s+task\/v2-bootstrap)$/;
    if (exactSwitch.test(command) && !dirty) process.exit(0);

    const hasControlOperator = /[;&|><`]|\$\(|\n/.test(command);
    const readOnly = [
      /^pwd$/,
      /^ls(?:\s|$)/,
      /^rg(?:\s|$)/,
      /^grep(?:\s|$)/,
      /^cat(?:\s|$)/,
      /^head(?:\s|$)/,
      /^tail(?:\s|$)/,
      /^sed\s+-n(?:\s|$)/,
      /^git\s+status(?:\s|$)/,
      /^git\s+branch(?:\s+(?:--show-current|--list|-a|-r|-v|-vv))*\s*$/,
      /^git\s+rev-parse(?:\s|$)/,
      /^git\s+log(?:\s|$)/,
      /^git\s+diff(?:\s|$)/,
      /^git\s+show(?:\s|$)/,
      /^gh\s+pr\s+view(?:\s|$)/,
      /^gh\s+run\s+(view|list)(?:\s|$)/
    ].some((pattern) => pattern.test(command));

    if (readOnly && !hasControlOperator) process.exit(0);
  }

  deny(
    `Wrong Cat's Tower branch. Expected ${EXPECTED_BRANCH}, observed ${branch || 'DETACHED/UNKNOWN'}. ` +
    `${dirty ? 'The working tree is dirty, so do not switch automatically. ' : ''}` +
    'Read back repository state and stop writes.'
  );
}

if (toolName === 'Edit' || toolName === 'Write') {
  const repoPath = normalizeRepoPath(toolInput.file_path || toolInput.path || '');
  if (repoPath.startsWith('OUTSIDE:')) {
    deny(`Writing outside the Cat's Tower repository is not allowed: ${repoPath}`);
  }
  if (isProtectedPath(repoPath)) {
    deny(`Protected Cat's Tower authority/history path is read-only in V2-0: ${repoPath}`);
  }
}

if (toolName === 'Bash') {
  const command = String(toolInput.command || '');
  const forbidden = [
    { pattern: /git\s+push\b[^\n]*(--force|-f)\b/i, reason: 'force push is forbidden' },
    { pattern: /git\s+push\b[^\n]*(\bmain\b|\bkimi\b)/i, reason: 'direct push to main or kimi is forbidden' },
    { pattern: /git\s+switch\b/i, reason: 'switching away from the fixed work branch is forbidden' },
    { pattern: /git\s+checkout\b/i, reason: 'checkout is blocked during the fixed-branch handoff' },
    { pattern: /git\s+update-ref\b/i, reason: 'direct ref mutation is forbidden' },
    { pattern: /git\s+(merge|rebase)\b/i, reason: 'merge or rebase is outside the current handoff authority' },
    { pattern: /git\s+reset\s+--hard\b/i, reason: 'hard reset is forbidden' },
    { pattern: /git\s+clean\b/i, reason: 'git clean is forbidden' },
    { pattern: /git\s+branch\s+-D\b/i, reason: 'forced branch deletion is forbidden' },
    { pattern: /git\s+commit\b[^\n]*--amend\b/i, reason: 'history amendment is forbidden' },
    { pattern: /gh\s+pr\s+merge\b/i, reason: 'PR merge requires explicit authority' },
    { pattern: /vercel\b[^\n]*--prod\b/i, reason: 'production deployment is forbidden' },
    { pattern: /npm\s+publish\b/i, reason: 'package publication is forbidden' },
    { pattern: /rm\s+-rf\s+(\.\/)?(?:\.git|canonical|simulation|quality-reviews|step4)\b/i, reason: 'destructive removal of protected history is forbidden' }
  ];

  if (/^\s*git\s+branch\b/i.test(command)) {
    const readOnlyBranchCommand = /^\s*git\s+branch(?:\s+(?:--show-current|--list|-a|-r|-v|-vv))*\s*$/i.test(command);
    if (!readOnlyBranchCommand) deny("Creating, deleting or renaming branches is forbidden by the Cat's Tower handoff.");
  }

  const hit = forbidden.find(({ pattern }) => pattern.test(command));
  if (hit) deny(`Cat's Tower V2-0 guard blocked this command because ${hit.reason}.`);

  const protectedPathMentioned = [
    ...PROTECTED_PREFIXES,
    ...PROTECTED_EXACT
  ].some((protectedPath) => command.includes(protectedPath));
  const shellMutation = /(?:^|[;&|\n]\s*)(rm|mv|cp|install|truncate|touch|tee|dd|python|python3|node|ruby|php|apply_patch|chmod|chown)\b|sed\s+-i\b|perl\s+-p?i\b|git\s+(?:add|restore|rm|mv)\b|(?:>|>>)/i.test(command);
  if (protectedPathMentioned && shellMutation) {
    deny('Shell mutation of a protected Cat\'s Tower authority/history path is forbidden in V2-0.');
  }
}

process.exit(0);
