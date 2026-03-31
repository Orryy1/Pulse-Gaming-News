// Pulse Gaming — Brand Constants (single source of truth)
// Every file that references colours must import from here.

module.exports = {
  // Primary brand
  PRIMARY: '#FF6B1A',         // Pulse Amber — logo, highlights, accent
  PRIMARY_FFM: '0xFF6B1A',    // FFmpeg hex format
  SECONDARY: '#0D0D0F',       // Deep Charcoal — backgrounds
  TEXT: '#F0F0F0',            // Signal White — body text, headlines
  TEXT_FFM: '0xF0F0F0',

  // Classification colours
  ALERT: '#FF2D2D',           // Hot Red — LEAK and BREAKING tags
  ALERT_FFM: '0xFF2D2D',
  CONFIRMED: '#22C55E',       // Green — CONFIRMED tag only
  CONFIRMED_FFM: '0x22C55E',
  MUTED: '#6B7280',           // Cool Grey — timestamps, source labels
  MUTED_FFM: '0x6B7280',

  // Classification → colour mapping
  classificationColour(classification) {
    const c = (classification || '').toLowerCase();
    if (c.includes('leak')) return { hex: '#FF2D2D', ffm: '0xFF2D2D', label: 'LEAK' };
    if (c.includes('breaking')) return { hex: '#FF2D2D', ffm: '0xFF2D2D', label: 'BREAKING' };
    if (c.includes('rumor') || c.includes('rumour')) return { hex: '#FF6B1A', ffm: '0xFF6B1A', label: 'RUMOR' };
    if (c.includes('confirmed') || c.includes('verified')) return { hex: '#22C55E', ffm: '0x22C55E', label: 'CONFIRMED' };
    return { hex: '#6B7280', ffm: '0x6B7280', label: 'NEWS' };
  },

  // Font
  FONT: 'Space Grotesk',
  FONT_FALLBACK: 'Inter',

  // Channel
  CHANNEL_NAME: 'PULSE GAMING',
  TAGLINE: 'Verified leaks. Every day.',
  CTA: 'Follow Pulse Gaming so you never miss a drop',
};
