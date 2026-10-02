import { expect, test } from '@playwright/test';

import { checkMaterials, contentDigest, type MaterialContent } from '@core/checks/materials';
import { studyModel } from '@tests/schemas';

/** A registered material (a data element's `uri` with a `digest`, a start event's consent form with a
 * `consentFormDigest`) is checked against its digest by what the CLI reads (`packages/cli/src/materials.ts`); here the
 * reader is a table. That the digest is part of the protocol is pinned in protocol-digest.unit.spec.ts. */

const bytes = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);
const TRIALS = 'Trial,Congruency\n1,Congruent\n2,Incongruent\n';
const CONSENT = '# Consent\n\nYou may stop at any time.\n';

/** A study whose start event and trial list carry what `start` and `trials` add. */
const study = (start: string, trials: string): string => `id: materials
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
S:
  type: Process
  flowElements:
    In:
      type: StartEvent
      name: Consented
${start}
    Play:
      type: Task
      dataInputAssociations:
        In_Trials: { sourceRef: [Trials] }
    Trials:
      type: studyflow:Table
      name: Trial list
${trials}
    Out:
      type: EndEvent
    F1: In -> Play
    F2: Play -> Out
`;

/** What the reader gives for each address or path: a file's bytes, a missing file, an address that did not answer. */
const READS: Record<string, MaterialContent> = {
  'trials.csv': bytes(TRIALS),
  'https://example.org/consent.md': bytes(CONSENT),
  'gone.csv': { unread: 'there is no /study/gone.csv', severity: 'error' },
  'https://example.org/down.md': { unread: 'it could not be fetched (fetch failed), so its content was not checked', severity: 'warning' },
};

test('a registered material\'s content is checked against its digest, which a mismatch names so it can be pasted', async () => {
  const trials = await contentDigest(bytes(TRIALS));
  const consent = await contentDigest(bytes(CONSENT));
  const CASES: [label: string, start: string, trials: string, issues: string[], note?: string][] = [
    ['a trial list and a consent form, both as registered', '      consentFormUri: https://example.org/consent.md\n      consentFormDigest: ' + consent,
      `      uri: trials.csv\n      digest: ${trials}`, [], 'the 2 registered materials match their digests'],
    ['a uri without a digest registers nothing', '', '      uri: trials.csv', []],
    ['a trial list that changed since it was registered', '', `      uri: trials.csv\n      digest: sha256:${'0'.repeat(64)}`,
      [`error Trials: "Trial list" registers trials.csv as sha256:000000000000…, and its content is ${trials}: restore the registered content, or register this one with digest: ${trials}`]],
    ['a digest yet to be written', '', '      uri: trials.csv\n      digest: new',
      [`error Trials: "Trial list" registers trials.csv by "new", which is not a digest (\`sha256:\` and 64 lowercase hex digits): its content is ${trials}, registered with digest: ${trials}`]],
    ['a digest of nothing', '', `      digest: ${trials}`, ['error Trials: "Trial list" registers a digest of nothing: set uri, or drop digest']],
    ['a file that is not there', '', `      uri: gone.csv\n      digest: ${trials}`, ['error Trials: "Trial list" registers gone.csv by its digest, and there is no /study/gone.csv']],
    ['an address that does not answer', '      consentFormUri: https://example.org/down.md\n      consentFormDigest: ' + consent, '',
      ['warning In: "Consented" registers https://example.org/down.md by its consentFormDigest, and it could not be fetched (fetch failed), so its content was not checked']],
    ['a consent form the site serves', '      consentFormUri: /consent.md\n      consentFormDigest: ' + consent, '',
      ['warning In: "Consented" registers /consent.md, which the site that runs the study serves, so its content was not checked against consentFormDigest']],
    ['an address read at run time', '', `      uri: "{trials}"\n      digest: ${trials}`,
      ['warning Trials: "Trial list" registers {trials}, which is read at run time, so its content was not checked against digest']],
  ];
  for (const [label, start, list, says, note] of CASES) {
    const read: string[] = [];
    const { issues, note: noted } = await checkMaterials(studyModel(study(start, list)), async (uri) => {
      read.push(uri);
      return READS[uri];
    });
    expect(issues.map((issue) => `${issue.severity} ${issue.elementId}: ${issue.message}`), label).toEqual(says);
    expect(noted, label).toBe(note);
    // Only what carries a digest, and can be read here, is read.
    expect(read.every((uri) => uri in READS), label).toBe(true);
  }
});
