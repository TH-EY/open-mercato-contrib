#!/usr/bin/env node
// Drives the UDIP request desk API through the jury walkthrough for every UMB sample request.
// Usage: UDIP_BASE_URL=http://localhost:3210 UDIP_EMAIL=... UDIP_PASSWORD=... node scripts/udip/verify-samples.mjs "<samples dir>"
import { readdir, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const baseUrl = process.env.UDIP_BASE_URL ?? 'http://localhost:3210'
const email = process.env.UDIP_EMAIL
const password = process.env.UDIP_PASSWORD
const samplesDir = process.argv[2]
if (!email || !password || !samplesDir) {
  console.error('Set UDIP_EMAIL, UDIP_PASSWORD and pass the samples directory.')
  process.exit(2)
}

const EXPECTED = {
  '15': { departments: ['WKZ'], letterType: 'not_held_referral', referral: 'WKZ' },
  '16': { departments: ['WSO'], letterType: 'no_statistics', manualText: 'Ile punktów sprzedaży alkoholu przybyło w Bydgoszczy od czasu objęcia funkcji Prezydenta przez Bruskiego do dnia dzisiejszego? Odpowiedź w trybie administracyjnym. Jerzy' },
  '17': { departments: ['ZDMiKP'], letterType: 'not_held_referral', referral: 'ZDMiKP' },
  '18': { departments: ['WGO'], letterType: 'answer' },
  '293': { departments: ['WZiGK', 'SDZ'], letterType: 'answer' },
  '307': { departments: ['WES'], letterType: 'answer' },
  '509': { departments: ['WAB'], letterType: 'clarification_request' },
  '543': { departments: ['WZiGK', 'SDZ'], letterType: 'answer', similarTo: '293' },
  '590': { departments: ['WIM'], letterType: 'answer' },
  '599': { departments: ['WES'], letterType: 'answer', similarTo: '307' },
}

let cookie = ''

async function call(method, urlPath, body, { raw = false, form = null } = {}) {
  const headers = { cookie, origin: baseUrl }
  let payload
  if (form) payload = form
  else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const response = await fetch(`${baseUrl}${urlPath}`, { method, headers, body: payload, redirect: 'manual' })
  const setCookie = response.headers.getSetCookie?.() ?? []
  if (setCookie.length) cookie = [cookie, ...setCookie.map((value) => value.split(';')[0])].filter(Boolean).join('; ')
  if (raw) return response
  const text = await response.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = { raw: text.slice(0, 300) } }
  if (!response.ok) throw new Error(`${method} ${urlPath} → ${response.status} ${JSON.stringify(json).slice(0, 400)}`)
  return json
}

async function login() {
  const form = new FormData()
  form.set('email', email)
  form.set('password', password)
  await call('POST', '/api/auth/login', undefined, { form, raw: true })
  if (!cookie) throw new Error('Login failed (no session cookie)')
}

