// Recorded video from Protect for the camera viewer's timeline, shared by server and browser.

/**
 * Recordings are exported in pieces of this length, aligned to multiples of it (so pieces are reused
 * by every viewer and every scrub). A full-resolution piece is about 6 MB from the home UDM Pro
 * (under a second) and 12 MB from the cabin (about 4 s over its mobile link).
 */
export const PIECE_MS = 20_000;
