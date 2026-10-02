import { BPMN } from '@core/constants';
import type { Issue } from '@core/checks';
import { quoted } from '@core/checks/graph';
import type { Element, StudyModel } from '@core/model/index';

/** `sha256:` and 64 lowercase hex digits, as {@link contentDigest} writes a digest. */
const DIGEST = /^sha256:[0-9a-f]{64}$/;

/**
 * A file a study registers by its content: a data element's `uri` that carries a `digest` (a trial list, a stimulus
 * set), or a start event's `consentFormUri` that carries a `consentFormDigest`. The digest is an attribute, so it is
 * part of the protocol digest; the content it registers is checked by {@link checkMaterials}.
 */
type Material = { elementId?: string; label: string; uri: string; digest: string; attributes: [uri: string, digest: string] };

/** What reading a material gave: its bytes, or why there are none and whether that is an error (no such file) or a
 * warning (an address that did not answer, a scheme the reader does not read). */
export type MaterialContent = Uint8Array<ArrayBuffer> | { unread: string; severity: Issue['severity'] };

/** The SHA-256 of `bytes`, as a study writes a material's digest. */
export async function contentDigest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `sha256:${Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** The materials a study registers by their content, in file order. */
function registeredMaterials(model: StudyModel): Material[] {
  const found: Material[] = [];
  const text = (element: Element, name: string): string => {
    const value = model.attribute(element, name);
    return typeof value === 'string' ? value.trim() : '';
  };
  for (const element of model.all()) {
    const attributes: Material['attributes'] | undefined = model.isA(element, BPMN.StartEvent) ? ['consentFormUri', 'consentFormDigest']
      : model.isA(element, 'bpmn:ItemAwareElement') ? ['uri', 'digest'] : undefined;
    const digest = attributes && text(element, attributes[1]);
    if (!attributes || !digest) continue;
    found.push({ elementId: model.ownerOf(element), label: quoted(element), uri: text(element, attributes[0]), digest, attributes });
  }
  return found;
}

/**
 * Each registered material's content against the digest the study holds for it. `read` is how this machine gets a
 * material's bytes (the CLI reads a path beside the study, or fetches an address); this module does no I/O. A
 * mismatch is an error that names the content's digest, so an author registers a material by pasting it; `note`
 * says what matched.
 */
export async function checkMaterials(model: StudyModel, read: (uri: string) => Promise<MaterialContent>): Promise<{ issues: Issue[]; note?: string }> {
  const issues: Issue[] = [];
  let matched = 0;
  for (const { elementId, label, uri, digest, attributes: [uriName, digestName] } of registeredMaterials(model)) {
    const report = (severity: Issue['severity'], message: string): void => { issues.push({ severity, elementId, message }); };
    if (!uri) {
      report('error', `${label} registers a ${digestName} of nothing: set ${uriName}, or drop ${digestName}`);
      continue;
    }
    // A placeholder is read at run time, and a consent form's path from the site's root is the page's to serve.
    if (uri.includes('{') || (uriName === 'consentFormUri' && uri.startsWith('/'))) {
      report('warning', `${label} registers ${uri}, which ${uri.includes('{') ? 'is read at run time' : 'the site that runs the study serves'}, so its content was not checked against ${digestName}`);
      continue;
    }
    const content = await read(uri);
    if (!(content instanceof Uint8Array)) {
      report(content.severity, `${label} registers ${uri} by its ${digestName}, and ${content.unread}`);
      continue;
    }
    const actual = await contentDigest(content);
    if (actual === digest) {
      matched += 1;
      continue;
    }
    report('error', DIGEST.test(digest)
      ? `${label} registers ${uri} as ${digest.slice(0, 19)}…, and its content is ${actual}: restore the registered content, or register this one with ${digestName}: ${actual}`
      : `${label} registers ${uri} by ${JSON.stringify(digest)}, which is not a digest (\`sha256:\` and 64 lowercase hex digits): its content is ${actual}, registered with ${digestName}: ${actual}`);
  }
  const note = matched === 0 ? undefined : matched === 1 ? 'the registered material matches its digest' : `the ${matched} registered materials match their digests`;
  return { issues, note };
}
