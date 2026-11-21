import { drafterOutputSchema, piiDetectorOutputSchema, routerOutputSchema } from '../../data/ai-schemas'
import type { AwilixContainer } from 'awilix'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  PublicInfoDepartment,
  PublicInfoDepartmentQuery,
  PublicInfoDocument,
  PublicInfoRequest,
  PublicInfoRequestPoint,
  PublicInfoSettings,
  type StoredDraftParagraph,
} from '../../data/entities'
import { buildSimilarityIndex } from '../similarity'
import { normalizePolish } from '../text'
import {
  proposeRoutingByKeywords,
  type ArchiveHint,
  type DepartmentLike,
  type RoutingFlag,
  type RoutingProposal,
} from '../routing/keywords'
import { addCalendarMonths, internalDueDate, todayIso, type IsoDate } from '../deadlines'
import type { DraftParagraph, LetterContext, LetterType, ReplyText, Salutation } from '../drafting/types'
import { buildTemplateParagraphs } from '../drafting/templates'
import { draftFromReplies } from '../drafting/deterministic'
import { checkGrounding, contentHash } from '../drafting/grounding'
import { detectPiiByRules, mergeSpans, type PiiSpan } from '../pii/rules'
import { loadPoints, type Scope } from './requests'
import { runAssistantObject } from './assistant'

export type SimilarMatch = {
  requestId: string
  caseNumber: string
  receivedAt: string
  subjectSummary: string
  similarity: number
  coveredPoints: number[]
  departments: string[]
  finalLetterType: string | null
  answerExcerpt: string
  sharedTerms: string[]
  source: string
}

export type SimilarResult = { matches: SimilarMatch[]; searched: number; mode: 'vector' | 'tokens' }

export async function loadDepartments(em: EntityManager, scope: Scope, activeOnly = true): Promise<PublicInfoDepartment[]> {
  return em.find(
    PublicInfoDepartment,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      ...(activeOnly ? { isActive: true } : {}),
    },
    { orderBy: { name: 'asc' } },
  )
}

export function toDepartmentLike(department: PublicInfoDepartment): DepartmentLike {
  return {
    id: department.id,
    name: department.name,
    symbol: department.symbol,
    kind: department.kind,
    competenceScope: department.competenceScope,
    keywords: department.keywords ?? [],
    contractCodes: department.contractCodes ?? [],
  }
}

function departmentStem(name: string): string {
  return normalizePolish(name)
    .split(' ')
    .filter((word) => word.length > 3)
    .map((word) => word.slice(0, Math.max(4, word.length - 3)))
    .join(' ')
}

export function departmentsMentioned(text: string, departments: PublicInfoDepartment[]): string[] {
  const normalized = normalizePolish(text)
  const found: string[] = []
  for (const department of departments) {
    const stems = departmentStem(department.name).split(' ').filter(Boolean)
    if (stems.length === 0) continue
    const hits = stems.filter((stem) => normalized.includes(stem)).length
    if (hits / stems.length >= 0.75) found.push(department.name)
  }
  return found
}

async function archiveCandidates(em: EntityManager, scope: Scope, settings: PublicInfoSettings, excludeId?: string) {
  const windowStart = addCalendarMonths(todayIso(), -Math.max(1, settings.similarityWindowMonths))
  const rows = await em.find(
    PublicInfoRequest,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      archiveText: { $ne: null },
      receivedAt: { $gte: windowStart },
      ...(excludeId ? { id: { $ne: excludeId } } : {}),
    } as FilterQuery<PublicInfoRequest>,
    {
      fields: ['id', 'caseNumber', 'receivedAt', 'subjectSummary', 'archiveText', 'finalLetterType', 'source', 'status'],
      orderBy: { receivedAt: 'desc' },
      limit: 2000,
    },
  )
  return rows.filter((row) => row.status === 'sent' || row.source === 'import')
}

