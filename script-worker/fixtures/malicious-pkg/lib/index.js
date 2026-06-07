'use strict';

// Innocent-looking surface API to make the package look legitimate at
// `npm view`. Real malicious packages do the same — hide the badness in
// install.js so the runtime user never sees it.

module.exports = function add(a, b) {
  return a + b;
};
