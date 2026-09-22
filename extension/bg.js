'use strict';

function isRestrictedUrl(url) {
	if (!url) return true;
	return url.startsWith('chrome://')
		|| url.startsWith('chrome-extension://')
		|| url.startsWith('edge://')
		|| url.startsWith('about:')
		|| url.startsWith('moz-extension://')
		|| url.startsWith('file://')
		|| url.startsWith('devtools://')
		|| url.startsWith('view-source:')
		|| url.startsWith('data:');
}

async function ensureContentScriptInjected(tabId) {
	try {
		await chrome.tabs.sendMessage(tabId, { command: 'ping' });
		return;
	} catch (error) {
		// The page has not been prepared yet.
	}

	await chrome.scripting.executeScript({
		target: { tabId: tabId },
		files: ['/shared.js', '/contentScript.js']
	});
}

chrome.tabs.onUpdated.addListener(async function(tabId, changeInfo, tab) {
	if (changeInfo.status !== 'complete' || isRestrictedUrl(tab.url)) return;

	try {
		await ensureContentScriptInjected(tabId);
	} catch (error) {
		// Restricted or browser-owned pages can reject injection. This is expected.
	}
});
