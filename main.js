(function() {
'use strict';

const CONFIG = globalThis.WaspLineConfig;
if (!CONFIG) return;

const MAX_PARAGRAPHS = 300;
const BATCH_SIZE = 20;
const GRADIENT_STEPS = 10;
const colorCache = new Map();
const systemAppearance = window.matchMedia('(prefers-color-scheme: dark)');

let isProcessing = false;
let refreshQueued = false;
let refreshTimer = null;

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
	if (globalThis.Intl && Intl.Segmenter) {
		const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
		return Array.from(segmenter.segment(text))
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
	const paragraphs = document.querySelectorAll('p, article p, main p, .content p, .post p, .article p');
	const boundaryPattern = boundaryMode === 'clauses'
		? /[.!?。！？,;:，；：]/u
		: /[.!?。！？]/u;

	paragraphs.forEach(function(paragraph) {
		const spans = Array.from(paragraph.getElementsByClassName('js-detect-wrap'));
		if (!spans.length) return;

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

function processBatch(paragraphs, startIdx, colors, baseColor, gradientSize, lineno, resolve) {
	const endIdx = Math.min(startIdx + BATCH_SIZE, paragraphs.length);
	const activeColors = colors.map(function(color) { return hex_to_rgb(color); });

	for (let i = startIdx; i < endIdx; i++) {
		const paragraph = paragraphs[i];
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
		const allParagraphs = document.querySelectorAll('p, article p, main p, .content p, .post p, .article p');
		const paragraphs = Array.from(allParagraphs).slice(0, MAX_PARAGRAPHS);

		if (paragraphs.length === 0) {
			resolve();
			return;
		}

		const baseColor = hex_to_rgb(colorText);
		requestAnimationFrame(function() {
			processBatch(paragraphs, 0, colors, baseColor, gradientSize, 0, resolve);
		});
	});
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

	restoreSentenceBold();

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
		await applyCurrentSettings(settings);
	} finally {
		isProcessing = false;
		if (refreshQueued) {
			refreshQueued = false;
			setTimeout(refreshFromStorage, 0);
		}
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
	if (relevantKeys.some(function(key) { return Object.prototype.hasOwnProperty.call(changes, key); })) {
		scheduleRefresh(0);
	}
});

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
