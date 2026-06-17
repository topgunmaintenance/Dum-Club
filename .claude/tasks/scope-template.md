# Scope arming template

Copy the FILE LIST block below into `.claude/task-scope.txt` at the start of every task, replacing the disarming `*`. This arms the scope fence. When the task is done, restore `.claude/task-scope.txt` to a single `*` to disarm.

## How to arm
1. Identify the minimum set of files this task requires (per the SCOPE PROTECTION RULE in CLAUDE.md).
2. Put those paths in `.claude/task-scope.txt`, one path or glob per line.
3. If a file outside the list turns out to be needed mid-task: STOP, tell Julian why, and wait for him to approve adding it. Do not edit it first.

## FILE LIST block (copy into task-scope.txt, fill in real paths)
```
# Task: <one-line description>
# Armed: <date>
frontend/app/<path>
frontend/components/<path>
```

## To disarm when done
Replace the entire contents of `.claude/task-scope.txt` with a single line:
```
*
```
