'use strict';

(function () {
	const THEMES = Object.freeze({
		studio: {
			name: 'Studio',
			description: 'A calm macOS-like blue and berry pair.',
			light: { color1: '#EE0000', color2: '#006BFF', text: '#000000' },
			dark: { color1: '#7FA8FF', color2: '#E58AB6', text: '#FFFFFF' }
		},
		riso: {
			name: 'Riso',
			description: 'High-separation red and blue for strong line cues.',
			light: { color1: '#E02A22', color2: '#006BD6', text: '#000000' },
			dark: { color1: '#FF8795', color2: '#78B5D0', text: '#FFFFFF' }
		},
		graphite: {
			name: 'Graphite',
			description: 'Clear blue and magenta with restrained saturation.',
			light: { color1: '#00749C', color2: '#C2329F', text: '#000000' },
			dark: { color1: '#63C7FF', color2: '#FF76CE', text: '#FFFFFF' }
		},
		moss: {
			name: 'Moss',
			description: 'Distinct green and orange for warm, obvious tracking.',
			light: { color1: '#008542', color2: '#C65300', text: '#000000' },
			dark: { color1: '#79C2B5', color2: '#DEB56E', text: '#FFFFFF' }
		},
		signal: {
			name: 'Signal',
			description: 'Maximum-contrast cyan and magenta tracking cues.',
			light: { color1: '#1800f2', color2: '#ee0000', text: '#000000' },
			dark: { color1: '#00E5FF', color2: '#FF2D8D', text: '#FFFFFF' }
		},
		custom: {
			name: 'Custom',
			description: 'Keep your own accent colors for light and dark pages.',
			custom: true
		}
	});

	const DEFAULTS = Object.freeze({
		enabled: false,
		gradient_size: 50,
		appearance: 'auto',
		pageBackgroundAuto: true,
		boldSentenceStarts: true,
		boldWordCount: 2,
		boldBoundaryMode: 'clauses',
		theme: 'studio',
		siteMode: 'disable',
		disabledSites: [],
		enabledSites: [],
		customLight1: '#315CFF',
		customLight2: '#E01F70',
		customDark1: '#7FA8FF',
		customDark2: '#E58AB6'
	});

	function normalizeDomain(value) {
		if (typeof value !== 'string') return '';
		const trimmed = value.trim().toLowerCase();
		if (!trimmed) return '';

		try {
			const url = trimmed.includes('://') ? new URL(trimmed) : new URL('https://' + trimmed);
			return url.hostname.replace(/\.$/, '');
		} catch (error) {
			return '';
		}
	}

	function normalizeSiteList(value) {
		if (!Array.isArray(value)) return [];
		return Array.from(new Set(value.map(normalizeDomain).filter(Boolean)));
	}

	function normalizeHex(value, fallback) {
		return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
			? value.toUpperCase()
			: fallback;
	}

	function normalizeSettings(raw) {
		const input = raw || {};
		const siteMode = ['disable', 'enable'].includes(input.siteMode)
			? input.siteMode
			: DEFAULTS.siteMode;
		const legacyList = Array.isArray(input.siteList)
			? input.siteList
			: (Array.isArray(input.domainBlacklist) ? input.domainBlacklist : []);
		const hasSeparatedLists = Array.isArray(input.disabledSites) || Array.isArray(input.enabledSites);
		const disabledSites = hasSeparatedLists
			? normalizeSiteList(input.disabledSites)
			: (siteMode === 'disable' ? normalizeSiteList(legacyList) : []);
		const enabledSites = hasSeparatedLists
			? normalizeSiteList(input.enabledSites)
			: (siteMode === 'enable' ? normalizeSiteList(legacyList) : []);
		const activeSiteList = siteMode === 'disable' ? disabledSites : enabledSites;
		const legacyColor1 = normalizeHex(input.color1, DEFAULTS.customLight1);
		const legacyColor2 = normalizeHex(input.color2, DEFAULTS.customLight2);
		const hasLegacyCustomColors = typeof input.color1 === 'string'
			&& typeof input.color2 === 'string'
			&& (legacyColor1 !== '#0000FF' || legacyColor2 !== '#FF0000');
		const hasExplicitTheme = typeof input.theme === 'string'
			&& Object.prototype.hasOwnProperty.call(THEMES, input.theme);

		return {
			enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULTS.enabled,
			gradient_size: Number.isFinite(Number(input.gradient_size))
				? Math.max(0, Math.min(100, Number(input.gradient_size)))
				: DEFAULTS.gradient_size,
			appearance: ['auto', 'light', 'dark'].includes(input.appearance)
				? input.appearance
				: DEFAULTS.appearance,
			pageBackgroundAuto: typeof input.pageBackgroundAuto === 'boolean'
				? input.pageBackgroundAuto
				: DEFAULTS.pageBackgroundAuto,
			boldSentenceStarts: typeof input.boldSentenceStarts === 'boolean'
				? input.boldSentenceStarts
				: DEFAULTS.boldSentenceStarts,
			boldWordCount: Number.isFinite(Number(input.boldWordCount))
				? Math.max(1, Math.min(5, Math.round(Number(input.boldWordCount))))
				: DEFAULTS.boldWordCount,
			boldBoundaryMode: ['sentence', 'clauses'].includes(input.boldBoundaryMode)
				? input.boldBoundaryMode
				: DEFAULTS.boldBoundaryMode,
			theme: hasExplicitTheme
				? input.theme
				: (hasLegacyCustomColors ? 'custom' : DEFAULTS.theme),
			siteMode: siteMode,
			disabledSites: disabledSites,
			enabledSites: enabledSites,
			siteList: activeSiteList,
			customLight1: normalizeHex(input.customLight1, legacyColor1),
			customLight2: normalizeHex(input.customLight2, legacyColor2),
			customDark1: normalizeHex(input.customDark1, DEFAULTS.customDark1),
			customDark2: normalizeHex(input.customDark2, DEFAULTS.customDark2)
		};
	}

	function getPalette(themeKey, scheme, settings) {
		if (themeKey === 'custom') {
			const values = settings || DEFAULTS;
			if (scheme === 'dark') {
				return {
					color1: normalizeHex(values.customDark1, DEFAULTS.customDark1),
					color2: normalizeHex(values.customDark2, DEFAULTS.customDark2),
					text: '#FFFFFF'
				};
			}

			return {
				color1: normalizeHex(values.customLight1, DEFAULTS.customLight1),
				color2: normalizeHex(values.customLight2, DEFAULTS.customLight2),
				text: '#000000'
			};
		}

		const theme = THEMES[themeKey] && !THEMES[themeKey].custom
			? THEMES[themeKey]
			: THEMES[DEFAULTS.theme];
		return theme[scheme === 'dark' ? 'dark' : 'light'];
	}

	function shouldRunOnDomain(domain, settings) {
		const normalized = normalizeDomain(domain);
		if (!normalized) return false;
		const list = normalizeSiteList(settings.siteList);
		const listed = list.includes(normalized);
		return settings.siteMode === 'enable' ? listed : !listed;
	}

	globalThis.WaspLineConfig = Object.freeze({
		THEMES: THEMES,
		DEFAULTS: DEFAULTS,
		normalizeDomain: normalizeDomain,
		normalizeSiteList: normalizeSiteList,
		normalizeSettings: normalizeSettings,
		getPalette: getPalette,
		shouldRunOnDomain: shouldRunOnDomain
	});
})();

