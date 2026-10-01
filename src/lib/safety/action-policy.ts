const CONSEQUENTIAL_ACTION =
  /\b(send|message|email|call|book|schedule|cancel|delete|remove|pay|purchase|buy|order|approve|sign|unlock|lock|open|close|post|publish|share|transfer)\b/i;

export function needsExplicitConfirmation(request: string): boolean {
  return CONSEQUENTIAL_ACTION.test(request);
}
