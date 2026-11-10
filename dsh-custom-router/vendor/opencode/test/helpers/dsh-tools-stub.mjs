/**
 * Minimal stand-in for `@deepseek-ai/dsh-tools` `defineTool`.
 *
 * The real symbol is identity today (it returns the definition it is handed),
 * so this stub mirrors that behavior; the point is to let the plugin's apply()
 * run without the host toolchain installed. Host integration is covered by the
 * isolated-profile verification step, not by this unit test.
 */
export function defineTool(definition) {
  if (!definition || typeof definition !== 'object') throw new TypeError('defineTool expects an object')
  if (typeof definition.name !== 'string' || !definition.name) throw new TypeError('defineTool: name required')
  if (!definition.output || typeof definition.output.render !== 'function') {
    throw new TypeError('defineTool: output.render required')
  }
  return definition
}
