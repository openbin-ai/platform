'use strict';

const _ = require('lodash');

/**
 * Lowercase a string and trim surrounding whitespace.
 * Pure function, no side effects. Should produce zero findings.
 */
function normalize(input) {
  if (typeof input !== 'string') return '';
  return _.trim(input).toLowerCase();
}

module.exports = { normalize };
