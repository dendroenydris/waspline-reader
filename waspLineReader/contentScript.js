(function() {

  // Use word-based splitting instead of character-based for better performance
  var wrapWordsInChildElement = function(el) {
    if(el.nodeName == '#text') {
      var text = el.textContent;
      if (!text || text.trim().length === 0) return;
      
      // Split by words (including spaces) instead of characters
      var words = text.match(/\S+|\s+/g) || [];
      var fragment = document.createDocumentFragment();
      
      for(var i = 0; i < words.length; i++) {
        var span = document.createElement('span');
        span.className = "js-detect-wrap";
        span.textContent = words[i];
        fragment.appendChild(span);
      }
      
      el.parentNode.insertBefore(fragment, el);
      el.parentNode.removeChild(el);
    }
    else if(el.nodeType === 1) { // Element node
      // Process child nodes
      var children = Array.from(el.childNodes);
      for(var i = 0; i < children.length; i++) {
        wrapWordsInChildElement(children[i]);
      }
    }
  };

  var wrapWordsInElement = function(el) {
    // Skip if already processed
    if (el.querySelector && el.querySelector('.js-detect-wrap')) {
      return;
    }
    wrapWordsInChildElement(el);
  }

  var getLines = function(el) {
    wrapWordsInElement(el);

    var spans = el.getElementsByClassName('js-detect-wrap');
    if (spans.length === 0) return [];

    var lastOffset = -1, line = [], lines = [];
    
    for(var i = 0; i < spans.length; i++) {
      var span = spans[i];
      var rect = span.getBoundingClientRect();
      var offset = Math.round(rect.top);
      
      if(offset === lastOffset || lastOffset === -1) {
        line.push(span);
      } else {
        if(line.length > 0) lines.push(line);
        line = [span];
      }
      lastOffset = offset;
    }
    
    if(line.length > 0) lines.push(line);
    return lines;
  }

  var detector = {
      wrapWordsInElement: wrapWordsInElement
    , wrapWordsInChildElement: wrapWordsInChildElement
    , getLines: getLines
  };

  if(typeof define == 'function') {
    define(function() {
      return detector; 
    });
  }
  else {
    window.lineWrapDetector = detector;
  }

})();


(function() {
'use strict';

// Configuration
const MAX_PARAGRAPHS = 200; // Limit paragraphs to prevent freezing
const BATCH_SIZE = 10; // Process paragraphs in batches

// Linear interpolate between v0 and v1 at percent t
function lerp(v0, v1, t)
{
	return v0 * (1 - t) + v1 * t;
}

// Convert a hex triplet (#XXXXXX) to an array containing red, green, and blue
function hex_to_rgb(hex)
{
	return hex.replace('#', '').match(/.{1,2}/g).map(
		x => parseInt(x, 16)
	);
}

// Process a single paragraph
function processParagraph(paragraph, colors, base_color, gradient_size, startLineno) {
	let coloridx = Math.floor(startLineno / 2) % colors.length;
	let lineno = startLineno;

	try {
		const lines = lineWrapDetector.getLines(paragraph);

		for (let line of lines) {
			if (!line || line.length === 0) continue;
			
			// Alternate between left and right for every color
			const active_color = hex_to_rgb(colors[coloridx]);

			// Flip array around if on left to color correctly
			const is_left = (lineno % 2 === 0);
			const orderedLine = is_left ? Array.from(line).reverse() : line;

			// Color lines using lerp of RGB values
			const lineLen = orderedLine.length;
			for (let loc = 0; loc < lineLen; loc++) {
				const t = 1 - (loc / (lineLen * gradient_size / 50));
				const red = lerp(base_color[0], active_color[0], t) | 0;
				const green = lerp(base_color[1], active_color[1], t) | 0;
				const blue = lerp(base_color[2], active_color[2], t) | 0;

				orderedLine[loc].style.color = `rgb(${red},${green},${blue})`;
			}

			// Increment color index after every left/right pair
			if (!is_left) {
				coloridx = (coloridx + 1) % colors.length;
			}
			lineno += 1;
		}
	} catch (e) {
		// Skip paragraphs that fail
		console.warn('Failed to process paragraph:', e);
	}
	
	return lineno;
}

// Color all lines in the page (async batched processing)
async function applyGradient(colors, color_text, gradient_size)
{
	const allParagraphs = document.getElementsByTagName('p');
	const paragraphs = Array.from(allParagraphs).slice(0, MAX_PARAGRAPHS);
	const base_color = hex_to_rgb(color_text);
	let lineno = 0;

	// Process in batches to prevent UI freeze
	for (let i = 0; i < paragraphs.length; i += BATCH_SIZE) {
		const batch = paragraphs.slice(i, i + BATCH_SIZE);
		
		for (let paragraph of batch) {
			// Skip empty or very small paragraphs
			if (!paragraph.textContent || paragraph.textContent.trim().length < 2) {
				continue;
			}
			lineno = processParagraph(paragraph, colors, base_color, gradient_size, lineno);
		}
		
		// Yield to browser between batches
		if (i + BATCH_SIZE < paragraphs.length) {
			await new Promise(resolve => setTimeout(resolve, 0));
		}
	}
}

// Track if processing is in progress
let isProcessing = false;

// Listen for messages from popup and background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.command === "ping") {
		// Respond to ping to confirm content script is injected
		sendResponse({ status: "ok" });
		return true;
	} else if (message.command === "apply_gradient") {
		if (isProcessing) {
			sendResponse({ status: "busy" });
			return true;
		}
		
		isProcessing = true;
		applyGradient(
			message.colors, message.color_text, message.gradient_size
		).then(() => {
			isProcessing = false;
			sendResponse({ status: "ok" });
		}).catch((error) => {
			isProcessing = false;
			sendResponse({ status: "error", message: error.message });
		});
		return true; // Keep channel open for async response
	} else if (message.command === "reset") {
		if (isProcessing) {
			sendResponse({ status: "busy" });
			return true;
		}
		
		isProcessing = true;
		applyGradient(
			[message.color_text], message.color_text, 0
		).then(() => {
			isProcessing = false;
			sendResponse({ status: "ok" });
		}).catch((error) => {
			isProcessing = false;
			sendResponse({ status: "error", message: error.message });
		});
		return true;
	}
	return false;
});

})();