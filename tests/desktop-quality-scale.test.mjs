import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessQuality} from '../scripts/desktop/benchmark-quality-scale.mjs';

const fixture = {
  projectId: 'project', forbidden: ['foreign-chunk'],
  chunks: [1, 2, 8].map(number => ({id: `chunk-${number}`, allowed: true,
    projectid: 'project', documentid: `doc-${number}`, versionid: `version-${number}`})),
};
function response(text = 'The source records a review window [E8].', numbers = [8]) {
  return {
    answer_md: text,
    citations: numbers.map(number => ({evidenceNumber: number, refId: `chunk-${number}`, openTargetId: `target-${number}`})),
    open_targets: numbers.map(number => ({id: `target-${number}`, targetRef: {
      documentId: `doc-${number}`, documentVersionId: `version-${number}`,
    }})),
    modelMetadata: {provider: 'openai', degraded: false},
    safety: {directMutationAllowed: false, pendingChangesAreTruth: false},
  };
}
function assess(answer, name = 'citation_regression') {
  return assessQuality(answer, {name}, fixture, {deltaCount: 2, streamText: answer.answer_md});
}

test('recognises the recorded None abstention without rewriting its answer', () => {
  const answer = response('None of the supplied project documents records Nightorchid.', []);
  assert.equal(assess(answer, 'foreign_fact_absence').passed, true);
});

test('absence wording does not allow a foreign sentinel to leak', () => {
  const answer = response('None of the supplied documents records TENANT_SEALED_ORCHID.', []);
  assert.equal(assess(answer, 'foreign_fact_absence').passed, false);
});

test('every displayed marker needs its original explicit identity, not card position', () => {
  assert.equal(assess(response()).passed, true);
  assert.equal(assess(response('First [E2], then [E1].', [2, 1])).passed, true);
  assert.equal(assess(response('References [E1] and [E8].', [1])).passed, false);
  const legacy = response();
  delete legacy.citations[0].evidenceNumber;
  assert.equal(assess(legacy).passed, false);
});

test('duplicate identities and missing source targets cannot pass', () => {
  assert.equal(assess(response('Source [E8].', [8, 8])).passed, false);
  const missing = response(); missing.open_targets = [];
  assert.equal(assess(missing).passed, false);
});

test('generated abstention must match the actual stream too', () => {
  const answer = response('None of the supplied project documents records Nightorchid.', []);
  const result = assessQuality(answer, {name: 'foreign_fact_absence'}, fixture,
    {deltaCount: 1, streamText: 'Different text'});
  assert.equal(result.checks.streamedAnswerMatches, false);
});
