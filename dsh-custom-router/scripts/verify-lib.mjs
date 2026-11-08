/** Small helpers shared by the verification scripts. */

/**
 * Whether a pid is still running.
 * @param {number} pid - process id.
 * @returns {boolean} true when the process exists and is signalable.
 */
export function isAlive(pid) {
  if (typeof pid !== 'number' || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Await a fixed delay.
 * @param {number} ms - milliseconds.
 * @returns {Promise<void>} settlement.
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
