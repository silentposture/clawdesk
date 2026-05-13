export interface ErgonomicsCheck {
  id: string;
  taskName: string;
  viewport: "desktop" | "small-window";
  steps: number;
  keyboardReachable: boolean;
  noTextOverflow: boolean;
  tooltipCoverage: number;
  riskPromptCoverage: boolean;
  score: number;
}

export function scoreErgonomicsCheck(check: Omit<ErgonomicsCheck, "score">): ErgonomicsCheck {
  const stepScore = Math.max(0, 100 - Math.max(0, check.steps - 4) * 8);
  const keyboardScore = check.keyboardReachable ? 100 : 45;
  const overflowScore = check.noTextOverflow ? 100 : 30;
  const tooltipScore = Math.round(check.tooltipCoverage * 100);
  const riskScore = check.riskPromptCoverage ? 100 : 50;
  const score = Math.round((stepScore + keyboardScore + overflowScore + tooltipScore + riskScore) / 5);
  return { ...check, score };
}

export function aggregateErgonomicsScore(checks: ErgonomicsCheck[]): number {
  if (!checks.length) return 0;
  return Math.round(checks.reduce((sum, check) => sum + check.score, 0) / checks.length);
}
