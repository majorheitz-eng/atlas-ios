import { needsExplicitConfirmation } from '@/lib/safety/action-policy';

describe('needsExplicitConfirmation', () => {
  it.each([
    'Send this message to Alex',
    'Book the contractor for Friday',
    'Delete the inspection report',
    'Pay the invoice',
    'Unlock the front door',
  ])('requires confirmation for consequential request: %s', (request) => {
    expect(needsExplicitConfirmation(request)).toBe(true);
  });

  it.each([
    'What is on my calendar?',
    'Summarize the inspection report',
    'What is the weather?',
  ])('allows read-only request without app-level confirmation: %s', (request) => {
    expect(needsExplicitConfirmation(request)).toBe(false);
  });
});
