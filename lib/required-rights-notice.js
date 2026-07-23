"use strict";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sentenceStart(text, index) {
  const previousStop = text.lastIndexOf(". ", Math.max(0, index - 1));
  return previousStop >= 0 ? previousStop + 2 : 0;
}

function splitMicrosoftGameContentNotice(value = "") {
  const text = cleanText(value);
  const comparable = text.toLowerCase().replace(/\u2019/g, "'");
  const policyIndex = comparable.indexOf("created under microsoft's game content usage rules");
  const rulesUrlPresent = /https:\/\/www\.xbox\.com\/en-us\/developers\/rules/i.test(text);
  const disclaimerPresent = /not endorsed/i.test(text);
  if (policyIndex < 0 || !rulesUrlPresent || !disclaimerPresent) {
    return { required: false, editorialText: text, noticeText: "" };
  }

  let noticeStart = sentenceStart(text, policyIndex);
  const copyrightIndex = comparable.lastIndexOf("\u00a9 microsoft corporation", policyIndex);
  if (copyrightIndex >= 0) noticeStart = sentenceStart(text, copyrightIndex);

  return {
    required: true,
    editorialText: cleanText(text.slice(0, noticeStart)),
    noticeText: cleanText(text.slice(noticeStart)),
  };
}

module.exports = { splitMicrosoftGameContentNotice };
