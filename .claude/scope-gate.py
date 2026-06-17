#!/usr/bin/env python3
import sys, json, fnmatch, os

ALWAYS_BLOCK = [".claude/scope-gate.py", ".claude/settings.json", ".claude/protected-paths.txt"]
ALWAYS_ALLOW = [".claude/task-scope.txt"]

def load(path):
    try:
        with open(path) as f:
            return [l.strip() for l in f if l.strip() and not l.strip().startswith("#")]
    except FileNotFoundError:
        return []

def matches(rel, patterns):
    return any(fnmatch.fnmatch(rel, p) for p in patterns)

raw = sys.stdin.read()
try:
    payload = json.loads(raw)
except Exception:
    sys.exit(0)

ti = payload.get("tool_input") or {}
path = ti.get("file_path") or ti.get("path") or ""
if not path:
    sys.exit(0)

root = payload.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
rel = os.path.relpath(path, root)

if rel.startswith(".."):
    sys.stderr.write(f"BLOCKED: {rel} is outside the project root.\n"); sys.exit(2)
if matches(rel, ALWAYS_ALLOW):
    sys.exit(0)
if matches(rel, ALWAYS_BLOCK):
    sys.stderr.write(f"BLOCKED: {rel} is a fence control file. The agent cannot edit it. Ask Julian.\n"); sys.exit(2)

protected = load(os.path.join(root, ".claude/protected-paths.txt"))
if matches(rel, protected):
    sys.stderr.write(f"BLOCKED: {rel} is a protected crown-jewel path. Only Julian edits this by hand. Do not work around it.\n"); sys.exit(2)

scope = load(os.path.join(root, ".claude/task-scope.txt"))
if not scope:
    sys.stderr.write("BLOCKED: No task scope declared. List the files this task will touch in .claude/task-scope.txt (one path or glob per line) before editing. To disarm the fence for this session, put a single line `*` in that file.\n"); sys.exit(2)
if matches(rel, scope):
    sys.exit(0)

sys.stderr.write(f"BLOCKED: {rel} is outside the declared task scope. If it genuinely must change, STOP and tell Julian why before adding it to .claude/task-scope.txt. Do not silently expand scope.\n")
sys.exit(2)
