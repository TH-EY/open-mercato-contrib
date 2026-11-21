import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  PublicInfoDepartment,
  PublicInfoDocument,
  PublicInfoRequest,
  PublicInfoRequestEvent,
  PublicInfoRequestPoint,
  type PublicInfoRequestStatus,
} from '../../data/entities'
import { DEPARTMENT_SEEDS } from '../seed/departments'
import { parsePolishDate, parseRequestText } from '../intake/parse'
import { anonymizeForArchive } from '../pii/redact'
import { addCalendarDays, todayIso, type IsoDate } from '../deadlines'
import { computeDeadlines, loadSettings, parseCaseNumber, type Scope } from './requests'
import { extractDocumentText } from './textExtraction'
import { ensurePublicInfoPartition } from './partition'

export async function seedDepartments(em: EntityManager, scope: Scope): Promise<number> {
  const existing = await em.find(PublicInfoDepartment, { tenantId: scope.tenantId, organizationId: scope.organizationId })
  const symbols = new Set(existing.map((department) => department.symbol))
  let created = 0
  for (const seed of DEPARTMENT_SEEDS) {
    if (symbols.has(seed.symbol)) continue
    em.persist(
      em.create(PublicInfoDepartment, {
        id: randomUUID(),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        name: seed.name,
        symbol: seed.symbol,
        kind: seed.kind,
        competenceScope: seed.competenceScope,
        keywords: seed.keywords,
        contractCodes: seed.contractCodes,
        contactHint: seed.contactHint,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )
    created += 1
  }
  if (created > 0) await em.flush()
  return created
}

export async function seedModuleDefaults(em: EntityManager, scope: Scope): Promise<void> {
  await loadSettings(em, scope)
  await seedDepartments(em, scope)
  await ensurePublicInfoPartition(em)
}

type CalendarSeed = {
  dueOffset: number
  status: PublicInfoRequestStatus
  requesterName: string
  requesterKind: PublicInfoRequest['requesterKind']
  channel: PublicInfoRequest['channel']
  subject: string
  points: string[]
  extended?: boolean
  paused?: boolean
}

const CALENDAR_SEEDS: CalendarSeed[] = [
  { dueOffset: -3, status: 'sent_to_departments', requesterName: 'Fundacja „Jawna Gmina”', requesterKind: 'organisation', channel: 'email', subject: 'Koszty kampanii promocyjnej miasta w 2026 r.', points: ['Łączny koszt kampanii promocyjnej miasta w 2026 r.', 'Lista wykonawców kampanii wraz z kwotami umów.'] },
  { dueOffset: 0, status: 'prepared', requesterName: 'Redakcja „Kurier znad Brdy”', requesterKind: 'media', channel: 'epuap', subject: 'Liczba uczniów cudzoziemców w szkołach podstawowych — stan na 30.09.2026', points: ['Liczba uczniów w poszczególnych szkołach podstawowych.', 'Liczba uczniów cudzoziemców w poszczególnych szkołach.'] },
  { dueOffset: 1, status: 'in_preparation', requesterName: 'Stowarzyszenie „Zielona Brda”', requesterKind: 'organisation', channel: 'email', subject: 'Koszty utrzymania fontann miejskich w 2025 r.', points: ['Koszty utrzymania fontann miejskich w 2025 r.'] },
  { dueOffset: 2, status: 'awaiting_clarification', requesterName: 'Adam Wierzbicki', requesterKind: 'person', channel: 'email', subject: 'Dokumentacja budowy apartamentowca przy ul. Nadbrzeżnej', points: ['Projekt zagospodarowania terenu.', 'Wizualizacje i parametry techniczne budynku.'], paused: true },
  { dueOffset: 3, status: 'sent_to_departments', requesterName: 'Krzysztof Malinowski', requesterKind: 'person', channel: 'post', subject: 'Zezwolenia na sprzedaż alkoholu wydane w latach 2018–2026', points: ['Liczba zezwoleń na sprzedaż alkoholu wydanych w latach 2018–2026.'] },
  { dueOffset: 4, status: 'new', requesterName: 'Fundacja „Jawna Gmina”', requesterKind: 'organisation', channel: 'email', subject: 'Wynagrodzenia członków zarządów spółek miejskich w 2025 r.', points: ['Wysokość wynagrodzeń członków zarządów spółek miejskich w 2025 r.'] },
  { dueOffset: 7, status: 'sent_to_departments', requesterName: 'Rada Osiedla Błonie', requesterKind: 'organisation', channel: 'post', subject: 'Harmonogram remontu ul. Szubińskiej', points: ['Harmonogram remontu ul. Szubińskiej.'] },
  { dueOffset: 8, status: 'sent_to_departments', requesterName: 'SM „Słoneczna”', requesterKind: 'organisation', channel: 'email', subject: 'Liczba mieszkańców wskazanych ulic wg deklaracji odpadowych', points: ['Liczba mieszkańców wskazanych ulic według deklaracji o opłacie za gospodarowanie odpadami.'] },
  { dueOffset: 10, status: 'new', requesterName: 'Tomasz Wrzos', requesterKind: 'person', channel: 'email', subject: 'Dokumentacja realizacji umowy nr 41/IT/2024 (system parkingowy)', points: ['Kopia umowy nr 41/IT/2024 wraz z aneksami.', 'Protokoły odbioru prac.'] },
  { dueOffset: 25, status: 'extended', requesterName: 'Fundacja „Łapa w Łapę”', requesterKind: 'organisation', channel: 'email', subject: 'Opieka nad bezdomnymi zwierzętami — umowy i koszty 2025', points: ['Z kim gmina miała umowy na odławianie bezdomnych zwierząt w 2025 r.?', 'Koszt realizacji zadania w 2025 r.'], extended: true },
]

export async function seedDemoCalendar(em: EntityManager, scope: Scope, options: { today?: IsoDate; assigneeUserId?: string | null } = {}): Promise<number> {
  const today = options.today ?? todayIso()
  const settings = await loadSettings(em, scope)
  const marker = await em.count(PublicInfoRequest, { tenantId: scope.tenantId, organizationId: scope.organizationId, subjectSummary: CALENDAR_SEEDS[0].subject, deletedAt: null })
  if (marker > 0) return 0
  const year = Number(today.slice(0, 4))
  const rows = await em.find(PublicInfoRequest, { tenantId: scope.tenantId, organizationId: scope.organizationId, caseYear: year }, { fields: ['caseSeq'], orderBy: { caseSeq: 'desc' }, limit: 1 })
  let seq = Math.max(rows[0]?.caseSeq ?? 0, 600)
  let created = 0
  for (const seed of CALENDAR_SEEDS) {
    seq += 1
    const extensionDays = seed.extended ? 20 : 0
    const receivedAt = addCalendarDays(today, seed.dueOffset - 14 - extensionDays)
    const deadlines = computeDeadlines(receivedAt, settings.deadlineMode, settings.extraHolidays ?? [])
    const id = randomUUID()
    em.persist(
      em.create(PublicInfoRequest, {
        id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        caseNumber: `BKS.IV.1431.${seq}.${year}`,
        caseSeq: seq,
        caseYear: year,
        channel: seed.channel,
        receivedAt,
        letterDate: null,
        requesterName: seed.requesterName,
        requesterKind: seed.requesterKind,
        requesterAddress: null,
        requesterContact: null,
        deliveryForm: seed.channel === 'post' ? 'post' : 'email',
        subjectSummary: seed.subject,
        bodyText: seed.points.join('\n'),
        status: seed.status,
        assigneeUserId: options.assigneeUserId ?? null,
        statutoryDueDate: deadlines.statutoryDueDate,
        currentDueDate: seed.extended ? addCalendarDays(today, seed.dueOffset) : deadlines.currentDueDate,
        dueShiftedFrom: deadlines.dueShiftedFrom,
        maxExtensionDate: deadlines.maxExtensionDate,
        extendedAt: seed.extended ? new Date() : null,
        extensionReason: seed.extended ? 'Konieczność przeprowadzenia całościowej kwerendy' : null,
        pausedAt: seed.paused ? new Date() : null,
        clarificationDeliveredAt: seed.paused ? addCalendarDays(today, -5) : null,
        clarificationDueDate: seed.paused ? addCalendarDays(today, 2) : null,
        source: 'manual',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )
    seed.points.forEach((text, index) => {
      em.persist(em.create(PublicInfoRequestPoint, { id: randomUUID(), tenantId: scope.tenantId, organizationId: scope.organizationId, requestId: id, position: index + 1, text, createdAt: new Date(), updatedAt: new Date() }))
    })
    em.persist(em.create(PublicInfoRequestEvent, { id: randomUUID(), tenantId: scope.tenantId, organizationId: scope.organizationId, requestId: id, kind: 'registered', actorUserId: null, payload: { seeded: true }, occurredAt: new Date() }))
    created += 1
  }
  await em.flush()
  return created
}

type ArchivePair = {
  caseNumber: string
  requestFile: string | null
  responseFiles: string[]
}

const CASE_IN_NAME = /BKS\.IV\.1431\.\d+\.\d{4}/

export async function collectArchivePairs(directory: string): Promise<ArchivePair[]> {
  const files = (await readdir(directory)).filter((name) => !name.startsWith('.'))
  const pairs = new Map<string, ArchivePair>()
  for (const name of files) {
    const match = CASE_IN_NAME.exec(name)
    if (!match) continue
    const pair = pairs.get(match[0]) ?? { caseNumber: match[0], requestFile: null, responseFiles: [] }
    if (/^wniosek/i.test(name)) pair.requestFile = path.join(directory, name)
    else pair.responseFiles.push(path.join(directory, name))
    pairs.set(match[0], pair)
  }
  return Array.from(pairs.values()).sort((left, right) => left.caseNumber.localeCompare(right.caseNumber))
}

function inferLetterType(responseText: string, fileNames: string[]): string {
  const normalized = responseText.toLowerCase()
  if (normalized.includes('nie jest dysponentem')) return 'not_held_referral'
  if (normalized.includes('nie prowadzi statystyk')) return 'no_statistics'
  if (fileNames.some((name) => /doprecyzowanie/i.test(name)) && !fileNames.some((name) => /odpowied/i.test(name))) return 'clarification_request'
  return 'answer'
}

function mimeFor(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase()
  if (extension === '.pdf') return 'application/pdf'
  if (extension === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (extension === '.eml') return 'message/rfc822'
  return 'application/octet-stream'
}

async function readText(filePath: string): Promise<{ text: string; source: PublicInfoDocument['textSource']; confidence: number | null }> {
  const buffer = await readFile(filePath)
  const result = await extractDocumentText({ buffer, fileName: path.basename(filePath), mimeType: mimeFor(filePath) })
  return { text: result.text ?? '', source: result.source, confidence: result.ocrConfidence }
}

export type ArchiveImportReport = { caseNumber: string; status: 'imported' | 'skipped' | 'exists'; reason?: string; textSource?: string }

export async function importArchive(
  em: EntityManager,
  scope: Scope,
  directory: string,
  options: { only?: string[]; skip?: string[] } = {},
): Promise<ArchiveImportReport[]> {
  const pairs = await collectArchivePairs(directory)
  const reports: ArchiveImportReport[] = []
  for (const pair of pairs) {
    const seq = pair.caseNumber.split('.')[3]
    if (options.only && options.only.length > 0 && !options.only.includes(seq) && !options.only.includes(pair.caseNumber)) continue
    if (options.skip && (options.skip.includes(seq) || options.skip.includes(pair.caseNumber))) {
      reports.push({ caseNumber: pair.caseNumber, status: 'skipped', reason: 'excluded' })
      continue
    }
    const exists = await em.count(PublicInfoRequest, { tenantId: scope.tenantId, organizationId: scope.organizationId, caseNumber: pair.caseNumber, deletedAt: null })
    if (exists > 0) {
      reports.push({ caseNumber: pair.caseNumber, status: 'exists' })
      continue
    }
    const requestText = pair.requestFile ? await readText(pair.requestFile) : { text: '', source: 'none' as const, confidence: null }
    const responses = await Promise.all(pair.responseFiles.map(async (file) => ({ file, ...(await readText(file)) })))
    const responseText = responses.map((response) => response.text).join('\n\n')
    if (!requestText.text && !responseText) {
      reports.push({ caseNumber: pair.caseNumber, status: 'skipped', reason: 'no readable text' })
      continue
    }
    const parsedNumber = parseCaseNumber(pair.caseNumber)
    if (!parsedNumber) continue
    const parsed = parseRequestText(requestText.text || responseText, { channel: 'email' })
    const responseDate = parsePolishDate(responseText) ?? `${parsedNumber.year}-06-30`
    const receivedAt = addCalendarDays(responseDate, -10)
    const deadlines = computeDeadlines(receivedAt, 'calendar')
    const requester = { name: parsed.requesterName, address: parsed.requesterAddress, contact: parsed.requesterContact }
    const subjectSummary = parsed.subjectSummary || responseText.slice(0, 120)
    const archiveText = anonymizeForArchive(
      `WNIOSEK\n${subjectSummary}\n${parsed.points.map((point, index) => `${index + 1}. ${point}`).join('\n')}\n\nODPOWIEDŹ\n${responseText}`,
      requester,
    )
    const id = randomUUID()
    em.persist(
      em.create(PublicInfoRequest, {
        id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        caseNumber: pair.caseNumber,
        caseSeq: parsedNumber.seq,
        caseYear: parsedNumber.year,
        channel: 'email',
        receivedAt,
        letterDate: parsed.letterDate,
        requesterName: parsed.requesterName ?? 'Wnioskodawca (archiwum)',
        requesterKind: parsed.requesterKind,
        requesterAddress: parsed.requesterAddress,
        requesterContact: parsed.requesterContact,
        deliveryForm: parsed.deliveryForm,
        subjectSummary,
        bodyText: requestText.text || null,
        status: 'sent',
        statutoryDueDate: deadlines.statutoryDueDate,
        currentDueDate: deadlines.currentDueDate,
        dueShiftedFrom: deadlines.dueShiftedFrom,
        maxExtensionDate: deadlines.maxExtensionDate,
        respondedAt: responseDate,
        responseChannel: 'archiwum',
        finalLetterType: inferLetterType(responseText, pair.responseFiles.map((file) => path.basename(file))),
        archiveText,
        source: 'import',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    )
    parsed.points.forEach((text, index) => {
      em.persist(em.create(PublicInfoRequestPoint, { id: randomUUID(), tenantId: scope.tenantId, organizationId: scope.organizationId, requestId: id, position: index + 1, text, createdAt: new Date(), updatedAt: new Date() }))
    })
    const documentFiles = [...(pair.requestFile ? [{ file: pair.requestFile, kind: 'request' as const, ...requestText }] : []), ...responses.map((response) => ({ ...response, kind: 'other' as const }))]
    for (const document of documentFiles) {
      em.persist(
        em.create(PublicInfoDocument, {
          id: randomUUID(),
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          requestId: id,
          attachmentId: null,
          kind: document.kind,
          fileName: path.basename(document.file),
          mimeType: mimeFor(document.file),
          extractedText: document.text || null,
          textSource: document.source,
          ocrConfidence: document.confidence,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      )
    }
    await em.flush()
    reports.push({ caseNumber: pair.caseNumber, status: 'imported', textSource: requestText.source })
  }
  return reports
}
