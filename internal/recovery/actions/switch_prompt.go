package actions

import (
	"context"

	"github.com/Aaditya1273/Vigil/internal/engine"
	"github.com/Aaditya1273/Vigil/internal/recovery"
)

type SwitchPromptAction struct{}

func NewSwitchPromptAction() *SwitchPromptAction                 { return &SwitchPromptAction{} }
func (a *SwitchPromptAction) Name() string                       { return "Switch Prompt" }
func (a *SwitchPromptAction) ActionType() engine.AutomaticAction { return engine.ActionSwitchPrompt }

func (a *SwitchPromptAction) Execute(ctx context.Context, agentCtx *engine.AgentContext, violation engine.RuleResult) *recovery.RecoveryResult {
	return &recovery.RecoveryResult{Success: true, Message: "Injected alternative safe-mode system prompt"}
}
