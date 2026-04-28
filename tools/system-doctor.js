"use strict";

const path = require("node:path");
const { writeSystemDoctorReport } = require("../lib/ops/system-doctor");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

writeSystemDoctorReport(OUT)
  .then(({ report, jsonPath, mdPath }) => {
    console.log(`[system-doctor] verdict=${report.verdict}`);
    console.log(`[system-doctor] json=${path.relative(ROOT, jsonPath)}`);
    console.log(`[system-doctor] md=${path.relative(ROOT, mdPath)}`);
  })
  .catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  });
