/** SHA-256 hex digest of a string. Used to fingerprint the studyflow XML so
 *  downstream telemetry can pin every event to the exact source document. */
export async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