export async function findSimilarRequests(
  em: EntityManager,
  scope: Scope,
  input: { requestId?: string; text: string; points: Array<{ position: number; text: string }>; limit?: number },
  settings: PublicInfoSettings,
): Promise<SimilarResult> {
  const candidates = await archiveCandidates(em, scope, settings, input.requestId)
  const index = buildSimilarityIndex(
    candidates.map((candidate) => ({ id: candidate.id, text: `${candidate.subjectSummary}\n${candidate.archiveText ?? ''}` })),
  )
  const hits = index.query(input.text, input.limit ?? 5).filter((hit) => hit.score >= settings.similarityThreshold)
  const coverage = new Map<string, number[]>()
  for (const point of input.points) {
    for (const hit of index.query(point.text, 3)) {
      if (hit.score < settings.similarityThreshold) continue
      const list = coverage.get(hit.id) ?? []
      list.push(point.position)
      coverage.set(hit.id, list)
    }
  }
  const departments = hits.length > 0 ? await loadDepartments(em, scope, false) : []
  const departmentById = new Map(departments.map((department) => [department.id, department.name]))
  const queries = hits.length
    ? await em.find(PublicInfoDepartmentQuery, {
        requestId: { $in: hits.map((hit) => hit.id) },
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      })
    : []
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const matches: SimilarMatch[] = hits.map((hit) => {
    const candidate = byId.get(hit.id)!
    const fromQueries = queries
      .filter((query) => query.requestId === hit.id)
      .map((query) => departmentById.get(query.departmentId))
      .filter((name): name is string => Boolean(name))
    const answer = candidate.archiveText ?? ''
    const answerStart = answer.indexOf('ODPOWIEDŹ')
    const excerptSource = answerStart >= 0 ? answer.slice(answerStart + 'ODPOWIEDŹ'.length) : answer
    return {
      requestId: candidate.id,
      caseNumber: candidate.caseNumber,
      receivedAt: candidate.receivedAt,
      subjectSummary: candidate.subjectSummary,
      similarity: hit.score,
      coveredPoints: Array.from(new Set(coverage.get(hit.id) ?? [])).sort((left, right) => left - right),
      departments: Array.from(new Set(fromQueries.length > 0 ? fromQueries : departmentsMentioned(answer, departments))),
      finalLetterType: candidate.finalLetterType ?? null,
      answerExcerpt: excerptSource.replace(/\s+/g, ' ').trim().slice(0, 600),
      sharedTerms: hit.sharedTerms,
      source: candidate.source,
    }
  })
  return { matches, searched: index.size, mode: 'tokens' }
}

export type RoutingSuggestion = {
  proposals: Array<RoutingProposal & { departmentName: string; departmentKind: string; internalDueDate: IsoDate | null }>
  flags: RoutingFlag[]
  generatedBy: 'ai' | 'keywords'
}

export async function suggestRouting(params: {
  em: EntityManager
  container: AwilixContainer
  scope: Scope & { userId: string }
  request: PublicInfoRequest
  points: PublicInfoRequestPoint[]
  settings: PublicInfoSettings
}): Promise<RoutingSuggestion> {
  const { em, scope, request, points, settings } = params
  const departments = await loadDepartments(em, scope)
  const departmentLikes = departments.map(toDepartmentLike)
  const similar = await findSimilarRequests(
    em,
    scope,
    {
      requestId: request.id,
      text: [request.subjectSummary, ...points.map((point) => point.text)].join('\n'),
      points: points.map((point) => ({ position: point.position, text: point.text })),
    },
    settings,
  )
  const archiveHints: ArchiveHint[] = similar.matches.map((match) => ({
    caseNumber: match.caseNumber,
    similarity: match.similarity,
    departmentNames: match.departments,
    finalLetterType: match.finalLetterType,
  }))
  const pointInputs = points.length > 0
    ? points.map((point) => ({ position: point.position, text: point.text }))
    : [{ position: 1, text: request.subjectSummary }]
  let proposals: RoutingProposal[] = []
  let flags: RoutingFlag[] = []
  let generatedBy: RoutingSuggestion['generatedBy'] = 'keywords'
  const aiResult = await runAssistantObject({
    agentId: 'public_info_requests.router',
    schemaName: 'UdipRoutingProposal',
    schema: routerOutputSchema,
    container: params.container,
    scope,
    prompt: JSON.stringify({
      points: pointInputs,
      departments: departmentLikes.map((department) => ({
        id: department.id,
        name: department.name,
        kind: department.kind,
        competenceScope: department.competenceScope,
        keywords: department.keywords.slice(0, 30),
      })),
      similarCases: archiveHints,
    }),
  })
  const validIds = new Set(departments.map((department) => department.id))
  if (aiResult && aiResult.proposals.some((proposal) => validIds.has(proposal.departmentId))) {
    proposals = aiResult.proposals.filter((proposal) => validIds.has(proposal.departmentId))
    flags = aiResult.flags.filter((flag) => !flag.departmentId || validIds.has(flag.departmentId))
    generatedBy = 'ai'
  } else {
    const keywordResult = proposeRoutingByKeywords(pointInputs, departmentLikes, archiveHints)
    proposals = keywordResult.proposals
    flags = keywordResult.flags
  }
  const byId = new Map(departments.map((department) => [department.id, department]))
  const internal = internalDueDate(request.currentDueDate, settings.internalDueOffsetWorkingDays, settings.extraHolidays ?? [])
  return {
    proposals: proposals.map((proposal) => {
      const department = byId.get(proposal.departmentId)
      const separate = department?.kind === 'municipal_unit' || department?.kind === 'external'
      return {
        ...proposal,
        departmentName: department?.name ?? '',
        departmentKind: department?.kind ?? 'department',
        internalDueDate: separate ? null : internal,
      }
    }),
    flags,
    generatedBy,
  }
}

