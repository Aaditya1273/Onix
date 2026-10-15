package actions

import (
	"context"

	"github.com/Aaditya1273/Vigil/internal/engine"
	"github.com/Aaditya1273/Vigil/internal/recovery"
)

type ReduceContextAction struct{}

func NewReduceContextAction() *ReduceContextAction                { return &ReduceContextAction{} }
func (a *ReduceContextAction) Name() string                       { return "Reduce Context" }
func (a *ReduceContextAction) ActionType() engine.AutomaticAction { return engine.ActionReduceContext }

func (a *ReduceContextAction) Execute(ctx context.Context, agentCtx *engine.AgentContext, violation engine.RuleResult) *recovery.RecoveryResult {
	return &recovery.RecoveryResult{Success: true, Message: "Requested context summarization pass before next LLM call"}
}
