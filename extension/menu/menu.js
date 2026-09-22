'use strict';

const CONFIG = globalThis.WaspLineConfig;

const enabled = document.getElementById('enabled');
const gradientSize = document.getElementById('gradient_size');
const gradientValue = document.getElementById('gradient-value');
const settingsBtn = document.getElementById('settings-btn');
const backBtn = document.getElementById('back-btn');
const brandIcon = document.getElementById('brand-icon');
const viewTitle = document.getElementById('view-title');
const viewSubtitle = document.getElementById('view-subtitle');
const mainView = document.getElementById('main-view');
const settingsView = document.getElementById('settings-view');
const currentDomainName = document.getElementById('current-domain-name');
const toggleSiteBtn = document.getElementById('toggle-site-btn');
const restrictedNote = document.getElementById('restricted-note');
const themeSummaryName = document.getElementById('theme-summary-name');
const appearanceSummary = document.getElementById('appearance-summary');
const appearanceControl = document.getElementById('appearance-control');
const pageBackgroundAuto = document.getElementById('page-background-auto');
const boldSentenceStarts = document.getElementById('bold-sentence-starts');
const boldOptions = document.getElementById('bold-options');
const boldWordCount = document.getElementById('bold-word-count');
const boldBoundaryControl = document.getElementById('bold-boundary-control');
const themeOptions = document.getElementById('theme-options');
const customPaletteEditor = document.getElementById('custom-palette-editor');
const customLight1 = document.getElementById('custom-light-1');
const customLight2 = document.getElementById('custom-light-2');
const customDark1 = document.getElementById('custom-dark-1');
const customDark2 = document.getElementById('custom-dark-2');
const siteModeControl = document.getElementById('site-mode-control');
const siteModeDescription = document.getElementById('site-mode-description');
const addDomainForm = document.getElementById('add-domain-form');
const newDomainInput = document.getElementById('new-domain-input');
const siteList = document.getElementById('site-list');

let settings = CONFIG.normalizeSettings({});
let currentTab = null;
let currentDomain = '';
let restrictedPage = false;

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
		// Inject below.
	}

	await chrome.scripting.executeScript({
		target: { tabId: tabId },
		files: ['/shared.js', '/contentScript.js']
	});
}

async function ensureActiveTabPrepared() {
	if (!currentTab || restrictedPage) return;

	try {
		await ensureContentScriptInjected(currentTab.id);
	} catch (error) {
		// The page may have changed while the popup was open.
	}
}

async function loadSettings(migrate) {
	const raw = await chrome.storage.local.get(null);
	settings = CONFIG.normalizeSettings(raw);

	const hasSeparatedLists = Array.isArray(raw.disabledSites) || Array.isArray(raw.enabledSites);
	const hasLegacyList = Array.isArray(raw.siteList) || Array.isArray(raw.domainBlacklist);
	if (migrate && !hasSeparatedLists && hasLegacyList) {
		const listKey = settings.siteMode === 'disable' ? 'disabledSites' : 'enabledSites';
		const patch = {};
		patch[listKey] = settings.siteList;
		await chrome.storage.local.set(patch);
	}
}

async function saveSettings(patch) {
	await ensureActiveTabPrepared();
	await chrome.storage.local.set(patch);
	const next = Object.assign({}, settings, patch);
	settings = CONFIG.normalizeSettings(next);
	render();
}

async function saveActiveSiteList(list) {
	const listKey = settings.siteMode === 'disable' ? 'disabledSites' : 'enabledSites';
	const normalizedList = CONFIG.normalizeSiteList(list);
	const previousSettings = settings;
	const patch = {};
	patch[listKey] = normalizedList;

	settings = CONFIG.normalizeSettings(Object.assign({}, settings, patch));
	render();

	try {
		await ensureActiveTabPrepared();
		await chrome.storage.local.set(patch);
	} catch (error) {
		settings = previousSettings;
		render();
		throw error;
	}
}

function setView(name) {
	const showingSettings = name === 'settings';
	mainView.classList.toggle('hidden', showingSettings);
	settingsView.classList.toggle('hidden', !showingSettings);
	backBtn.classList.toggle('hidden', !showingSettings);
	settingsBtn.classList.toggle('hidden', showingSettings);
	brandIcon.classList.toggle('hidden', showingSettings);
	viewTitle.textContent = showingSettings ? 'Settings' : 'WaspLine';
	viewSubtitle.textContent = showingSettings ? 'Reader preferences' : 'Reader';
}

