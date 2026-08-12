/* global chrome */
/**
 * Collects run reports from the content script so you can see, in one place, what was
 * filled, what was refused, and what was actually submitted.
 *
 * Deliberately dumb. The service worker gets killed by MV3 whenever Chrome feels like
 * it, so nothing important is kept in memory here -- reports go straight to storage.
 */

const MAX_REPORTS = 200;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'bamboo:report') return;
  chrome.storage.local.get(['reports']).then(({ reports }) => {
    const next = [{ at: Date.now(), ...msg.report }, ...(reports ?? [])].slice(0, MAX_REPORTS);
    chrome.storage.local.set({ reports: next });
    const refused = msg.report.refusals?.length ?? 0;
    if (refused) {
      chrome.action.setBadgeText({ text: String(refused) });
      chrome.action.setBadgeBackgroundColor({ color: '#b00020' });
    }
  });
});
