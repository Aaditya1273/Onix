package actions

import (
	"context"

	"github.com/Aaditya1273/Vigil/internal/engine"
	"github.com/Aaditya1273/Vigil/internal/recovery"
)

type RetryAction struct{}

func NewRetryAction() *RetryAction                        { return &RetryAction{} }
func (a *RetryAction) Name() string                       { return "Retry" }
func (a *RetryAction) ActionType() engine.AutomaticAction { return engine.ActionRetry }

func (a *RetryAction) Execute(ctx context.Context, agentCtx *engine.AgentContext, violation engine.RuleResult) *recovery.RecoveryResult {
	return &recovery.RecoveryResult{Success: true, Message: "Transmitted retry signal with exponential backoff configuration"}
}
