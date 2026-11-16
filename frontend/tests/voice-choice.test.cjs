const test = require("node:test");
const assert = require("node:assert/strict");
const voice = require("../assets/voice-choice.js");

const voices = [
  { name: "Spanish system", lang: "es-MX", voiceURI: "es", default: true, localService: true },
  { name: "English basic", lang: "en-GB", voiceURI: "en-basic", localService: true },
  { name: "English Natural", lang: "en-US", voiceURI: "en-natural", localService: false },
];

test("English narration never chooses a Spanish default voice", () => {
  assert.equal(voice.chooseEnglishVoice(voices).voiceURI, "en-natural");
  assert.equal(voice.chooseEnglishVoice([voices[0]]), null);
});

test("automatic English narration welcomes the visitor before route directions", () => {
  assert.equal(voice.chooseEnglishVoice(voices).voiceURI, "en-natural");
  const opening = voice.openingGuidance("From the habitat, continue toward the boxwork.");
  assert.match(opening, /^Hello, welcome to CLHM\./);
  assert.ok(opening.indexOf("Let's begin.") < opening.indexOf("From the habitat"));
  assert.equal(voice.prepareSpeech("CLHM Habitat to EVA Relay"), "C L H M Habitat to E V A Relay");
});

// Voice lists as reported by real browsers (names trimmed).
const macChrome = [
  { name: "Albert", lang: "en-US", localService: true },
  { name: "Bad News", lang: "en-US", localService: true },
  { name: "Paulina", lang: "es-MX", localService: true, default: true },
  { name: "Samantha", lang: "en-US", localService: true },
  { name: "Zarvox", lang: "en-US", localService: true },
  { name: "Google US English", lang: "en-US", localService: false },
];
const iosSafari = [
  { name: "Albert", lang: "en-US", localService: true },
  { name: "Fred", lang: "en-US", localService: true },
  { name: "Samantha", lang: "en-US", localService: true, default: true },
  { name: "Ava (Enhanced)", lang: "en-US", localService: true },
];
const edgeWindows = [
  { name: "Microsoft David - English (United States)", lang: "en-US", localService: true, default: true },
  { name: "Microsoft Aria Online (Natural) - English (United States)", lang: "en-US", localService: false },
  { name: "Microsoft Guy Online (Natural) - English (United States)", lang: "en-US", localService: false },
];
const androidOld = [
  { name: "Spanish Mexico", lang: "es_MX", localService: true, default: true },
  { name: "English United States", lang: "en_US", localService: true },
];
const linuxFirefox = [
  { name: "eSpeak English (America)", lang: "en-US", localService: true },
];

test("a Spanish-default Mac never falls back to a novelty voice", () => {
  assert.equal(voice.chooseEnglishVoice(macChrome).name, "Google US English");
  assert.equal(voice.chooseEnglishVoice(macChrome.filter((v) => !/^Google/.test(v.name))).name, "Samantha");
});

test("each platform gets its calm, natural voice", () => {
  assert.equal(voice.chooseEnglishVoice(iosSafari).name, "Ava (Enhanced)");
  assert.match(voice.chooseEnglishVoice(edgeWindows).name, /Aria Online \(Natural\)/);
  assert.equal(voice.chooseEnglishVoice(androidOld).name, "English United States");
  assert.equal(voice.chooseEnglishVoice(linuxFirefox).name, "eSpeak English (America)");
});

test("Linux speech-dispatcher skips eSpeak novelty variants whatever the order", () => {
  const list = [
    { name: "English (Shavian alphabet)+Robosoft", lang: "en-SHAW" },
    { name: "English (America)+Robosoft7", lang: "en-US" },
    { name: "English (America)+grandpa", lang: "en-US" },
    { name: "English (America)+croak", lang: "en-US" },
    { name: "English (America)+female1", lang: "en-US" },
  ];
  assert.equal(voice.chooseEnglishVoice(list).name, "English (America)+female1");
  assert.equal(voice.chooseEnglishVoice([...list].reverse()).name, "English (America)+female1");
});

test("speech settings are unhurried and keep neural voices at their natural pitch", () => {
  for (const v of [...macChrome, ...iosSafari, ...edgeWindows, ...androidOld, ...linuxFirefox]) {
    const { rate, pitch } = voice.speechSettings(v);
    assert.ok(rate >= 0.85 && rate < 1, `${v.name} rate ${rate}`);
    assert.ok(pitch >= 0.95 && pitch <= 1, `${v.name} pitch ${pitch}`);
  }
  assert.equal(voice.speechSettings(edgeWindows[1]).pitch, 1);
  assert.equal(voice.speechSettings(iosSafari[3]).pitch, 1);
});

test("narration is split into short sentence groups without breaking decimals", () => {
  const text = "From the habitat, the route heads toward Pahrump Hills for about 5.48 kilometers. The mapped surface is flat plain with loose sand ahead. The sampled maximum slope is 6.2 degrees, and the modeled risk score is 21 out of 100. A gentle stretch is ahead. Take it one step at a time.";
  const chunks = voice.speechChunks(text);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((c) => c.length <= 180));
  assert.equal(chunks.join(" "), text);
  assert.ok(chunks[0].includes("5.48 kilometers."));
  assert.deepEqual(voice.speechChunks("No final period"), ["No final period"]);
  assert.deepEqual(voice.speechChunks("   "), []);
});
