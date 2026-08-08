import assert from "node:assert/strict";
import {
  formatCoordinatePair,
  parseCoordinatePaste,
  validateCoordinateInputs,
} from "./coordinateNavigation.js";

assert.equal(
  formatCoordinatePair(59.3293244, 18.0685806),
  "59.329324, 18.068581",
);
assert.equal(
  formatCoordinatePair(-33.8688, 151.2093),
  "-33.868800, 151.209300",
);
assert.equal(
  formatCoordinatePair(-0.0000001, -0.0000001),
  "-0.000000, -0.000000",
);

for (const [latitude, longitude, expectedLatitude, expectedLongitude] of [
  ["-90", "-180", -90, -180],
  ["90", "180", 90, 180],
  [" +59.25 ", " 18 ", 59.25, 18],
  [".5", "-.5", 0.5, -0.5],
]) {
  const result = validateCoordinateInputs(latitude, longitude);
  assert.equal(result.ok, true);
  assert.equal(result.latitude, expectedLatitude);
  assert.equal(result.longitude, expectedLongitude);
}

for (const [latitude, longitude] of [
  ["", "18"],
  ["59", ""],
  ["1.", "18"],
  ["59", "1e2"],
  ["north", "18"],
  ["90.0001", "18"],
  ["59", "-180.0001"],
]) {
  assert.equal(validateCoordinateInputs(latitude, longitude).ok, false);
}

assert.deepEqual(
  parseCoordinatePaste("59.93462512465285, 17.682585918325277"),
  { latitude: "59.93462512465285", longitude: "17.682585918325277" },
);
assert.deepEqual(
  parseCoordinatePaste(" 59.93462512465285;17.682585918325277 "),
  { latitude: "59.93462512465285", longitude: "17.682585918325277" },
);
assert.deepEqual(
  parseCoordinatePaste("-33.8688, 151.2093"),
  { latitude: "-33.8688", longitude: "151.2093" },
);

for (const unsupported of [
  "Latitude 59.1, Longitude 17.2",
  "59.1, 17.2, 18.3",
  "59.1,,17.2",
  "59.1;;17.2",
  "59.1,",
  ",17.2",
  "59.1 17.2",
  "59.1|17.2",
  "59,1;17,2",
  "59.1,\n17.2",
]) {
  assert.equal(parseCoordinatePaste(unsupported), null);
}

assert.deepEqual(
  parseCoordinatePaste(`18°27'58.17"N 3°42'40.54"W`),
  { latitude: "18.466158", longitude: "-3.711261" },
);
assert.deepEqual(
  parseCoordinatePaste(`14°33'52.62"S 17°23'51.63"E`),
  { latitude: "-14.564617", longitude: "17.397675" },
);
assert.deepEqual(
  parseCoordinatePaste(`52°57'23.53"N 10°09'21.70"E`),
  { latitude: "52.956536", longitude: "10.156028" },
);
assert.deepEqual(
  parseCoordinatePaste("052°057′023.53″N 010°009′021.70″E"),
  { latitude: "52.956536", longitude: "10.156028" },
);

for (const unsupportedDms of [
  `18°27'58.17"E 3°42'40.54"N`,
  `18°60'00"N 3°42'40.54"W`,
  `18°27'60"N 3°42'40.54"W`,
  `91°00'00"N 3°42'40.54"W`,
  `18°27'58.17"N 181°00'00"W`,
  `18°27'N 3°42'40.54"W`,
  `18°27'58.17"N`,
]) {
  assert.equal(parseCoordinatePaste(unsupportedDms), null);
}

console.log("Coordinate navigation smoke checks passed.");
