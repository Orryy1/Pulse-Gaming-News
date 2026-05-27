"use strict";

const RATING_REFERENCE_RE =
  /\b(?:pegi|esrb|usk|cero|age[_ -]?rating|content[_ -]?rating|rating[_ -]?board|17\+|18\+|www\.pegi\.info|blood and gore|intense violence)\b/i;

const LOGO_OR_TITLE_ONLY_RE =
  /\b(?:logo\s*(?:loop|sequence|animation|reveal|intro|bumper)|(?:opening|intro|publisher|developer)\s+logo|title\s*(?:card|screen|sequence)|legal\s+screen|splash\s+screen)\b/i;

const NON_ENGLISH_LOCALE_MARKER_RE =
  /(?:^|[\s([_\-])(?:de|deutsch|german|fr|fra|fre|french|français|francais|es|spa|spanish|español|espanol|it|ita|italian|pt|por|portuguese|br|pl|polish|polski|ru|rus|russian|tr|turkish|jp|ja|japanese|日本語|kr|ko|korean|한국어|cn|zh|chinese|中文|nl|dutch|sv|se|swedish|dk|da|danish|fi|finnish|no|norwegian)(?:$|[\s)\]_\-])/i;

const NON_ENGLISH_LANGUAGE_WORD_RE =
  /\b(?:deutsch|german|français|francais|french|español|espanol|spanish|italiano|italian|português|portugues|portuguese|polski|polish|русский|russian|türkçe|turkish|japanese|korean|chinese|dutch|swedish|danish|finnish|norwegian)\b|日本語|한국어|中文/i;

const EMBEDDED_SUBTITLE_REFERENCE_RE =
  /\b(?:subtitles?|subbed|captioned|untertitel|subtitulado|sous[-\s]?titres|legendado)\b/i;

function referenceText(record = {}) {
  const provenance = record.provenance || {};
  return [
    record.name,
    record.title,
    record.description,
    record.thumbnail,
    record.movie_name,
    record.movieName,
    record.reference_title,
    record.source_title,
    record.official_source_url,
    record.source_url,
    record.sourceUrl,
    record.url,
    record.local_path,
    record.mp4?.max,
    record.mp4?.["480"],
    record.hls_h264,
    record.dash_h264,
    record.dash_av1,
    record.webm?.max,
    record.webm?.["480"],
    provenance.movie_name,
    provenance.movieName,
    provenance.name,
    provenance.title,
    provenance.reference_title,
  ]
    .filter(Boolean)
    .join(" ");
}

function officialMediaReferenceLanguageRisk(record = {}) {
  const text = referenceText(record);
  if (!text) return null;
  if (NON_ENGLISH_LANGUAGE_WORD_RE.test(text)) {
    return "localised_non_english_reference";
  }
  if (NON_ENGLISH_LOCALE_MARKER_RE.test(text)) {
    return "localised_non_english_reference";
  }
  return null;
}

function officialMediaReferenceRejectReason(record = {}) {
  const text = referenceText(record);
  if (RATING_REFERENCE_RE.test(text)) return "rating_board_reference";
  if (LOGO_OR_TITLE_ONLY_RE.test(text)) return "logo_or_title_only_reference";
  const languageRisk = officialMediaReferenceLanguageRisk(record);
  if (languageRisk) return languageRisk;
  if (EMBEDDED_SUBTITLE_REFERENCE_RE.test(text)) return "embedded_subtitle_reference";
  return null;
}

module.exports = {
  officialMediaReferenceLanguageRisk,
  officialMediaReferenceRejectReason,
  referenceText,
};
