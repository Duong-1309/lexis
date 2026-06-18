type DebugPayload = Record<string, unknown>

export function debugLog(scope: string, event: string, payload: DebugPayload = {}): void {
  const entry = {
    time: new Date().toISOString(),
    scope,
    event,
    ...payload,
  }
  console.info('[LexisDebug]', entry)
}