function mimeOf(file) {
  if (file.endsWith('.pdf')) return 'application/pdf'
  if (file.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  return 'application/octet-stream'
}

async function upload(filePath, requestId, kind, departmentQueryId) {
  const buffer = await readFile(filePath)
  const form = new FormData()
  form.set('file', new File([buffer], path.basename(filePath), { type: mimeOf(filePath) }))
  form.set('requestId', requestId)
  form.set('kind', kind)
  if (departmentQueryId) form.set('departmentQueryId', departmentQueryId)
  return call('POST', '/api/public_info_requests/documents', undefined, { form })
}

function docxText(buffer) {
  const tempFile = path.join(tmpdir(), `udip-export-${randomUUID()}.docx`)
  writeFileSync(tempFile, buffer)
  const xml = execFileSync('unzip', ['-p', tempFile, 'word/document.xml']).toString('utf8')
  rmSync(tempFile, { force: true })
  return xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
}

const departmentsBySymbol = new Map()
const createdCaseBySeq = new Map()
const createdRequestIds = []

async function runSample(seq, files) {
  const expected = EXPECTED[seq]
  const steps = {}
  const requestFile = files.find((file) => /^Wniosek/i.test(path.basename(file)))
  const answerFile = files.find((file) => /^Odpowied/i.test(path.basename(file)))
  const requestId = randomUUID()

  const uploaded = await upload(requestFile, requestId, 'request')
  steps.extract = `${uploaded.textSource}${uploaded.ocrConfidence != null ? ` ${Math.round(uploaded.ocrConfidence * 100)}%` : ''}`
  const intake = await call('POST', '/api/public_info_requests/intake', { attachmentId: uploaded.id, channel: 'email', ...(expected.manualText && !uploaded.extractedText ? { text: expected.manualText } : {}) })
  let suggestions = intake.suggestions
  if (intake.unreadable && expected.manualText) {
    const manual = await call('POST', '/api/public_info_requests/intake', { text: expected.manualText, channel: 'post' })
    suggestions = manual.suggestions
    steps.extract += ' → manual text'
  }
  steps.intake = `${suggestions.points.length} pt, ${suggestions.requesterKind}`

  const year = new Date().getFullYear()
  const { caseNumber } = await call('GET', `/api/public_info_requests/case-number?year=${year}`)
  const today = new Date().toISOString().slice(0, 10)
  await call('POST', '/api/public_info_requests/requests', {
    id: requestId,
    caseNumber,
    channel: 'email',
    receivedAt: today,
    requesterName: suggestions.requesterName || 'Wnioskodawca',
    requesterKind: suggestions.requesterKind,
    requesterAddress: suggestions.requesterAddress,
    requesterContact: suggestions.requesterContact,
    deliveryForm: suggestions.deliveryForm,
    subjectSummary: suggestions.subjectSummary.slice(0, 290) || 'Wniosek',
    bodyText: intake.text || expected.manualText || null,
    points: suggestions.points.map((text, index) => ({ position: index + 1, text: text.slice(0, 3900) })),
  })

  const similar = await call('GET', `/api/public_info_requests/requests/${requestId}/similar`)
  const top = similar.matches[0]
  steps.similar = top ? `${top.caseNumber.split('.')[3]} (${Math.round(top.similarity * 100)}%)` : 'none'
  const topSeq = top?.caseNumber.split('.')[3]
  const similarOk = expected.similarTo ? topSeq === expected.similarTo || top?.caseNumber === createdCaseBySeq.get(expected.similarTo) : true
  if (top) await call('POST', `/api/public_info_requests/requests/${requestId}/similar-choice`, { matchedRequestId: top.requestId, similarity: top.similarity, action: 'reuse_structure' })

  const routing = await call('GET', `/api/public_info_requests/requests/${requestId}/routing-suggest`)
  const proposedSymbols = routing.proposals.map((proposal) => departmentsBySymbol.get(proposal.departmentId) ?? '?')
  steps.routing = `${proposedSymbols.join('+')} [${routing.generatedBy}]${routing.flags.length ? ' flags:' + routing.flags.map((flag) => flag.kind).join(',') : ''}`
  const routingOk = proposedSymbols[0] === expected.departments[0] && expected.departments.every((symbol) => proposedSymbols.includes(symbol))
  if (routing.proposals.length === 0) throw new Error('routing returned no proposals')
  const accepted = await call('POST', `/api/public_info_requests/requests/${requestId}/routing-accept`, {
    queries: routing.proposals.map((proposal) => ({
      departmentId: proposal.departmentId,
      pointPositions: proposal.pointPositions,
      scopeText: proposal.scopeText,
      internalDueDate: proposal.internalDueDate,
      confidence: proposal.confidence,
      sources: proposal.sources,
    })),
  })
  await call('POST', `/api/public_info_requests/requests/${requestId}/notes-mark-sent`, { ids: accepted.queryIds, sentAt: today })

  let draftOptions = {}
  if (expected.referral) {
    const referralId = [...departmentsBySymbol.entries()].find(([, symbol]) => symbol === expected.referral)?.[0]
    draftOptions = { referralDepartmentId: referralId }
  }
  if (expected.letterType === 'clarification_request') {
    draftOptions = { clarificationQuestion: 'Prosimy o wskazanie, o jakie dokładnie akta sprawy chodzi.', clarificationDepartmentName: 'Wydział Administracji Budowlanej' }
  }
  if (expected.letterType === 'answer' || expected.letterType === 'no_statistics') {
    if (answerFile) {
      const reply = await upload(answerFile, requestId, 'reply', accepted.queryIds[0])
      await call('POST', `/api/public_info_requests/requests/${requestId}/record-reply`, { queryId: accepted.queryIds[0], replyKind: 'answered', receivedAt: today, replyAttachmentIds: [reply.id] })
      steps.reply = reply.textSource
    }
  }
  const baseOn = expected.letterType === 'answer' && !answerFile && top ? 'archive_answer' : undefined
  if (baseOn) steps.reply = `archive ${topSeq}`
  const generated = await call('POST', `/api/public_info_requests/requests/${requestId}/drafts`, { letterType: expected.letterType, options: draftOptions, ...(baseOn ? { baseOn } : {}) })
  const detail = await call('GET', `/api/public_info_requests/requests/${requestId}/detail`)
  const draft = detail.drafts.find((candidate) => candidate.id === generated.draftId)
  const flags = draft.paragraphs.flatMap((paragraph) => paragraph.flags)
  const filled = draft.paragraphs.filter((paragraph) => paragraph.kind === 'point' && paragraph.text.trim()).length
  steps.draft = `${expected.letterType}: ${draft.paragraphs.length} par, ${filled} filled${flags.length ? ', flags ' + [...new Set(flags)].join('/') : ''}`

  await call('POST', `/api/public_info_requests/requests/${requestId}/pii-detect`, { draftId: draft.id, includeAttachments: true })
  const afterDetect = await call('GET', `/api/public_info_requests/requests/${requestId}/detail`)
  const suggested = afterDetect.marks.filter((mark) => mark.state === 'suggested')
  for (const mark of suggested) {
    await call('POST', `/api/public_info_requests/requests/${requestId}/mark-decide`, { markId: mark.id, state: 'accepted' })
  }
  steps.pii = `${suggested.length} accepted (${[...new Set(suggested.map((mark) => mark.category))].join(',') || '—'})`

  const exportResponse = await call('GET', `/api/public_info_requests/requests/${requestId}/export?format=docx&draftId=${draft.id}`, undefined, { raw: true })
  let exportOk = exportResponse.ok
  let leaked = []
  if (exportResponse.ok) {
    const text = docxText(Buffer.from(await exportResponse.arrayBuffer()))
    leaked = suggested.filter((mark) => mark.targetKind === 'draft' && mark.excerpt.length > 3 && text.includes(mark.excerpt)).map((mark) => mark.excerpt)
    exportOk = leaked.length === 0 && text.includes('Łączę wyrazy szacunku')
  }
  steps.export = exportOk ? 'docx ok' : `FAIL ${exportResponse.status} ${leaked.join('|')}`

  await call('POST', `/api/public_info_requests/requests/${requestId}/mark-sent`, { respondedAt: today, channel: 'email', addToArchive: true, draftId: draft.id })
  const final = await call('GET', `/api/public_info_requests/requests/${requestId}/detail`)
  steps.status = final.request.status
  const pass = similarOk && routingOk && exportOk && final.request.status === 'sent' && (expected.letterType !== 'answer' || filled > 0)
  createdCaseBySeq.set(seq, caseNumber)
  createdRequestIds.push(requestId)
  return { seq, pass, steps, caseNumber, requestId }
}

async function anonymisationProbe(departmentQueryId, requestId) {
  return { departmentQueryId, requestId }
}

async function main() {
  await login()
  const departments = await call('GET', '/api/public_info_requests/departments?pageSize=100')
  for (const department of departments.items) departmentsBySymbol.set(department.id, department.symbol)
  const files = (await readdir(samplesDir)).filter((name) => !name.startsWith('.')).map((name) => path.join(samplesDir, name))
  const bySeq = new Map()
  for (const file of files) {
    const match = /BKS\.IV\.1431\.(\d+)\.\d{4}/.exec(path.basename(file))
    if (!match) continue
    const list = bySeq.get(match[1]) ?? []
    list.push(file)
    bySeq.set(match[1], list)
  }
  const only = process.env.UDIP_ONLY ? process.env.UDIP_ONLY.split(',') : null
  const results = []
  for (const seq of Object.keys(EXPECTED)) {
    if (only && !only.includes(seq)) continue
    const sampleFiles = bySeq.get(seq)
    if (!sampleFiles) continue
    try {
      results.push(await runSample(seq, sampleFiles))
    } catch (error) {
      results.push({ seq, pass: false, steps: { error: String(error.message ?? error).slice(0, 300) } })
    }
  }
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.seq.padEnd(4)} ${Object.entries(result.steps).map(([key, value]) => `${key}=${value}`).join(' | ')}`)
  }
  void anonymisationProbe
  if (process.env.UDIP_KEEP !== 'true') {
    for (const id of createdRequestIds) {
      await call('DELETE', `/api/public_info_requests/requests?id=${id}`).catch(() => null)
    }
  }
  const failed = results.filter((result) => !result.pass).length
  console.log(`\n${results.length - failed}/${results.length} samples passed`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
