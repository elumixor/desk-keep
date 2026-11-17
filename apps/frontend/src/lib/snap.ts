/**
 * How something dragged between fixed places moves (a picked day, a timeline bar): it springs to the place nearest the
 * pointer while leaning from it toward the pointer, so it feels pulled there rather than jumping.
 */
export const SNAP_SPRING = { stiffness: 0.18, damping: 0.62 } as const;

/** How far a held thing follows the pointer away from its place, 0 to 1. */
const PULL = 0.45;

/** Where a held thing is drawn: its place, leaning toward where the pointer would put it. */
export const lean = (place: number, pointer: number) => place + (pointer - place) * PULL;
