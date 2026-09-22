(function() {
'use strict';

const CONFIG = globalThis.WaspLineConfig;
if (!CONFIG) return;

const MAX_PARAGRAPHS = 300;
const BATCH_SIZE = 20;
const DYNAMIC_BATCH_SIZE = 8;
const VIEWPORT_MARGIN = 900;
const GRADIENT_STEPS = 10;
const colorCache = new Map();
const systemAppearance = window.matchMedia('(prefers-color-scheme: dark)');
const wordSegmenter = globalThis.Intl && Intl.Segmenter
	? new Intl.Segmenter(undefined, { granularity: 'word' })
	: null;

let isProcessing = false;
let refreshQueued = false;
let refreshTimer = null;
let latestSettings = null;
let contentRefreshTimer = null;
let viewportRefreshTimer = null;
let lastViewportSignature = '';
const pendingParagraphs = new Set();

const EDITABLE_SELECTOR = [
	'input',
	'textarea',
	'select',
	'[contenteditable]:not([contenteditable="false"])',
	'[role="textbox"]',
	'.ProseMirror',
	'.CodeMirror',
	'.monaco-editor'
].join(',');

function isEditableRegion(element) {
	if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
	return Boolean(
		element.closest(EDITABLE_SELECTOR)
		|| element.querySelector(EDITABLE_SELECTOR)
	);
}

function targetParagraphs() {
	return Array.from(
		document.querySelectorAll('p, article p, main p, .content p, .post p, .article p')
	).filter(function(paragraph) {
		return !isEditableRegion(paragraph);
	});
}

function hex_to_rgb(hex) {
	if (colorCache.has(hex)) return colorCache.get(hex);
	const result = [
		parseInt(hex.slice(1, 3), 16),
		parseInt(hex.slice(3, 5), 16),
		parseInt(hex.slice(5, 7), 16)
	];
	colorCache.set(hex, result);
	return result;
}

function computeGradientColors(baseColor, activeColor, steps, gradientSize) {
	const colors = new Array(steps);
	const factor = gradientSize / 50;

	for (let i = 0; i < steps; i++) {
		const t = 1 - (i / ((steps - 1) * factor || 1));
		const r = (baseColor[0] * (1 - t) + activeColor[0] * t) | 0;
		const g = (baseColor[1] * (1 - t) + activeColor[1] * t) | 0;
		const b = (baseColor[2] * (1 - t) + activeColor[2] * t) | 0;
		colors[i] = 'rgb(' + r + ',' + g + ',' + b + ')';
	}
	return colors;
}

function rememberOriginalColor(span) {
	if (!span.hasAttribute('data-waspline-original-color')) {
		span.setAttribute('data-waspline-original-color', span.style.color || '');
	}
	span.setAttribute('data-waspline-colorized', 'true');
}

function colorLine(spans, gradientColors, reverse) {
	const len = spans.length;
	const colorLen = gradientColors.length;

	for (let i = 0; i < len; i++) {
		const idx = reverse ? len - 1 - i : i;
		const colorIdx = Math.min(Math.floor(i * colorLen / len), colorLen - 1);
		const span = spans[idx];
		rememberOriginalColor(span);
		span.style.color = gradientColors[colorIdx];
	}
}

function restoreOriginalColors() {
	document.querySelectorAll('.js-detect-wrap[data-waspline-colorized]').forEach(function(span) {
		const original = span.getAttribute('data-waspline-original-color') || '';
		if (original) {
			span.style.color = original;
		} else {
			span.style.removeProperty('color');
		}
		span.removeAttribute('data-waspline-colorized');
	});
}

function rememberOriginalWeight(span) {
	if (!span.hasAttribute('data-waspline-original-weight')) {
		span.setAttribute('data-waspline-original-weight', span.style.fontWeight || '');
	}
	span.setAttribute('data-waspline-sentence-bold', 'true');
}

function restoreSentenceBold() {
	document.querySelectorAll('.js-detect-wrap[data-waspline-sentence-bold]').forEach(function(span) {
		const original = span.getAttribute('data-waspline-original-weight') || '';
		if (original) {
			span.style.fontWeight = original;
		} else {
			span.style.removeProperty('font-weight');
		}
		span.removeAttribute('data-waspline-sentence-bold');
	});
}

function restoreOriginalStyling() {
	restoreOriginalColors();
	restoreSentenceBold();
}

function markSpanRangeBold(spans, offsets, start, end) {
	for (let i = 0; i < spans.length; i++) {
		const spanStart = offsets[i];
		const spanEnd = spanStart + (spans[i].textContent || '').length;
		if (spanEnd <= start || spanStart >= end) continue;
		rememberOriginalWeight(spans[i]);
		spans[i].style.fontWeight = '700';
	}
}

function wordRanges(text) {
	if (wordSegmenter) {
		return Array.from(wordSegmenter.segment(text))
			.filter(function(segment) { return segment.isWordLike; })
			.map(function(segment) {
				return [segment.index, segment.index + segment.segment.length];
			});
	}

	const ranges = [];
	const matcher = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
	let match;
	while ((match = matcher.exec(text)) !== null) {
		ranges.push([match.index, match.index + match[0].length]);
	}
	return ranges;
}

function applySentenceStartBold(wordCount, boundaryMode) {
	applySentenceStartBoldToParagraphs(targetParagraphs(), wordCount, boundaryMode);
}

function processBatch(paragraphs, startIdx, colors, baseColor, gradientSize, lineno, resolve) {
	const endIdx = Math.min(startIdx + BATCH_SIZE, paragraphs.length);
	const activeColors = colors.map(function(color) { return hex_to_rgb(color); });

	for (let i = startIdx; i < endIdx; i++) {
		const paragraph = paragraphs[i];
		if (isEditableRegion(paragraph)) continue;
		if (!paragraph.textContent || paragraph.textContent.trim().length < 2) continue;

		try {
			const lines = lineWrapDetector.getLines(paragraph);
			for (const line of lines) {
				if (!line || line.length === 0) continue;

				const colorIdx = Math.floor(lineno / 2) % activeColors.length;
				const isLeft = (lineno % 2 === 0);
				const gradientColors = computeGradientColors(
					baseColor,
					activeColors[colorIdx],
					Math.min(line.length, GRADIENT_STEPS),
					gradientSize
				);
				colorLine(line, gradientColors, isLeft);
				lineno++;
			}
			paragraph.setAttribute('data-waspline-next-line', String(lineno));
		} catch (error) {
			// Skip paragraphs that cannot be measured safely.
		}
	}

	if (endIdx < paragraphs.length) {
		requestAnimationFrame(function() {
			processBatch(paragraphs, endIdx, colors, baseColor, gradientSize, lineno, resolve);
		});
	} else {
		resolve();
	}
}

function applyGradient(colors, colorText, gradientSize) {
	return new Promise(function(resolve) {
		const allParagraphs = targetParagraphs();
		if (allParagraphs.length === 0) {
			resolve();
			return;
		}

		const prioritized = prioritizeParagraphsForViewport(allParagraphs);
		const immediateParagraphs = prioritized.slice(0, DYNAMIC_BATCH_SIZE);
		const deferredParagraphs = prioritized.slice(DYNAMIC_BATCH_SIZE);

		deferredParagraphs.forEach(function(paragraph) {
			pendingParagraphs.add(paragraph);
		});

		const baseColor = hex_to_rgb(colorText);
		const runs = paragraphRunsInDocumentOrder(immediateParagraphs);
		let runIndex = 0;

		function processNextRun() {
			if (runIndex >= runs.length) {
				if (pendingParagraphs.size > 0) scheduleContentRefresh();
				resolve();
				return;
			}

			const run = runs[runIndex++];
			const startingLine = startingLineNumberForParagraph(run[0]);
			requestAnimationFrame(function() {
				processBatch(
					run,
					0,
					colors,
					baseColor,
					gradientSize,
					startingLine,
					processNextRun
				);
			});
		}

		processNextRun();
	});
}

function paragraphMatchesTarget(element) {
	return element
		&& element.nodeType === Node.ELEMENT_NODE
		&& element.matches
		&& element.matches('p, article p, main p, .content p, .post p, .article p')
		&& !isEditableRegion(element);
}

function nearestTargetParagraph(node) {
	let element = node && node.nodeType === Node.ELEMENT_NODE ? node : (node ? node.parentElement : null);
	while (element && element !== document.documentElement) {
		if (paragraphMatchesTarget(element)) return element;
		element = element.parentElement;
	}
	return null;
}

function collectTargetParagraphs(node, targetSet) {
	if (!node) return;

	if (node.nodeType === Node.TEXT_NODE) {
		const paragraph = nearestTargetParagraph(node);
		if (paragraph) targetSet.add(paragraph);
		return;
	}

	if (node.nodeType !== Node.ELEMENT_NODE) return;
	if (node.classList && node.classList.contains('js-detect-wrap')) return;
	if (node.matches && node.matches(EDITABLE_SELECTOR)) return;
	if (node.closest && node.closest(EDITABLE_SELECTOR)) return;

	if (paragraphMatchesTarget(node)) targetSet.add(node);
	if (node.querySelectorAll) {
		node.querySelectorAll('p, article p, main p, .content p, .post p, .article p').forEach(function(paragraph) {
			if (!isEditableRegion(paragraph)) targetSet.add(paragraph);
		});
	}

	const parentParagraph = nearestTargetParagraph(node);
	if (parentParagraph) targetSet.add(parentParagraph);
}

function applySentenceStartBoldToParagraphs(paragraphs, wordCount, boundaryMode) {
	const boundaryPattern = boundaryMode === 'clauses'
		? /[.!?。！？,;:，；：]/u
		: /[.!?。！？]/u;

	paragraphs.forEach(function(paragraph) {
		const spans = Array.from(paragraph.getElementsByClassName('js-detect-wrap'));
		if (!spans.length) return;

		spans.forEach(function(span) {
			if (!span.hasAttribute('data-waspline-sentence-bold')) return;
			const original = span.getAttribute('data-waspline-original-weight') || '';
			if (original) {
				span.style.fontWeight = original;
			} else {
				span.style.removeProperty('font-weight');
			}
			span.removeAttribute('data-waspline-sentence-bold');
		});

		const offsets = [];
		let text = '';
		spans.forEach(function(span) {
			offsets.push(text.length);
			text += span.textContent || '';
		});

		let segmentStart = 0;
		for (let index = 0; index <= text.length; index++) {
			const atEnd = index === text.length;
			const atBoundary = !atEnd && boundaryPattern.test(text[index]);
			if (!atEnd && !atBoundary) continue;

			const segmentEnd = atBoundary ? index : text.length;
			const segmentText = text.slice(segmentStart, segmentEnd);
			const ranges = wordRanges(segmentText).slice(0, wordCount);

			ranges.forEach(function(range) {
				markSpanRangeBold(
					spans,
					offsets,
					segmentStart + range[0],
					segmentStart + range[1]
				);
			});

			segmentStart = index + 1;
		}
	});
}

function startingLineNumberForParagraph(paragraph) {
	const allParagraphs = targetParagraphs();
	const index = allParagraphs.indexOf(paragraph);
	if (index <= 0) return 0;

	for (let i = index - 1; i >= 0; i--) {
		const value = allParagraphs[i].getAttribute('data-waspline-next-line');
		if (value !== null && Number.isFinite(Number(value))) {
			return Number(value);
		}
	}
	return 0;
}

function viewportPriority(paragraph) {
	const rect = paragraph.getBoundingClientRect();
	const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

	if (rect.bottom >= -VIEWPORT_MARGIN && rect.top <= viewportHeight + VIEWPORT_MARGIN) {
		const center = (rect.top + rect.bottom) / 2;
		const viewportCenter = viewportHeight / 2;
		return Math.abs(center - viewportCenter);
	}

	if (rect.bottom < -VIEWPORT_MARGIN) {
		return viewportHeight * 10 + Math.abs(rect.bottom);
	}

	return viewportHeight * 10 + Math.abs(rect.top - viewportHeight);
}

function prioritizeParagraphsForViewport(paragraphs) {
	return paragraphs.slice().sort(function(a, b) {
		return viewportPriority(a) - viewportPriority(b);
	});
}

function paragraphRunsInDocumentOrder(paragraphs) {
	const allParagraphs = targetParagraphs();
	const indexMap = new Map();
	allParagraphs.forEach(function(paragraph, index) {
		indexMap.set(paragraph, index);
	});

	const ordered = Array.from(new Set(paragraphs))
		.filter(function(paragraph) { return indexMap.has(paragraph); })
		.sort(function(a, b) { return indexMap.get(a) - indexMap.get(b); });

	const runs = [];
	let currentRun = [];
	let previousIndex = -2;

	ordered.forEach(function(paragraph) {
		const index = indexMap.get(paragraph);
		if (currentRun.length > 0 && index !== previousIndex + 1) {
			runs.push(currentRun);
			currentRun = [];
		}
		currentRun.push(paragraph);
		previousIndex = index;
	});

	if (currentRun.length > 0) runs.push(currentRun);
	return runs;
}

function processParagraphSubset(paragraphs, settings) {
	if (!paragraphs.length || !settings) return Promise.resolve();

	const allowedHere = CONFIG.shouldRunOnDomain(currentDomain(), settings);
	if (!settings.enabled || !allowedHere) return Promise.resolve();

	const style = resolveEffectiveStyle(settings);
	const baseColor = hex_to_rgb(style.text);
	const prioritized = prioritizeParagraphsForViewport(paragraphs);
	const batches = [];
	for (let i = 0; i < prioritized.length; i += DYNAMIC_BATCH_SIZE) {
		batches.push(prioritized.slice(i, i + DYNAMIC_BATCH_SIZE));
	}

	return new Promise(function(resolve) {
		let batchIndex = 0;

		function processNextBatch() {
			if (batchIndex >= batches.length) {
				resolve();
				return;
			}

			const batch = batches[batchIndex++];
			const runs = paragraphRunsInDocumentOrder(batch);
			let runIndex = 0;

			function processNextRun() {
				if (runIndex >= runs.length) {
					if (settings.boldSentenceStarts) {
						applySentenceStartBoldToParagraphs(
							batch,
							settings.boldWordCount,
							settings.boldBoundaryMode
						);
					}
					processNextBatch();
					return;
				}

				const run = runs[runIndex++];
				const startingLine = startingLineNumberForParagraph(run[0]);
				requestAnimationFrame(function() {
					processBatch(
						run,
						0,
						style.colors,
						baseColor,
						style.gradientSize,
						startingLine,
						processNextRun
					);
				});
			}

			processNextRun();
		}

		processNextBatch();
	});
}

function scheduleContentRefresh() {
	if (contentRefreshTimer) clearTimeout(contentRefreshTimer);
	contentRefreshTimer = setTimeout(function() {
		contentRefreshTimer = null;
		if (isProcessing || !latestSettings || pendingParagraphs.size === 0) {
			if (pendingParagraphs.size > 0) scheduleContentRefresh();
			return;
		}

		const connected = Array.from(pendingParagraphs).filter(function(paragraph) {
			return paragraph.isConnected;
		});
		pendingParagraphs.clear();

		const prioritized = prioritizeParagraphsForViewport(connected);
		const paragraphs = prioritized.slice(0, DYNAMIC_BATCH_SIZE);
		prioritized.slice(DYNAMIC_BATCH_SIZE).forEach(function(paragraph) {
			pendingParagraphs.add(paragraph);
		});

		isProcessing = true;
		processParagraphSubset(paragraphs, latestSettings)
			.finally(function() {
				isProcessing = false;
				if (pendingParagraphs.size > 0) scheduleContentRefresh();
			});
	}, 120);
}

function parseComputedColor(value) {
	if (!value || value === 'transparent') return null;
	const parts = value.match(/[\d.]+/g);
	if (!parts || parts.length < 3) return null;

	const alpha = parts.length > 3 ? Number(parts[3]) : 1;
	if (alpha < 0.8) return null;

	return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

function channelToLinear(value) {
	const channel = value / 255;
	return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function luminance(rgb) {
	return 0.2126 * channelToLinear(rgb[0])
		+ 0.7152 * channelToLinear(rgb[1])
		+ 0.0722 * channelToLinear(rgb[2]);
}

function findOpaqueBackground(start) {
	let element = start;
	while (element && element.nodeType === Node.ELEMENT_NODE) {
		const color = parseComputedColor(getComputedStyle(element).backgroundColor);
		if (color) return color;
		element = element.parentElement;
	}
	return null;
}

function detectPageScheme() {
	const x = Math.max(0, Math.min(window.innerWidth - 1, Math.floor(window.innerWidth / 2)));
	const y = Math.max(0, Math.min(window.innerHeight - 1, Math.floor(window.innerHeight / 2)));
	const candidates = [
		document.elementFromPoint(x, y),
		document.body,
		document.documentElement
	];

	for (const candidate of candidates) {
		if (!candidate) continue;
		const background = findOpaqueBackground(candidate);
		if (!background) continue;

		const value = luminance(background);
		if (value >= 0.82) return 'light';
		if (value <= 0.18) return 'dark';
	}

	return null;
}

function resolveScheme(settings) {
	if (settings.pageBackgroundAuto) {
		const pageScheme = detectPageScheme();
		if (pageScheme) return pageScheme;
	}

	if (settings.appearance === 'light' || settings.appearance === 'dark') {
		return settings.appearance;
	}

	return systemAppearance.matches ? 'dark' : 'light';
}

function resolveEffectiveStyle(settings) {
	const scheme = resolveScheme(settings);
	const palette = CONFIG.getPalette(settings.theme, scheme, settings);
	return {
		scheme: scheme,
		colors: [palette.color1, palette.color2],
		text: palette.text,
		gradientSize: settings.gradient_size
	};
}

function currentDomain() {
	try {
		return window.location.hostname;
	} catch (error) {
		return '';
	}
}

async function applyCurrentSettings(settings) {
	const allowedHere = CONFIG.shouldRunOnDomain(currentDomain(), settings);
	if (!settings.enabled || !allowedHere) {
		restoreOriginalStyling();
		return;
	}

	if (!settings.boldSentenceStarts) {
		restoreSentenceBold();
	}

	const style = resolveEffectiveStyle(settings);
	await applyGradient(
		style.colors,
		style.text,
		style.gradientSize
	);

	if (settings.boldSentenceStarts) {
		applySentenceStartBold(settings.boldWordCount, settings.boldBoundaryMode);
	}
}

async function refreshFromStorage() {
	if (isProcessing) {
		refreshQueued = true;
		return;
	}

	isProcessing = true;
	try {
		const raw = await chrome.storage.local.get(null);
		const settings = CONFIG.normalizeSettings(raw);
		latestSettings = settings;
		await applyCurrentSettings(settings);
	} finally {
		isProcessing = false;
		if (refreshQueued) {
			refreshQueued = false;
			setTimeout(refreshFromStorage, 0);
		}
	}
}

function applyBoldOnlySettings(settings) {
	if (isProcessing) {
		scheduleRefresh(0);
		return;
	}

	latestSettings = settings;
	restoreSentenceBold();

	const allowedHere = CONFIG.shouldRunOnDomain(currentDomain(), settings);
	if (settings.enabled && allowedHere && settings.boldSentenceStarts) {
		applySentenceStartBold(settings.boldWordCount, settings.boldBoundaryMode);
	}
}

function scheduleRefresh(delay) {
	if (refreshTimer) clearTimeout(refreshTimer);
	refreshTimer = setTimeout(function() {
		refreshTimer = null;
		refreshFromStorage();
	}, typeof delay === 'number' ? delay : 60);
}

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
	if (message.command === 'ping') {
		sendResponse({ status: 'ok' });
		return true;
	}

	if (message.command === 'refresh') {
		refreshFromStorage()
			.then(function() { sendResponse({ status: 'ok' }); })
			.catch(function(error) { sendResponse({ status: 'error', message: error.message }); });
		return true;
	}

	return false;
});

if (systemAppearance.addEventListener) {
	systemAppearance.addEventListener('change', function() { scheduleRefresh(0); });
} else if (systemAppearance.addListener) {
	systemAppearance.addListener(function() { scheduleRefresh(0); });
}

chrome.storage.onChanged.addListener(function(changes, areaName) {
	if (areaName !== 'local') return;
	const relevantKeys = ['enabled', 'gradient_size', 'appearance', 'pageBackgroundAuto', 'boldSentenceStarts', 'boldWordCount', 'boldBoundaryMode', 'theme', 'siteMode', 'disabledSites', 'enabledSites', 'siteList', 'domainBlacklist', 'customLight1', 'customLight2', 'customDark1', 'customDark2'];
	const changedKeys = relevantKeys.filter(function(key) {
		return Object.prototype.hasOwnProperty.call(changes, key);
	});
	if (changedKeys.length === 0) return;

	const boldKeys = ['boldSentenceStarts', 'boldWordCount', 'boldBoundaryMode'];
	const boldOnly = latestSettings && changedKeys.every(function(key) {
		return boldKeys.includes(key);
	});

	if (boldOnly) {
		const patch = {};
		changedKeys.forEach(function(key) {
			patch[key] = changes[key].newValue;
		});
		applyBoldOnlySettings(CONFIG.normalizeSettings(Object.assign({}, latestSettings, patch)));
		return;
	}

	scheduleRefresh(0);
});

function scheduleViewportRefresh() {
	if (viewportRefreshTimer) clearTimeout(viewportRefreshTimer);
	viewportRefreshTimer = setTimeout(function() {
		viewportRefreshTimer = null;
		if (!latestSettings || !latestSettings.enabled || isProcessing) return;

		const candidates = targetParagraphs().filter(function(paragraph) {
			const rect = paragraph.getBoundingClientRect();
			const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
			return rect.bottom >= -VIEWPORT_MARGIN && rect.top <= viewportHeight + VIEWPORT_MARGIN;
		});

		if (candidates.length === 0) return;

		const signature = candidates.map(function(paragraph) {
			return paragraph.getAttribute('data-waspline-next-line') || 'new';
		}).join('|') + ':' + Math.round(window.scrollY || 0);

		if (signature === lastViewportSignature) return;
		lastViewportSignature = signature;

		candidates.forEach(function(paragraph) {
			pendingParagraphs.add(paragraph);
		});
		scheduleContentRefresh();
	}, 80);
}

document.addEventListener('scroll', scheduleViewportRefresh, true);
window.addEventListener('resize', scheduleViewportRefresh);

const contentObserver = new MutationObserver(function(mutations) {
	if (!latestSettings || !latestSettings.enabled) return;

	mutations.forEach(function(mutation) {
		if (mutation.type === 'characterData') {
			collectTargetParagraphs(mutation.target, pendingParagraphs);
			return;
		}

		if (mutation.type !== 'childList' || mutation.addedNodes.length === 0) return;
		mutation.addedNodes.forEach(function(node) {
			collectTargetParagraphs(node, pendingParagraphs);
		});
	});

	if (pendingParagraphs.size > 0) scheduleContentRefresh();
});

if (document.body) {
	contentObserver.observe(document.body, {
		childList: true,
		characterData: true,
		subtree: true
	});
}

const appearanceObserver = new MutationObserver(function() {
	scheduleRefresh(80);
});

if (document.documentElement) {
	appearanceObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme']
	});
}
if (document.body) {
	appearanceObserver.observe(document.body, {
		attributes: true,
		attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme']
	});
}

scheduleRefresh(0);

})();
