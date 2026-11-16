"use strict";

(function (root) {
  // Browsers report "en-US", some Android builds "en_US".
  const lang = (voice) => String(voice?.lang || "").replace(/_/g, "-");

  function englishVoices(voices) {
    return Array.from(voices || []).filter((voice) => /^en(?:-|$)/i.test(lang(voice)));
  }

  // macOS / iOS novelty and legacy voices, Eloquence voices and eSpeak sound robotic or comic.
  const HARSH = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|pipe organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|ralph|kathy|princess|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|espeak|robot|robosoft\d*|croak|klatt\d*|mr_serious|whisperf|shavian|kaukovalta)\b/i;
  // Neural and premium voices: Edge/Windows "Online (Natural)", Apple "Premium"/"Enhanced", Chrome "Google".
  const NEURAL = /natural|neural|online/i;
  const PREMIUM = /premium|enhanced/i;
  // Voices commonly perceived as calm and clear on each platform.
  const WARM = /\b(aria|jenny|ava|emma|michelle|sonia|libby|natasha|clara|samantha|allison|susan|zoe|serena|karen|moira|tessa|fiona|kate|nicky|joelle|google us english|google uk english female|zira|hazel)\b/i;

  function voiceScore(voice) {
    const name = String(voice?.name || "");
    const l = lang(voice);
    let score = 0;
    if (HARSH.test(name)) score -= 100;
    if (NEURAL.test(name)) score += 40;
    if (PREMIUM.test(name)) score += 30;
    if (/^google\b/i.test(name)) score += 25;
    if (WARM.test(name)) score += 12;
    if (/^en-US$/i.test(l)) score += 8;
    else if (/^en-(GB|AU|CA|IE|NZ)$/i.test(l)) score += 5;
    if (voice?.default) score += 3;
    if (voice?.localService) score += 1;
    return score;
  }

  function chooseEnglishVoice(voices) {
    const available = englishVoices(voices);
    if (!available.length) return null;
    return available.map((voice, index) => ({ voice, index, score: voiceScore(voice) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)[0].voice;
  }

  // A slightly slower pace reads as calmer. Neural voices already sound unhurried; changing the
  // pitch distorts them, so pitch stays at 1 except for the basic synthesizers.
  function speechSettings(voice) {
    const name = String(voice?.name || "");
    if (NEURAL.test(name) || PREMIUM.test(name)) return { rate: 0.94, pitch: 1 };
    if (/^google\b/i.test(name)) return { rate: 0.9, pitch: 1 };
    if (HARSH.test(name)) return { rate: 0.85, pitch: 0.95 };
    return { rate: 0.9, pitch: 0.98 };
  }

  function prepareSpeech(text) {
    return String(text).replace(/\bCLHM\b/g, "C L H M").replace(/\bEVA\b/g, "E V A");
  }

  // Short sentence groups: natural pauses between them, and Chrome's network voices stop
  // after about 15 seconds of one long utterance.
  function speechChunks(text, maxLength = 180) {
    // A period only ends a sentence before a space or the end, so "5.48 kilometers" stays whole.
    const sentences = String(text).replace(/\s+/g, " ").trim().match(/.+?(?:[.!?]+(?=\s|$)|$)/g) || [];
    const chunks = [];
    for (const raw of sentences) {
      const sentence = raw.trim();
      if (!sentence) continue;
      const last = chunks.length - 1;
      if (last >= 0 && chunks[last].length + sentence.length + 1 <= maxLength) chunks[last] += ` ${sentence}`;
      else chunks.push(sentence);
    }
    return chunks;
  }

  function openingGuidance(routeSpeech) {
    return `Hello, welcome to CLHM. I'm here with you. I'll share information about your route and what lies ahead. Let's begin. ${routeSpeech}`;
  }

  const api = { englishVoices, chooseEnglishVoice, voiceScore, speechSettings, prepareSpeech, speechChunks, openingGuidance };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.CLHM_VOICE = api;
})(typeof window !== "undefined" ? window : null);
