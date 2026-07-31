/**
 * Height floor of the SmartLink placement, in pixels.
 *
 * One constant for one surface: the install wizard registers the UF type with this as the
 * initial frame height, and the placement passes the same value to `resizeWindowAuto` as the
 * minimum it will shrink to. These lived apart (65 vs 85) — every render began by asking the
 * portal to grow a frame registered smaller than the floor it was about to enforce.
 */
export const PLACEMENT_MIN_HEIGHT = 85
