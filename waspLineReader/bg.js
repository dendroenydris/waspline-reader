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

chrome.tabs.onUpdated.addListener(async function(tabId, changeInfo, tab) {
	// Only inject when page has fully loaded
	if (changeInfo.status !== 'complete') return;
	
	// Skip restricted URLs
	if (isRestrictedUrl(tab.url)) {
		return;
	}
	
	try {
		const result = await chrome.storage.local.get({
			color1: "#0000FF",
			color2: "#FF0000",
			color_text: "#000000",
			gradient_size: 50,
			enabled: false
		});
		
		// When the page loads, inject the content script
		await chrome.scripting.executeScript({
			target: { tabId: tabId },
			files: ["/contentScript.js"]
		});
		
		// Apply gradient to every new tab if addon is enabled
		if(result.enabled) {
			await chrome.tabs.sendMessage(tabId, {
				command: "apply_gradient",
				colors: [result.color1, result.color2],
				color_text: result.color_text,
				gradient_size: result.gradient_size
			});
		}
	} catch (error) {
		// Silently fail for pages where content scripts cannot be injected
		// This is expected for restricted pages
	}
}); 