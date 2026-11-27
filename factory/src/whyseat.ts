// The Why slot's seat (WHY_SLOT_SEAT, 26 Nov 2026). Selection stops while MAX_PRODUCING Shorts are mid-production, so
// two slow Shorts could hold a planned Why slot's whole window (25 Nov: 17:16 to 19:01 every tick waited, and the 18:30
// Why never started; Why Shorts win about six times the subscribers of news Shorts). A Why slot that is due may start
// one Short past the limit: one seat, not an open door, and only the Why lane takes it (src/pipeline.ts maybeSelect).

/** Whether a due Why slot may take the one seat past the production limit (pure). */
export function whySeatOpen(
  seat: boolean,
  producing: number,
  maxProducing: number,
): boolean {
  return seat && maxProducing > 0 && producing === maxProducing;
}
