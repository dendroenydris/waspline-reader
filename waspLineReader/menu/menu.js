'use strict';
// Define references to DOM elements
const color1 = document.getElementById('color1');
const color2 = document.getElementById('color2');
const color_text = document.getElementById('color_text');
const gradient_size = document.getElementById('gradient_size');
const enabled = document.getElementById('enabled');
const popupContent = document.getElementById('popup-content');
const errorContent = document.getElementById('error-content');

// Check if URL is restricted (cannot inject content scripts)
function isRestrictedUrl(url) {
	if (!url) return true;
	return url.startsWith('chrome://') ||
		url.startsWith('chrome-extension://') ||
		url.startsWith('edge://') ||
		url.startsWith('about:') ||
		url.startsWith('moz-extension://') ||
		url.startsWith('file://') ||
		url.startsWith('devtools://') ||
		url.startsWith('view-source:') ||
		url.startsWith('data:');
}

// Show error message for restricted pages
function showRestrictedPageError() {
	if (popupContent) popupContent.classList.add('hidden');
	if (errorContent) errorContent.classList.remove('hidden');
}

// Show normal popup content
function showNormalContent() {
	if (popupContent) popupContent.classList.remove('hidden');
	if (errorContent) errorContent.classList.add('hidden');
}

// Inject content script if not already injected
async function ensureContentScriptInjected(tabId) {
	try {
		// Try to send a ping message to check if content script is already injected
		await chrome.tabs.sendMessage(tabId, { command: "ping" });
	} catch (error) {
		// Content script not injected, inject it now
		await chrome.scripting.executeScript({
			target: { tabId: tabId },
			files: ["/contentScript.js"]
		});
		// Small delay to ensure script is ready
		await new Promise(resolve => setTimeout(resolve, 100));
	}
}

// Listen for clicks on the input elements, and send the appropriate message
// to the content script in the page.
async function eventHandler(e) {
	// Send message to content script to color lines
	async function apply_gradient(tabs) {
		if (!tabs || tabs.length === 0) return;
		const tab = tabs[0];
		
		// Check if this is a restricted URL
		if (isRestrictedUrl(tab.url)) {
			showRestrictedPageError();
			return;
		}
		
		try {
			// Ensure content script is injected before sending message
			await ensureContentScriptInjected(tab.id);
			await chrome.tabs.sendMessage(tab.id, {
				command: "apply_gradient",
				colors: [color1.value, color2.value],
				color_text: color_text.value,
				gradient_size: gradient_size.value
			});
		} catch (error) {
			console.error('Error applying gradient:', error);
			showRestrictedPageError();
		}
	}

	// Send message to content script to reset lines
	async function reset(tabs) {
		if (!tabs || tabs.length === 0) return;
		const tab = tabs[0];
		
		// Check if this is a restricted URL
		if (isRestrictedUrl(tab.url)) {
			showRestrictedPageError();
			return;
		}
		
		try {
			// Ensure content script is injected before sending message
			await ensureContentScriptInjected(tab.id);
			await chrome.tabs.sendMessage(tab.id, {
				command: "reset",
				color_text: color_text.value
			});
		} catch (error) {
			console.error('Error resetting:', error);
		}
	}

	// Store attributes into local storage
	await chrome.storage.local.set({
		color1: color1.value,
		color2: color2.value,
		color_text: color_text.value,
		gradient_size: gradient_size.value,
		enabled: enabled.checked,
	});

	// Dispatch depending on checkbox enabled state
	try {
		const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
		if (enabled.checked) {
			await apply_gradient(tabs);
		} else {
			await reset(tabs);
		}
	} catch (error) {
		console.error('Error handling event:', error);
	}
}

// Check current page on popup open
async function checkCurrentPage() {
	try {
		const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
		if (tabs && tabs.length > 0 && isRestrictedUrl(tabs[0].url)) {
			showRestrictedPageError();
		} else {
			showNormalContent();
		}
	} catch (error) {
		console.error('Error checking current page:', error);
	}
}

// Run check when popup opens
checkCurrentPage();

// Load settings from local storage, or use these defaults
chrome.storage.local.get({
	color1: "#0000FF",
	color2: "#FF0000",
	color_text: "#000000",
	gradient_size: 50,
	enabled: false
}).then(function(result) {
	color1.value = result.color1;
	color2.value = result.color2;
	color_text.value = result.color_text;
	gradient_size.value = result.gradient_size;
	enabled.checked = result.enabled;
});

// Register event listeners to update page when options change
document.getElementById("enabled").addEventListener("change", eventHandler);
document.getElementById("gradient_size").addEventListener("change", eventHandler);
document.getElementById("color1").addEventListener("change", eventHandler);
document.getElementById("color2").addEventListener("change", eventHandler);
document.getElementById("color_text").addEventListener("change", eventHandler);