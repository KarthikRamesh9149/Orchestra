/** Private child of qualify-isolated-ai-recovery.mjs. Synthetic transports only. */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const send = value => process.send?.(value);
const check = (condition, message) => { if (!condition) { const error = new Error(message); error.name = 'RecoveryAssertion'; throw error; } };
const digest = value => createHash('sha256').update(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item)).digest('hex');
let currentController;
process.on('message', async message => {
  if (message?.type === 'cancel') { currentController?.abort(); return; }
  if (message?.type !== 'probe' || !process.send) return;
  process.removeAllListeners('message');
  process.on('message', event => { if (event?.type === 'cancel') currentController?.abort(); });
  const config = message.config;
  let prisma, limiter;
  let stage = 'imports';
  const counters = { fetchAttempts: 0, mockEmbeddings: 0, mockObjects: 0, mockStreams: 0 };
  globalThis.fetch = async () => { counters.fetchAttempts++; throw new Error('Network forbidden in synthetic recovery probe'); };
  try {
    const imported = await import(pathToFileURL(join(config.backend, 'node_modules/@prisma/client/default.js')).href);
    const load = path => import(pathToFileURL(join(config.backend, 'dist/src', path + '.js')).href);
    const [{ parseEnv }, { buildContext }, { createLogger }, { TelemetryService }, { PrivateLocalStorageDriver }, { OfflineTranscriptionProvider }, { PostgresJobDispatcher }, { PostgresWorker }, { PostgresAiLimiter }] = await Promise.all([
      load('config/env'), load('setup-context'), load('lib/logging/logger'), load('lib/observability/telemetry'), load('lib/storage/private-local'), load('lib/ai/offline'), load('lib/jobs/postgres'), load('lib/jobs/postgres-worker'), load('lib/ai-ops/postgres-limits')
    ]);
    prisma = new (imported.PrismaClient ?? imported.default.PrismaClient)({ datasources: { db: { url: config.databaseUrl } } });
    const secret = config.secrets;
    const env = parseEnv({
      RUNTIME_PROFILE: 'desktop-local', NODE_ENV: 'production', DEPLOYMENT_ENV: 'production', HOST: '127.0.0.1', PORT: 43119,
      APP_BASE_URL: 'http://127.0.0.1:43119', CORS_ALLOWED_ORIGINS: 'http://127.0.0.1:43119', DATABASE_URL: config.databaseUrl,
      REDIS_URL: '', QUEUE_MODE: 'postgres', STORAGE_DRIVER: 'local', STORAGE_LOCAL_ROOT: join(config.profile, 'data/files'),
      JWT_ACCESS_SECRET: secret.access, JWT_REFRESH_SECRET: secret.refresh, CLIENT_SHARE_TOKEN_SECRET: secret.clientShare,
      CONNECTOR_OAUTH_STATE_SECRET: secret.oauthState, CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: secret.connectorEncryption,
      VSCODE_CONNECTOR_TOKEN_SECRET: secret.oauthState, SIGNUP_MODE: 'disabled', LOG_LEVEL: 'error', MCP_ENABLED: 'false',
      BETA_DEEP_RESEARCH_ENABLED: 'true', DESKTOP_AI_PROVIDER: 'openai'
    });
    let behavior = config.mode;
    const embeddingProvider = { embedText: async () => {
      counters.mockEmbeddings++;
      if (behavior === 'domain_claim' || behavior === 'queue_claim') {
        send({ type: 'claimed', mode: behavior });
        await new Promise(() => {});
      }
      return [1, ...Array(1535).fill(0)];
    } };
    const generationProvider = {
      generateObject: async input => {
        counters.mockObjects++;
        const report = {
          executiveSummary: 'Synthetic recovery fixture: CSV columns are item_id, title, owner, status. [E1]',
          findings: [{ category: 'SCOPE', severity: 'MEDIUM', title: 'Recorded CSV fields', description: 'The synthetic document records item_id, title, owner, status. [E1]', sources: 'E1' }],
          marketContext: [], expansionOpportunities: [], recommendedActions: []
        };
        return input.schema.parse(report);
      },
      streamText: async input => {
        counters.mockStreams++;
        if (behavior === 'chat_failure') {
          input.onDelta?.('SYNTHETIC_INCOMPLETE_TRANSPORT_PREFIX');
          throw new Error('Synthetic provider transport failure');
        }
        if (behavior === 'chat_cancel') {
          input.onDelta?.('SYNTHETIC_CANCELLED_TRANSPORT_PREFIX');
          send({ type: 'streaming' });
          await new Promise((_, reject) => {
            const abort = () => { const error = new Error('Synthetic cancelled transport'); error.name = 'AbortError'; reject(error); };
            if (input.signal?.aborted) abort(); else input.signal?.addEventListener('abort', abort, { once: true });
          });
        }
        const text = 'The synthetic CSV specification records exactly four columns: item_id, title, owner, status. [E1]';
        input.onDelta?.(text);
        return text;
      }
    };
    limiter = new PostgresAiLimiter(prisma);
    const compose = db => buildContext({ env, prisma: db, logger: createLogger('error'), storage: new PrivateLocalStorageDriver(join(config.profile, 'data/files')), generationProvider, embeddingProvider,
      transcriptionProvider: new OfflineTranscriptionProvider(), telemetry: new TelemetryService(), jobs: new PostgresJobDispatcher(db), aiLimiter: limiter });
    const context = compose(prisma);
    const research = context.services.deepResearchService;
    const queue = new PostgresJobDispatcher(prisma);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: config.projectId } });
    const member = await prisma.projectMember.findFirstOrThrow({ where: { projectId: project.id } });
    const actor = { userId: member.userId, orgId: project.orgId };
    const worker = () => new PostgresWorker(prisma, tx => ({ deep_research_run: payload => compose(tx).services.deepResearchService.runResearchJob(payload.projectId, payload.runId, payload.actorUserId) }));
    const state = async () => {
      const [runs, jobs, accepted, proposals, documents, messages, completionAudits, external, pending] = await Promise.all([
        prisma.deepResearchRun.findMany({ where: { projectId: project.id }, orderBy: { id: 'asc' } }),
        prisma.$queryRaw`SELECT id,status,attempts,failure_code,lease_until,idempotency_key,payload FROM desktop_jobs WHERE name='deep_research_run' ORDER BY id`,
        prisma.artifactVersion.findMany({ where: { projectId: project.id, status: 'accepted' }, orderBy: { id: 'asc' } }),
        prisma.specChangeProposal.findMany({ where: { projectId: project.id, status: 'accepted' }, orderBy: { id: 'asc' } }),
        prisma.document.findMany({ where: { projectId: project.id }, include: { versions: { include: { chunks: true } } }, orderBy: { id: 'asc' } }),
        prisma.socratesMessage.findMany({ where: { session: { projectId: project.id } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
        prisma.auditEvent.count({ where: { projectId: project.id, eventType: 'deep_research.run_completed' } }),
        prisma.$queryRaw`SELECT COALESCE(jsonb_array_length(data->'timestamps'),0)::int AS count FROM desktop_limit_state WHERE key='request:desktop:external-ai'`,
        prisma.$queryRaw`SELECT count(*)::int AS count FROM desktop_jobs WHERE status IN ('queued','running')`
      ]);
      return {
        runs: runs.map(run => ({ id: run.id, status: run.status, leaseExpiresAt: run.leaseExpiresAt?.getTime() ?? null, leaseOwnerPresent: Boolean(run.leaseOwnerToken), resultsHash: run.resultsJson ? digest(run.resultsJson) : null, documentCount: run.statsJson?.docs ?? null, errorPresent: Boolean(run.errorMessage) })),
        jobs: jobs.map(job => ({ id: job.id, status: job.status, attempts: job.attempts, failureCode: job.failure_code, leaseUntil: job.lease_until?.getTime() ?? null, runId: job.payload.runId })),
        acceptedHash: digest(accepted), acceptedCount: accepted.length, proposalsHash: digest(proposals), documentHash: digest(documents),
        messages: messages.map(item => ({ id: item.id, sessionId: item.sessionId, role: item.role, content: item.content, responseStatus: item.responseStatus, payloadHash: digest(item.answerPayloadJson), cancelled: item.answerPayloadJson?.cancelled === true, degraded: item.answerPayloadJson?.modelMetadata?.degraded })),
        completionAudits, providerRequests: external[0]?.count ?? 0, pendingJobCount: pending[0]?.count ?? 0
      };
    };
    stage = config.mode;
    let result;
    if (config.mode === 'seed') {
      const accepted = await prisma.artifactVersion.count({ where: { projectId: project.id, status: 'accepted' } });
      if (!accepted) {
        const highest = await prisma.artifactVersion.aggregate({ where: { projectId: project.id, artifactType: 'product_brain' }, _max: { versionNumber: true } });
        await prisma.artifactVersion.create({ data: { projectId: project.id, artifactType: 'product_brain', status: 'accepted', versionNumber: (highest._max.versionNumber ?? 0) + 1, payloadJson: { syntheticRecoverySentinel: true, nodes: [], edges: [] }, createdBy: member.userId, acceptedAt: new Date() } });
      }
      const create = () => prisma.deepResearchRun.create({ data: { projectId: project.id, orgId: project.orgId, createdByUserId: member.userId, researchFocus: 'Assess Northstar CSV export requirements and product decisions still needed before launch.', sourcesJson: ['docs'], outputFormat: 'full_report', privacyMode: 'internal_only', webSearchRequested: false } });
      const domain = await create();
      const queued = await create();
      await queue.enqueue('deep_research_run', { projectId: project.id, runId: queued.id, actorUserId: member.userId }, 'isolated-recovery:' + queued.id);
      result = { domainRunId: domain.id, queuedRunId: queued.id, state: await state() };
    } else if (config.mode === 'domain_claim') {
      await research.runResearchJob(project.id, config.runId, member.userId);
      check(false, 'Domain claim did not pause');
    } else if (config.mode === 'queue_claim') {
      await worker().runOnce();
      check(false, 'Queue claim did not pause');
    } else if (config.mode === 'inspect') result = await state();
    else if (config.mode === 'reconcile_queue') {
      check(await worker().runOnce() === false, 'Unexpected runnable job during expired-lease reconciliation');
      result = await state();
    } else if (config.mode === 'retry_queue') {
      const row = (await prisma.$queryRaw`SELECT id,payload FROM desktop_jobs WHERE id=${config.jobId}::uuid`)[0];
      check(row?.payload.projectId === project.id, 'Retry fixture does not belong to authorized project');
      await context.services.projectService.ensureProjectAccess(project.id, member.userId);
      check(await queue.retryFailed(row.id), 'Explicit retry did not succeed');
      // Wait the real production retry backoff; do not edit available_at.
      for (let attempt = 0; attempt < 40; attempt++) {
        if (await worker().runOnce()) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const before = await state();
      check(before.runs.find(run => run.id === row.payload.runId)?.status === 'completed', 'Retried research did not complete');
      await queue.enqueue('deep_research_run', row.payload, 'isolated-recovery:' + row.payload.runId);
      check(await worker().runOnce() === false, 'Duplicate queue identity became runnable');
      await research.runResearchJob(project.id, row.payload.runId, member.userId);
      const after = await state();
      result = { before, after, duplicateStable: digest(before) === digest(after) };
    } else if (config.mode === 'expire_domain') {
      result = { dto: await research.getRun(project.id, config.runId, actor), state: await state() };
    } else if (['chat_clean', 'chat_failure', 'chat_cancel'].includes(config.mode)) {
      currentController = new AbortController();
      const before = await state();
      let ids, response, caught = false;
      try {
        response = await context.services.socratesService.askV1ProjectMemory({ projectId: project.id, actorUserId: member.userId,
          question: 'According to Northstar CSV Recovery Specification, list the CSV fields in order with a citation.', selectedSources: ['documents'], sessionId: config.sessionId,
          signal: currentController.signal, onDelta: () => {}, onMessageCreated: value => { ids = value; } });
      } catch (error) {
        if (config.mode !== 'chat_cancel' || error.name !== 'AbortError') throw error;
        caught = true;
      }
      const after = await state();
      check(before.messages.every(old => after.messages.some(next => digest(next) === digest(old))), 'Earlier chat message changed');
      check(after.messages.length === before.messages.length + 2, 'Turn did not persist exactly two messages');
      check(after.messages.every(item => item.responseStatus !== 'streaming'), 'A chat placeholder remained streaming');
      const assistant = after.messages.find(item => item.id === (ids?.assistantMessageId ?? response?.messageId));
      check(Boolean(assistant), 'Persisted assistant message missing');
      if (config.mode === 'chat_failure') check(assistant.responseStatus === 'completed' && response?.modelMetadata?.degraded === true && !assistant.content.includes('SYNTHETIC_INCOMPLETE_TRANSPORT_PREFIX'), 'Provider failure did not persist an explicit degraded fallback');
      else if (config.mode === 'chat_cancel') check(caught && assistant.responseStatus === 'failed' && assistant.cancelled && assistant.content === 'Response stopped.', 'Cancellation was not explicit and durable');
      else check(assistant.responseStatus === 'completed' && response?.modelMetadata?.degraded === false, 'Clean synthetic turn did not complete');
      result = { sessionId: assistant.sessionId, assistantId: assistant.id, cancelled: caught, degraded: response?.modelMetadata?.degraded ?? null, state: after };
    } else check(false, 'Unknown isolated probe mode');
    check(counters.fetchAttempts === 0, 'Probe attempted network access');
    send({ type: 'result', result, counters });
  } catch (error) {
    send({ type: 'failure', stage, reason: error?.name === 'RecoveryAssertion' ? error.message : 'Isolated probe failed: ' + String(error?.name ?? 'Error') + (typeof error?.code === 'string' && /^[A-Za-z0-9_]{1,60}$/.test(error.code) ? '/' + error.code : ''), counters });
    process.exitCode = 1;
  } finally {
    await limiter?.close().catch(() => {});
    await prisma?.$disconnect().catch(() => {});
    process.disconnect?.();
  }
});
