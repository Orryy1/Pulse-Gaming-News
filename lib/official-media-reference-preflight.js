"use strict";

const RATING_REFERENCE_RE =
  /\b(?:pegi|esrb|usk|cero|age[_ -]?rating|content[_ -]?rating|rating[_ -]?board|17\+|18\+|www\.pegi\.info|blood and gore|intense violence)\b/i;

const LOGO_OR_TITLE_ONLY_RE =
  /\b(?:logo\s*(?:loop|sequence|animation|reveal|intro|bumper)|(?:opening|intro|publisher|developer)\s+logo|title\s*(?:card|screen|sequence)|legal\s+screen|splash\s+screen)\b/i;

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

function officialMediaReferenceRejectReason(record = {}) {
  const text = referenceText(record);
  if (RATING_REFERENCE_RE.test(text)) return "rating_board_reference";
  if (LOGO_OR_TITLE_ONLY_RE.test(text)) return "logo_or_title_only_reference";
  return null;
}

module.exports = {
  officialMediaReferenceRejectReason,
  referenceText,
};