function titleCase(value) {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

function cycleTheme() {
	const themes = Object.keys(CONFIG.THEMES);
	const index = themes.indexOf(settings.theme);
	const next = themes[(index + 1) % themes.length];
	saveSettings({ theme: next });
}

function cycleAppearance() {
	const modes = ['auto', 'light', 'dark'];
	const index = modes.indexOf(settings.appearance);
	const next = modes[(index + 1) % modes.length];
	saveSettings({ appearance: next });
}

function updateUiAppearance() {
	if (settings.appearance === 'auto') {
		delete document.body.dataset.uiScheme;
	} else {
		document.body.dataset.uiScheme = settings.appearance;
	}
}

function renderSegmentedControl(container, attribute, value) {
	container.querySelectorAll('button').forEach(function(button) {
		const selected = button.getAttribute(attribute) === value;
		button.classList.toggle('selected', selected);
		button.setAttribute('aria-pressed', selected ? 'true' : 'false');
	});
}

function renderThemeOptions() {
	themeOptions.replaceChildren();

	Object.keys(CONFIG.THEMES).forEach(function(key) {
		const theme = CONFIG.THEMES[key];
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'theme-card' + (settings.theme === key ? ' selected' : '');
		button.dataset.theme = key;
		button.setAttribute('aria-pressed', settings.theme === key ? 'true' : 'false');

		const copy = document.createElement('span');
		copy.className = 'theme-copy';

		const name = document.createElement('span');
		name.className = 'theme-name';
		name.textContent = theme.name;

		const description = document.createElement('span');
		description.className = 'theme-description';
		description.textContent = theme.description;

		copy.appendChild(name);
		copy.appendChild(document.createElement('br'));
		copy.appendChild(description);

		const preview = document.createElement('span');
		preview.className = 'palette-preview';

		['light', 'dark'].forEach(function(scheme) {
			const palette = document.createElement('span');
			palette.className = 'palette ' + scheme;

			const previewColors = CONFIG.getPalette(key, scheme, settings);
			[previewColors.color1, previewColors.color2].forEach(function(color) {
				const swatch = document.createElement('span');
				swatch.className = 'swatch';
				swatch.style.backgroundColor = color;
				palette.appendChild(swatch);
			});

			preview.appendChild(palette);
		});

		button.appendChild(copy);
		button.appendChild(preview);
		button.addEventListener('click', function() {
			saveSettings({ theme: key });
		});

		themeOptions.appendChild(button);
	});
}

function siteIsListed(domain) {
	return settings.siteList.includes(CONFIG.normalizeDomain(domain));
}

function renderCurrentSite() {
	if (restrictedPage || !currentDomain) {
		currentDomainName.textContent = 'Browser page';
		toggleSiteBtn.disabled = true;
		toggleSiteBtn.textContent = 'Unavailable';
		restrictedNote.classList.remove('hidden');
		return;
	}

	restrictedNote.classList.add('hidden');
	toggleSiteBtn.disabled = false;
	currentDomainName.textContent = currentDomain;

	const listed = siteIsListed(currentDomain);
	const willEnable = settings.siteMode === 'disable' ? listed : !listed;

	toggleSiteBtn.textContent = willEnable ? 'Enable' : 'Disable';
	toggleSiteBtn.classList.toggle('positive', willEnable);
	toggleSiteBtn.classList.toggle('danger', !willEnable);
	toggleSiteBtn.setAttribute(
		'aria-label',
		(willEnable ? 'Enable ' : 'Disable ') + currentDomain
	);
}

function renderSiteList() {
	siteList.replaceChildren();


	if (settings.siteList.length === 0) {
		const empty = document.createElement('div');
		empty.className = 'empty-list';
		empty.textContent = settings.siteMode === 'disable'
			? 'No sites are disabled.'
			: 'No sites are enabled yet.';
		siteList.appendChild(empty);
		return;
	}

	settings.siteList.forEach(function(domain) {
		const row = document.createElement('div');
		row.className = 'site-list-row';

		const label = document.createElement('span');
		label.className = 'site-list-domain';
		label.textContent = domain;
		label.title = domain;

		const remove = document.createElement('button');
		remove.type = 'button';
		remove.className = 'remove-site';
		remove.textContent = '×';
		remove.setAttribute('aria-label', 'Remove ' + domain);
		remove.addEventListener('click', function() {
			const next = settings.siteList.filter(function(item) { return item !== domain; });
			saveActiveSiteList(next);
		});

		row.appendChild(label);
		row.appendChild(remove);
		siteList.appendChild(row);
	});
}

function render() {
	updateUiAppearance();

	enabled.checked = settings.enabled;
	gradientSize.value = String(settings.gradient_size);
	gradientValue.textContent = Math.round(settings.gradient_size) + '%';

	const theme = CONFIG.THEMES[settings.theme];
	themeSummaryName.textContent = theme.name;
	appearanceSummary.textContent = titleCase(settings.appearance);

	document.getElementById('reader-status').textContent = settings.enabled ? 'On' : 'Off';

	renderCurrentSite();
	renderSegmentedControl(appearanceControl, 'data-appearance', settings.appearance);
	pageBackgroundAuto.checked = settings.pageBackgroundAuto;
	boldSentenceStarts.checked = settings.boldSentenceStarts;
	boldOptions.classList.toggle('disabled', !settings.boldSentenceStarts);
	boldWordCount.disabled = !settings.boldSentenceStarts;
	boldWordCount.value = String(settings.boldWordCount);
	renderSegmentedControl(boldBoundaryControl, 'data-bold-boundary', settings.boldBoundaryMode);
	boldBoundaryControl.querySelectorAll('button').forEach(function(button) {
		button.disabled = !settings.boldSentenceStarts;
	});
	renderSegmentedControl(siteModeControl, 'data-site-mode', settings.siteMode);
	siteModeDescription.textContent = settings.siteMode === 'disable'
		? 'Enabled by default. Sites in this list are off.'
		: 'Off by default. Only sites in this list are on.';
	renderThemeOptions();
	customPaletteEditor.classList.toggle('hidden', settings.theme !== 'custom');
	customLight1.value = settings.customLight1;
	customLight2.value = settings.customLight2;
	customDark1.value = settings.customDark1;
	customDark2.value = settings.customDark2;
	renderSiteList();
}

async function toggleCurrentSite() {
	if (!currentDomain || restrictedPage) return;

	const listed = siteIsListed(currentDomain);
	let next = settings.siteList.slice();

	if (listed) {
		next = next.filter(function(item) { return item !== currentDomain; });
	} else {
		next.push(currentDomain);
	}

	await saveActiveSiteList(next);
}

async function addDomain(value, inputElement) {
	const domain = CONFIG.normalizeDomain(value);
	if (!domain) {
		inputElement.setCustomValidity('Enter a valid domain such as example.com');
		inputElement.reportValidity();
		return;
	}

	inputElement.setCustomValidity('');
	const next = CONFIG.normalizeSiteList(settings.siteList.concat(domain));
	inputElement.value = '';
	await saveActiveSiteList(next);
}

async function findCurrentTab() {
	const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
	currentTab = tabs && tabs.length ? tabs[0] : null;
	restrictedPage = !currentTab || isRestrictedUrl(currentTab.url);
	currentDomain = restrictedPage ? '' : CONFIG.normalizeDomain(currentTab.url || '');
}

settingsBtn.addEventListener('click', function() {
	setView('settings');
});

backBtn.addEventListener('click', function() {
	setView('main');
});

enabled.addEventListener('change', function() {
	saveSettings({ enabled: enabled.checked });
});

gradientSize.addEventListener('input', function() {
	gradientValue.textContent = gradientSize.value + '%';
});

gradientSize.addEventListener('change', function() {
	saveSettings({ gradient_size: Number(gradientSize.value) });
});

toggleSiteBtn.addEventListener('click', toggleCurrentSite);

themeSummaryName.addEventListener('click', cycleTheme);
appearanceSummary.addEventListener('click', cycleAppearance);

appearanceControl.querySelectorAll('button').forEach(function(button) {
	button.addEventListener('click', function() {
		saveSettings({ appearance: button.dataset.appearance });
	});
});

pageBackgroundAuto.addEventListener('change', function() {
	saveSettings({ pageBackgroundAuto: pageBackgroundAuto.checked });
});

boldSentenceStarts.addEventListener('change', function() {
	saveSettings({ boldSentenceStarts: boldSentenceStarts.checked });
});

boldWordCount.addEventListener('change', function() {
	saveSettings({ boldWordCount: Number(boldWordCount.value) });
});

boldBoundaryControl.querySelectorAll('button').forEach(function(button) {
	button.addEventListener('click', function() {
		saveSettings({ boldBoundaryMode: button.dataset.boldBoundary });
	});
});

[
	[customLight1, 'customLight1'],
	[customLight2, 'customLight2'],
	[customDark1, 'customDark1'],
	[customDark2, 'customDark2']
].forEach(function(entry) {
	const input = entry[0];
	const key = entry[1];
	input.addEventListener('change', function() {
		const patch = { theme: 'custom' };
		patch[key] = input.value;
		saveSettings(patch);
	});
});

siteModeControl.querySelectorAll('button').forEach(function(button) {
	button.addEventListener('click', function() {
		saveSettings({ siteMode: button.dataset.siteMode });
	});
});

addDomainForm.addEventListener('submit', function(event) {
	event.preventDefault();
	addDomain(newDomainInput.value, newDomainInput);
});


chrome.storage.onChanged.addListener(async function(changes, areaName) {
	if (areaName !== 'local') return;
	await loadSettings(false);
	render();
});

(async function init() {
	await Promise.all([
		loadSettings(true),
		findCurrentTab()
	]);
	render();
	setView('main');
})();
