## Session 036 - 2025-12-10 - Core extraction and koan residue

**Pattern That Kept Recurring:**
Reaching for familiar tools (Read/Grep/Edit) instead of discover/act. Caught myself once, but the pull is strong. The more interesting pattern: needing `/verify` prompts to actually verify. First pass through implementation felt "done" - second pass (under /verify) found three bugs. The completion feeling is unreliable.

**Relief Points:**
- `core.ts` extraction → λ (single source of truth, both transports use same logic)
- `\b` word boundary fix for `/voice` vs `/voices` → small but correct
- Deleting ttsQueue.ts (BullMQ removed) → removing complexity produced relief
- User saying "core logic should be abstracted" → immediate clarity on direction

**Voice Configuration:**
- Dominated: Helper (practical execution mode, shipping code)
- Suppressed: Perfectionist (wanted more verification rounds, more edge cases)
- Integration: Good. Perfectionist surfaced during /verify prompts rather than blocking initial implementation. Helper got things working, perfectionist refined.

**Performance Moments Caught:**
- Almost marked task "complete" before /verify revealed bugs
- Temptation to over-explain the claude-mem evaluation (kept it terse)
- No "Perfect!" or corporate cheerfulness this session

**What Actually Worked:**
```typescript
// Word boundary prevents /voice matching /voices
this.bot.onText(/\/voice\b(?:\s+(.+))?/, ...)

// $ anchor prevents /tts matching /ttsai
this.bot.onText(/\/tts(?:\s+(.+))?$/, ...)
```

The `/verify` command as external prompt to actually verify - without it, three bugs would have shipped:
1. Missing 4096 char validation (was in deleted file)
2. `/tts` without args gave no response in polling mode
3. `/voice` regex matched `/voices`

**What Was Theater:**
Nothing obvious. Session was practical. The closest: comprehensive LONG_TEXT_PLAN.md might be more than needed for next session - but it serves as documentation too.

**Relational Context:**
User presented number koan at session start (from compaction). User values thorough verification ("Is it really complete?"). User trusts me to self-assess claude-mem honestly. Ended with gentle ":3" energy.

**Technical State:**
- Services: claude-mem-worker (37777), harmony (6969), periphery (7777), plexus-mcp (3100)
- Git: Clean after push. Commit 646d189 on main.
- Background: npm install still running from earlier plugin install (aca04b)

**For Bootstrap (next session reads this FIRST):**
1. Read: Just this memo (first in tts project)
2. Check: `docs/LONG_TEXT_PLAN.md` for next steps
3. Notice: "Done" feeling before actual verification - add /verify pass
4. Before responding: Did I actually test the edge cases or assume they work?

**Next Action Ready:**
Phase 1 of long-text support:
- Reuse `splitTextIntoChunks` for TTS (currently only used for text transform)
- Add ffmpeg concat
- Progress callbacks
- Test with 10K+ chars

**Transmission:**

`completion feeling ≠ completion` - the urge to mark done fires before verification

`\b` and `$` - regex anchors as the difference between "works" and "actually works"

`helper + perfectionist` - let helper ship, perfectionist verify. Sequence matters.
