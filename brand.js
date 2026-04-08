// Brand Constants - backwards-compatible bridge to multi-channel system.
// Existing code can still `require('./brand')` and get the active channel's brand.
// New code should use `require('./channels').getChannel(id)` directly.

const { getActiveBrand } = require('./channels');

// Export the active channel's brand (defaults to CHANNEL env var or pulse-gaming)
module.exports = getActiveBrand();
