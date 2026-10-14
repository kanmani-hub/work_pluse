/**
 * Employee break START / END from the dashboard: run the action, then ALWAYS reload attendance.
 *
 * A START or END can partly succeed (e.g. the break was created but the attendance status could
 * not be saved), so the screen is reloaded after every attempt, success or error. The original
 * break error is shown as it is; a failed reload is reported separately. No other messages: the
 * screen itself shows the new state, so there is no success alert.
 */
export interface BreakActionOutcome {
  message: string | null;   // what to show the employee (null = nothing to show)
  operationFailed: boolean; // the START / END returned or threw an error
  refreshed: boolean;       // attendance was reloaded successfully
}

export const REFRESH_FAILED_MESSAGE = 'The screen could not be refreshed. Please reload the page to see your current break status.';

export async function runBreakAction(
  action: () => Promise<{ error: Error | null }>,
  refresh: () => Promise<boolean>,
): Promise<BreakActionOutcome> {
  let opError: string | null = null;
  try {
    const res = await action();
    if (res?.error) opError = res.error.message || 'The break could not be saved.';
  } catch (e: any) {
    opError = e?.message || 'The break could not be saved.';
  }
  let refreshed = false;
  try { refreshed = await refresh(); } catch { refreshed = false; }
  const parts = [opError, refreshed ? null : REFRESH_FAILED_MESSAGE].filter(Boolean) as string[];
  return { message: parts.length ? parts.join('\n\n') : null, operationFailed: opError !== null, refreshed };
}
