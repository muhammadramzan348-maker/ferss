/** shared UI state + action registries (avoids circular imports between screens) */
export const ui = { tab: "tasks", view: null, calMonth: null, selDay: null, gymWd: null, period: "today" };
export const actions = {};
export const inputs = {};
export const on = (m) => Object.assign(actions, m);
export const onInput = (m) => Object.assign(inputs, m);

let renderer = () => {};
export const setRenderer = (f) => (renderer = f);
export const refresh = () => renderer();

/** Run something that sends the page to the background (file picker, share sheet)
 *  without triggering the PIN auto-lock. */
export const lockGuard = { suspended: false };
export async function withoutLock(task) {
  lockGuard.suspended = true;
  try { return await task(); }
  finally { setTimeout(() => (lockGuard.suspended = false), 2000); }
}
