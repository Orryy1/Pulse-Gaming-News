"use strict";

function buildStillFrameExtractionArgs({ source, outputPath, seekSeconds }) {
  if (!source) throw new Error("frame_source_missing");
  if (!outputPath) throw new Error("frame_output_missing");
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    String(seekSeconds),
    "-i",
    source,
    "-frames:v",
    "1",
    "-vf",
    "scale=1080:-2:flags=lanczos,format=yuvj420p",
    "-q:v",
    "2",
    "-strict",
    "unofficial",
    outputPath,
  ];
}

module.exports = {
  buildStillFrameExtractionArgs,
};
