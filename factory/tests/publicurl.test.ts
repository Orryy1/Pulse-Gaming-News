import { test } from "node:test";
import assert from "node:assert/strict";
import { privateAddress, publicUrlProblem } from "../src/lib/publicurl.ts";

const resolves = (ip: string) => async () => [ip];

test("addresses on this machine or the home network are private, in every spelling", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.0.157",
    "169.254.169.254",
    "0.0.0.0",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:c0a8:1",
    "fd00::1",
    "fe80::1",
  ])
    assert.equal(privateAddress(ip), true, ip);
  for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1", "::ffff:808:808"])
    assert.equal(privateAddress(ip), false, ip);
});

test("links to the factory or the network are refused, ordinary articles are not", async () => {
  const pub = resolves("93.184.216.34");
  for (const url of [
    "http://127.0.0.1:8080/admin/hold",
    "http://localhost:8080/health",
    "http://[::ffff:7f00:1]:8080/",
    "http://192.168.0.157:8877/",
    "file:///C:/PulseFactory/factory/.env",
    "not a url",
  ])
    assert.ok(await publicUrlProblem(url, pub), url);
  assert.ok(
    await publicUrlProblem("https://sneaky.example/a", resolves("127.0.0.1")),
  );
  assert.equal(
    await publicUrlProblem("https://www.ign.com/articles/x", pub),
    undefined,
  );
});