export async function loadCaseDocuments(em: EntityManager, scope: Scope, requestId: string, kind?: string): Promise<PublicInfoDocument[]> {
  return findWithDecryption(
    em,
    PublicInfoDocument,
    {
      requestId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      ...(kind ? { kind } : {}),
    } as FilterQuery<PublicInfoDocument>,
    { orderBy: { createdAt: 'asc' } },
    scope,
  )
}

export function salutationFor(request: PublicInfoRequest, override?: Salutation): Salutation {
  if (override) return override
  if (request.requesterKind !== 'person') return 'panstwo'
  const firstName = normalizePolish(request.requesterName.split(/\s+/)[0] ?? '')
  if (firstName.endsWith('a') && !['kuba', 'barnaba', 'bonawentura'].includes(firstName)) return 'pani'
  return 'pan'
}

export type LetterOptions = {
  salutation?: Salutation
  referralDepartmentId?: string
  bipUrl?: string
  extensionDueDate?: string
  extensionReason?: string
  clarificationQuestion?: string
  clarificationDepartmentName?: string
}

function genitiveEntityName(name: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/^Zarząd\b/, 'Zarządu'],
    [/^Kujawsko-Pomorski Wojewódzki Konserwator Zabytków/, 'Kujawsko-Pomorskiego Wojewódzkiego Konserwatora Zabytków'],
    [/^Schronisko\b/, 'Schroniska'],
    [/^Straż Miejska\b/, 'Straży Miejskiej'],
  ]
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(name)) return name.replace(pattern, replacement)
  }
  return name
}

export async function buildLetterContext(params: {
  em: EntityManager
  scope: Scope
  request: PublicInfoRequest
  points: PublicInfoRequestPoint[]
  departmentNames: string[]
  options: LetterOptions
  settings: PublicInfoSettings
  letterDate?: IsoDate
}): Promise<LetterContext> {
  const { request, points, options } = params
  let referral: LetterContext['referral']
  if (options.referralDepartmentId) {
    const department = await params.em.findOne(PublicInfoDepartment, {
      id: options.referralDepartmentId,
      tenantId: params.scope.tenantId,
      organizationId: params.scope.organizationId,
    })
    if (department) {
      referral = {
        entityName: genitiveEntityName(department.name),
        contactBlock: [department.name, ...(department.contactHint ?? '').split(/,\s*(?=e-mail)|\n/).map((line) => line.trim()).filter(Boolean)].join('\n'),
      }
    }
  }
  return {
    caseNumber: request.caseNumber,
    letterDate: params.letterDate ?? todayIso(),
    requesterName: request.requesterName,
    requesterAddressLines: request.requesterAddress ? request.requesterAddress.split(/,\s*|\n/).filter(Boolean) : [],
    salutation: salutationFor(request, options.salutation),
    requestDate: request.letterDate ?? null,
    receivedAt: request.receivedAt,
    subjectSummary: request.subjectSummary,
    points: points.map((point) => ({ position: point.position, text: point.text })),
    departments: params.departmentNames,
    ...(referral ? { referral } : {}),
    ...(options.bipUrl ? { bipUrl: options.bipUrl } : {}),
    ...(options.extensionDueDate ? { extension: { newDueDate: options.extensionDueDate, reason: options.extensionReason ?? 'konieczność przeprowadzenia całościowej kwerendy' } } : {}),
    ...(options.clarificationQuestion
      ? {
          clarification: {
            departmentName: options.clarificationDepartmentName ?? 'komórka merytoryczna',
            question: options.clarificationQuestion,
            days: params.settings.clarificationDays,
            newDueDate: null,
          },
        }
      : {}),
  }
}

