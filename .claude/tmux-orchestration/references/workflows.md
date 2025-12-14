# Tmux Orchestration Workflows

Detailed patterns for interactive terminal orchestration using raw tmux.

## Interactive Debugging with pdb

Step through Python code, observe state at each point, make decisions based on what you see.

### Setup

```bash
# 1. Launch shell in new pane
tmux split-window -h "zsh"
# New pane is now pane 1

# 2. Start debugger
tmux send-keys -t 1 "python -m pdb script.py" Enter

# 3. Wait for pdb prompt
sleep 2
```

### Debugging Commands

```bash
# Step to next line
tmux send-keys -t 1 "n" Enter

# Step into function
tmux send-keys -t 1 "s" Enter

# Print variable
tmux send-keys -t 1 "p variable_name" Enter

# Print locals
tmux send-keys -t 1 "pp locals()" Enter

# Continue to next breakpoint
tmux send-keys -t 1 "c" Enter

# Set breakpoint
tmux send-keys -t 1 "b filename:lineno" Enter

# Where am I (stack trace)
tmux send-keys -t 1 "w" Enter
```

### Pattern: Investigate → Decide → Act

```bash
# After each step, capture and analyze
tmux send-keys -t 1 "n" Enter
sleep 0.5
tmux capture-pane -t 1 -p -S -20

# Analyze output, then decide:
# - "n" to continue stepping
# - "p var" to inspect something
# - "s" to dive into a function
# - "c" to continue to breakpoint
```

### Cleanup

```bash
tmux send-keys -t 1 "q" Enter  # Quit pdb
tmux send-keys -t 1 "exit" Enter  # Exit shell
tmux kill-pane -t 1
```

---

## Claude-to-Claude Communication

Spawn another Claude instance for independent analysis, fresh perspective, or specialized focus.

### When to Spawn Another Instance

**Good reasons:**
- Need fresh perspective without accumulated context bias
- Want independent verification of reasoning
- Specialized subtask that benefits from focused attention
- Code review by "another set of eyes"

**Bad reasons:**
- Task is simple enough to do directly
- Context carryover is important (spawned instance has none)
- Time-sensitive (startup adds ~3-5 seconds)

### Basic Pattern

```bash
# 1. Launch shell in new pane
tmux split-window -h "zsh"

# 2. Start Claude
tmux send-keys -t 1 "claude" Enter

# 3. Wait for Claude to start (watch for prompt)
sleep 5

# 4. Send focused prompt
tmux send-keys -t 1 "Review this function for edge cases:

def process_items(items):
    return [x * 2 for x in items if x > 0]

What inputs might cause unexpected behavior?" Enter

# 5. Wait for response (use wait loop for reliability)
LAST=""; for i in {1..60}; do
  CURRENT=$(tmux capture-pane -t 1 -p | tail -20)
  [ "$CURRENT" = "$LAST" ] && break
  LAST="$CURRENT"; sleep 1
done

# 6. Capture response
tmux capture-pane -t 1 -p

# 7. Cleanup
tmux send-keys -t 1 "/exit" Enter
sleep 1
tmux kill-pane -t 1
```

### Prompt Design for Spawned Instances

The spawned Claude has NO context. The prompt must be self-contained.

**Include:**
- Complete code/data being analyzed
- Specific question or task
- Expected output format
- Constraints or requirements

**Example - Code Review:**
```
Review this TypeScript function for:
1. Type safety issues
2. Edge cases
3. Performance concerns

function merge<T>(a: T[], b: T[]): T[] {
  return [...a, ...b].sort();
}

List findings as bullet points with severity (high/medium/low).
```

**Example - Reasoning Verification:**
```
I concluded that the bug is in the authentication middleware because:
1. Error only occurs on protected routes
2. Token validation passes in unit tests
3. Middleware logs show the request stops there

Do you agree with this analysis? What alternative explanations exist?
```

### Multi-Turn Interaction

For complex analysis requiring follow-up:

```bash
# Initial prompt
tmux send-keys -t 1 "Analyze this architecture diagram..." Enter

# Wait for response
LAST=""; for i in {1..60}; do
  CURRENT=$(tmux capture-pane -t 1 -p | tail -20)
  [ "$CURRENT" = "$LAST" ] && break
  LAST="$CURRENT"; sleep 1
done

# Capture and analyze
tmux capture-pane -t 1 -p

# Follow-up based on response
tmux send-keys -t 1 "You mentioned scalability concerns. Can you elaborate on the database bottleneck?" Enter
```

---

## REPL Exploration

Iterative code development and exploration in Python, Node, or other REPLs.

### Setup

```bash
# Python
tmux split-window -h "zsh"
tmux send-keys -t 1 "python3" Enter
sleep 1

# Node
tmux split-window -h "zsh"
tmux send-keys -t 1 "node" Enter
sleep 1
```

### Exploration Pattern

```bash
# Send expression
tmux send-keys -t 1 "import pandas as pd" Enter
sleep 0.5

tmux send-keys -t 1 "df = pd.read_csv('data.csv')" Enter
sleep 1

tmux send-keys -t 1 "df.head()" Enter
sleep 0.5

# Capture to see result
tmux capture-pane -t 1 -p -S -30
# Analyze output, decide next exploration step
```

### Multi-line Code

For multi-line code in Python REPL:

```bash
tmux send-keys -t 1 "def process(x):" Enter
tmux send-keys -t 1 "    return x * 2" Enter
tmux send-keys -t 1 "" Enter  # Empty line to end definition
```

---

## Long-Running Observable Processes

Monitor dev servers, build processes, or test runs while doing other work.

### Pattern: Launch and Monitor

```bash
# Launch dev server
tmux split-window -h "zsh"
tmux send-keys -t 1 "npm run dev" Enter

# Periodically check for issues
# (Usually triggered by user request or after making changes)
tmux capture-pane -t 1 -p -S -50
# Analyze for errors, warnings, or relevant output
```

### Pattern: Watch for Specific Output

```bash
# After making a change, check if server shows errors
tmux capture-pane -t 1 -p -S -20

# Look for patterns like:
# - "Error:", "error:", "ERROR"
# - "Warning:", "WARN"
# - "compiled successfully"
# - Stack traces
```

---

## Error Handling

### Pane Disappeared

If a pane closes unexpectedly:
```bash
# Check what panes exist
tmux list-panes

# List with more detail
tmux list-panes -F "#{pane_index}: #{pane_current_command} (#{pane_pid})"
```

### Process Hung

```bash
# Send Ctrl+C
tmux send-keys -t 1 C-c

# If still unresponsive, force kill
tmux kill-pane -t 1
```

### Finding Panes

```bash
# List all panes with commands
tmux list-panes -F "#{pane_index}: #{pane_current_command}"

# Example output:
# 0: zsh
# 1: python3
# 2: claude
```
