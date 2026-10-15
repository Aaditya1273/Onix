package plugins

import (
	"fmt"

	"github.com/Aaditya1273/Vigil/internal/engine"
)

type InfiniteLoopDetector struct {
	MaxConsecutiveTools int
}

func NewInfiniteLoopDetector(max int) *InfiniteLoopDetector {
	return &InfiniteLoopDetector{MaxConsecutiveTools: max}
}

func (d *InfiniteLoopDetector) Name() string {
	return "Infinite Tool Loop"
}

func (d *InfiniteLoopDetector) Evaluate(ctx *engine.AgentContext) *engine.RuleResult {
	if len(ctx.Spans) < d.MaxConsecutiveTools {
		return nil
	}

	// A loop is the same call repeated, not the same tool used a lot: five
	// different shell commands in a row is ordinary work.
	key := func(s engine.TraceSpan) string {
		if s.Signature != "" {
			return s.Signature
		}
		return s.Name
	}
	consecutive := 1
	var lastKey, lastTool string

	// Iterate backwards over spans to find repeating tool calls.
	// Skip non-tool spans (LLM, chain) to account for interleaved execution.
	for i := len(ctx.Spans) - 1; i >= 0; i-- {
		span := ctx.Spans[i]
		if span.Kind != "tool" {
			continue // Skip non-tool spans, don't break (interleaved execution)
		}

		if lastKey == "" {
			lastKey, lastTool = key(span), span.Name
			consecutive = 1
		} else if key(span) == lastKey {
			consecutive++
			if consecutive >= d.MaxConsecutiveTools {
				return &engine.RuleResult{
					RuleName:          d.Name(),
					Severity:          engine.SeverityCritical,
					Reason:            fmt.Sprintf("Agent made the same %s call %d times consecutively.", lastTool, consecutive),
					RecommendedAction: "Review agent prompt instructions to ensure proper tool output parsing.",
					AutomaticAction:   engine.ActionKillRun,
				}
			}
		} else {
			break // Different tool encountered — loop broken
		}
	}

	return nil
}