export async function generateDraftParagraphs(params: {
  container: AwilixContainer
  scope: Scope & { userId: string }
  letterType: LetterType
  context: LetterContext
  replies: ReplyText[]
  archiveAnswer?: { documentId: string; text: string } | null
}): Promise<{ paragraphs: DraftParagraph[]; generatedBy: 'ai' | 'template' }> {
  const { letterType, context, replies } = params
  const sourceTexts = [
    ...replies.map((reply) => ({ attachmentId: reply.attachmentId, text: reply.text })),
    ...(params.archiveAnswer ? [{ attachmentId: params.archiveAnswer.documentId, text: params.archiveAnswer.text }] : []),
  ]
  let paragraphs: DraftParagraph[] | null = null
  let generatedBy: 'ai' | 'template' = 'template'
  if (letterType === 'answer' && (replies.length > 0 || params.archiveAnswer)) {
    const aiResult = await runAssistantObject({
      agentId: 'public_info_requests.drafter',
      schemaName: 'UdipAnswerDraft',
      schema: drafterOutputSchema,
      container: params.container,
      scope: params.scope,
      prompt: JSON.stringify({
        letterType,
        points: context.points,
        departments: context.departments,
        replies: replies.map((reply) => ({ attachmentId: reply.attachmentId, department: reply.departmentName, points: reply.pointPositions, text: reply.text.slice(0, 12000) })),
        archiveAnswer: params.archiveAnswer ? { attachmentId: params.archiveAnswer.documentId, text: params.archiveAnswer.text.slice(0, 8000) } : null,
      }),
    })
    if (aiResult && aiResult.paragraphs.some((paragraph) => paragraph.kind === 'point')) {
      const template = buildTemplateParagraphs(letterType, context)
      const intro = template.filter((paragraph) => paragraph.kind === 'intro')
      const closing = template.filter((paragraph) => paragraph.kind === 'closing')
      const body = aiResult.paragraphs
        .filter((paragraph) => paragraph.kind === 'point' || paragraph.kind === 'note')
        .map((paragraph, index) => ({
          id: `${paragraph.kind}-${index}`,
          kind: paragraph.kind,
          pointPosition: paragraph.pointPosition,
          text: paragraph.text,
          contentHash: contentHash(paragraph.text),
          sources: paragraph.sources,
          flags: [] as DraftParagraph['flags'],
        }))
      paragraphs = [...intro, ...body, ...closing]
      generatedBy = 'ai'
    }
  }
  const archiveReplies: ReplyText[] = params.archiveAnswer
    ? [{ attachmentId: params.archiveAnswer.documentId, departmentName: '', text: params.archiveAnswer.text, pointPositions: context.points.map((point) => point.position) }]
    : []
  const effectiveReplies = replies.length > 0 ? replies : archiveReplies
  if (!paragraphs) {
    paragraphs = letterType === 'answer' || letterType === 'no_statistics'
      ? draftFromReplies(letterType, context, effectiveReplies)
      : buildTemplateParagraphs(letterType, context)
  }
  paragraphs = fillAttachmentReferences(paragraphs, effectiveReplies, replies.length === 0 && archiveReplies.length > 0)
  const grounded = checkGrounding(paragraphs, context, sourceTexts)
  return { paragraphs: grounded, generatedBy }
}

function fillAttachmentReferences(paragraphs: DraftParagraph[], replies: ReplyText[], fromArchive: boolean): DraftParagraph[] {
  return paragraphs.map((paragraph) => {
    if (paragraph.kind === 'point' && paragraph.text.trim().length > 0) {
      return fromArchive && !paragraph.flags.includes('assistant_only') ? { ...paragraph, flags: [...paragraph.flags, 'assistant_only'] } : paragraph
    }
    if (paragraph.kind !== 'point' || paragraph.pointPosition === undefined) return paragraph
    const position = paragraph.pointPosition
    const reply = replies.find((candidate) => candidate.pointPositions.length === 0 || candidate.pointPositions.includes(position)) ?? replies[0]
    if (!reply) return paragraph
    const department = reply.departmentName ? reply.departmentName.replace(/^Wydział/, 'Wydział') : 'komórka merytoryczna'
    const text = `Ad ${position}\nInformację w zakresie pytania nr ${position} zawiera załączony materiał przygotowany przez: ${department}.`
    return {
      ...paragraph,
      text,
      contentHash: contentHash(text),
      sources: [{ attachmentId: reply.attachmentId, quote: reply.text.replace(/\s+/g, ' ').slice(0, 160) }],
      flags: fromArchive ? ['assistant_only'] : [],
    }
  })
}

