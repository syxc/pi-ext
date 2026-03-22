/**
 * File Sentry Extension
 *
 * Multi-tool permission system for Read/Write/Edit operations.
 * Compatible with OpenCode-style permission configuration.
 */
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

type Action = 'allow' | 'ask' | 'deny';

interface PermissionRule {
  tool: 'Bash' | 'Read' | 'Edit' | 'Write' | '*';
  matches?: { cmd?: string | string[]; path?: string | string[] };
  action: Action;
}

const STATE_PATH = join(homedir(), '.pi', 'agent', 'file-sentry.json');
const GLOBAL_CONFIG = join(homedir(), '.config', 'amp', 'settings.json');

const recentDenials = new Set<string>();

function loadRules(): PermissionRule[] {
  try {
    const data = JSON.parse(readFileSync(GLOBAL_CONFIG, 'utf8'));
    return data['amp.permissions'] ?? [];
  } catch {
    return [];
  }
}

function loadState(): { mode: 'enabled' | 'yolo' } {
  try {
    if (existsSync(STATE_PATH)) {
      return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    }
  } catch {}
  return { mode: 'enabled' };
}

function saveState(state: { mode: 'enabled' | 'yolo' }): void {
  try {
    const dir = dirname(STATE_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch {}
}

function globToRegex(pattern: string): RegExp {
  let p = pattern;
  if (p.startsWith('~/')) {
    p = join(homedir(), p.slice(2));
  }

  const GLOBSTAR_LEAD = '\x00GL\x00';
  const GLOBSTAR_TAIL = '\x00GT\x00';
  const STAR = '\x00ST\x00';

  if (p.startsWith('**/')) {
    p = p.replace(/^\*\*\//, GLOBSTAR_LEAD);
  }
  p = p.replace(/\/\*\*\//g, `/${GLOBSTAR_LEAD}`);
  p = p.replace(/\/\*\*$/g, GLOBSTAR_TAIL);
  p = p.replace(/\*/g, STAR);
  p = escapeRegex(p);

  p = p.replace(new RegExp(escapeRegex(GLOBSTAR_LEAD), 'g'), '(.*/)?');
  p = p.replace(new RegExp(escapeRegex(GLOBSTAR_TAIL), 'g'), '(?:/.*)?');
  p = p.replace(new RegExp(escapeRegex(STAR), 'g'), '[^/]*');
  p = p.replace(/\\\?/g, '.');

  return new RegExp(`^${p}$`);
}

function escapeRegex(str: string): string {
  return str.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

function matches(value: string, pattern: string | string[]): boolean {
  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  for (const p of patterns) {
    if (p === '*') return true;

    const regexMatch = p.match(/^\/(.+)\/([gimsuy]*)$/);
    if (regexMatch) {
      try {
        if (new RegExp(regexMatch[1], regexMatch[2]).test(value)) return true;
      } catch {}
      continue;
    }

    if (p.includes('*') || p.includes('?')) {
      if (globToRegex(p).test(value)) return true;
      continue;
    }

    if (value === p) return true;
  }
  return false;
}

function checkPermission(rules: PermissionRule[], tool: string, value: string): Action {
  for (const rule of rules) {
    if (rule.tool !== '*' && rule.tool.toLowerCase() !== tool.toLowerCase()) {
      continue;
    }
    const matchValue = tool.toLowerCase() === 'bash' ? rule.matches?.cmd : rule.matches?.path;
    if (matchValue === undefined) {
      return rule.action;
    }
    if (matches(value, matchValue)) {
      return rule.action;
    }
  }
  return 'allow';
}

function shouldNotify(key: string): boolean {
  if (recentDenials.has(key)) return false;
  recentDenials.add(key);
  setTimeout(() => recentDenials.delete(key), 5000);
  return true;
}

export default function (pi: ExtensionAPI): void {
  let state = loadState();
  saveState(state);

  pi.registerCommand('file-sentry', {
    description: 'Manage File Sentry permissions: yolo | enable | status',
    handler: async (args, ctx) => {
      const cmd = typeof args === 'string' ? args.toLowerCase() : (args[0] ?? '').toLowerCase();

      if (cmd === 'yolo') {
        state.mode = 'yolo';
        saveState(state);
        ctx.ui.setStatus('file-sentry', 'YOLO');
        ctx.ui.notify('File Sentry: YOLO mode - all operations allowed', 'warning');
        return;
      }

      if (cmd === 'enable' || cmd === 'enabled') {
        state.mode = 'enabled';
        saveState(state);
        ctx.ui.setStatus('file-sentry', undefined);
        ctx.ui.notify('File Sentry: protection enabled', 'info');
        return;
      }

      const rules = loadRules().filter((r) => ['Read', 'Edit', 'Write', '*'].includes(r.tool));
      ctx.ui.notify(`File Sentry: mode=${state.mode}, rules=${rules.length}`, 'info');
    },
  });

  pi.on('tool_call', async (event, ctx) => {
    if (state.mode === 'yolo') return;

    const toolName = event.toolName.toLowerCase();
    if (!['bash', 'read', 'edit'].includes(toolName)) return;

    const rules = loadRules();
    let value = '';
    let display = '';

    switch (toolName) {
      case 'bash':
        value = (event.input.command as string) ?? '';
        display = value;
        break;
      case 'read':
      case 'edit':
        value = (event.input.path as string) ?? '';
        display = `${toolName.toUpperCase()} ${value}`;
        break;
    }

    if (!value) return;

    const action = checkPermission(rules, toolName, value);
    if (action === 'allow') return;

    if (action === 'deny') {
      if (shouldNotify(value)) {
        ctx.ui.notify(`⛔ File Sentry blocked: ${display}`, 'error');
      }
      return { block: true, reason: `File Sentry denied: ${display}` };
    }

    if (!ctx.hasUI) {
      return { block: true, reason: `File Sentry denied (no UI): ${display}` };
    }

    const choice = await ctx.ui.select(`⚠️ File Sentry\n\n${display}\n\nAllow this operation?`, ['Yes', 'No']);

    if (choice !== 'Yes') {
      ctx.abort?.();
      return { block: true, reason: 'Blocked by user' };
    }

    return;
  });

  pi.on('session_start', async (_e, ctx) => {
    if (state.mode === 'yolo') {
      ctx.ui.setStatus('file-sentry', 'YOLO');
    }
  });
}