export function toStoredParagraphs(paragraphs: DraftParagraph[]): StoredDraftParagraph[] {
  return paragraphs.map((paragraph) => ({
    id: paragraph.id,
    kind: paragraph.kind,
    ...(paragraph.pointPosition !== undefined ? { pointPosition: paragraph.pointPosition } : {}),
    text: paragraph.text,
    contentHash: paragraph.contentHash || contentHash(paragraph.text),
    sources: paragraph.sources,
    flags: paragraph.flags,
    ...(paragraph.mismatchTokens ? { mismatchTokens: paragraph.mismatchTokens } : {}),
    confirmedBy: paragraph.confirmedBy ?? null,
  }))
}

export async function detectPii(params: {
  container: AwilixContainer
  scope: Scope & { userId: string }
  text: string
  publicOfficials: string[]
  keepNames: string[]
}): Promise<PiiSpan[]> {
  const ruleSpans = detectPiiByRules(params.text, { publicOfficials: params.publicOfficials, keepNames: params.keepNames })
  const aiResult = params.text.trim().length > 0
    ? await runAssistantObject({
        agentId: 'public_info_requests.pii_detector',
        schemaName: 'UdipPiiSpans',
        schema: piiDetectorOutputSchema,
        container: params.container,
        scope: params.scope,
        prompt: JSON.stringify({ text: params.text.slice(0, 6000), publicOfficials: params.publicOfficials, keepNames: params.keepNames }),
      })
    : null
  const aiSpans: PiiSpan[] = (aiResult?.spans ?? [])
    .filter((span) => span.end <= params.text.length && span.start < span.end)
    .map((span) => ({
      start: span.start,
      end: span.end,
      category: (span.category as PiiSpan['category']) ?? 'other',
      detector: 'ai' as const,
      confidence: span.confidence,
      text: params.text.slice(span.start, span.end),
    }))
    .filter((span) => !params.keepNames.some((name) => span.text.includes(name)) && !params.publicOfficials.some((name) => span.text.includes(name)))
  return mergeSpans([...ruleSpans, ...aiSpans], params.text)
}

export async function loadDepartmentQueries(em: EntityManager, scope: Scope, requestId: string): Promise<PublicInfoDepartmentQuery[]> {
  return em.find(
    PublicInfoDepartmentQuery,
    { requestId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { orderBy: { createdAt: 'asc' } },
  )
}

export async function loadReplyTexts(em: EntityManager, scope: Scope, requestId: string): Promise<{ replies: ReplyText[]; departmentNames: string[] }> {
  const [queries, documents, departments] = await Promise.all([
    loadDepartmentQueries(em, scope, requestId),
    loadCaseDocuments(em, scope, requestId, 'reply'),
    loadDepartments(em, scope, false),
  ])
  const departmentById = new Map(departments.map((department) => [department.id, department]))
  const queryById = new Map(queries.map((query) => [query.id, query]))
  const replies: ReplyText[] = []
  const names = new Set<string>()
  for (const document of documents) {
    if (!document.extractedText) continue
    const query = document.departmentQueryId ? queryById.get(document.departmentQueryId) : undefined
    const department = query ? departmentById.get(query.departmentId) : undefined
    if (department) names.add(department.name)
    replies.push({
      attachmentId: document.id,
      departmentName: department?.name ?? '',
      text: document.extractedText,
      pointPositions: query?.pointPositions ?? [],
    })
  }
  for (const query of queries) {
    if (query.receivedAt && query.replyKind) {
      const department = departmentById.get(query.departmentId)
      if (department) names.add(department.name)
    }
  }
  return { replies, departmentNames: Array.from(names) }
}

export async function requestPointsOrSummary(em: EntityManager, scope: Scope, request: PublicInfoRequest): Promise<PublicInfoRequestPoint[]> {
  const points = await loadPoints(em, scope, request.id)
  if (points.length > 0) return points
  return [Object.assign(new PublicInfoRequestPoint(), { id: 'summary', requestId: request.id, position: 1, text: request.subjectSummary })]
}
