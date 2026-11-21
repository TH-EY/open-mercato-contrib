import { OFFICE_NAME_NOMINATIVE, letterTitle, polishDateLong, salutationLine } from './templates'
import { DEFAULT_LETTERHEAD } from './types'
import type { DraftParagraph, LetterContext, LetterType, Letterhead } from './types'

export type RenderLetterOptions = {
  attachments?: string[]
  redact?: (paragraph: DraftParagraph) => string
  letterType?: LetterType
}

type LetterParts = {
  letterhead: Letterhead
  dateLine: string
  caseNumber: string
  recipientLines: string[]
  title: string | null
  salutation: string | null
  body: { id: string; kind: DraftParagraph['kind']; text: string }[]
  attachmentsLabel: string | null
  attachments: string[]
  closing: string[]
  signature: string[]
}

const DEFAULT_CITY = 'Bydgoszcz'

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function cityFromAddress(address: string): string {
  const match = /\d{2}-\d{3}\s+([^,]+)/u.exec(address)
  return match ? match[1].trim() : DEFAULT_CITY
}

function paragraphText(paragraph: DraftParagraph, redact?: (paragraph: DraftParagraph) => string): string {
  return (redact ? redact(paragraph) : paragraph.text).trim()
}

function buildParts(paragraphs: DraftParagraph[], ctx: LetterContext, options?: RenderLetterOptions): LetterParts {
  const letterhead = ctx.letterhead ?? DEFAULT_LETTERHEAD
  const attachments = (options?.attachments ?? []).map((entry) => entry.trim()).filter(Boolean)
  const rendered = paragraphs
    .map((paragraph) => ({ id: paragraph.id, kind: paragraph.kind, text: paragraphText(paragraph, options?.redact) }))
    .filter((paragraph) => paragraph.text.length > 0)
  const isDecision = options?.letterType === 'refusal_decision_draft'
  return {
    letterhead,
    dateLine: `${cityFromAddress(letterhead.address)}, dnia ${polishDateLong(ctx.letterDate)}`,
    caseNumber: ctx.caseNumber,
    recipientLines: [ctx.requesterName ?? '', ...(ctx.requesterAddressLines ?? [])].map((line) => line.trim()).filter(Boolean),
    title: options?.letterType ? letterTitle(options.letterType) : null,
    salutation: isDecision ? null : salutationLine(ctx.salutation),
    body: rendered.filter((paragraph) => paragraph.kind !== 'closing'),
    attachmentsLabel: attachments.length === 0 ? null : attachments.length === 1 ? 'Załącznik:' : 'Załączniki:',
    attachments,
    closing: rendered.filter((paragraph) => paragraph.kind === 'closing').map((paragraph) => paragraph.text),
    signature: [letterhead.unitName, OFFICE_NAME_NOMINATIVE, `e-mail: ${letterhead.email}`],
  }
}

function htmlLines(text: string): string {
  return text.split(/\r?\n/).map(escapeHtml).join('<br>')
}

export function renderLetterHtml(paragraphs: DraftParagraph[], ctx: LetterContext, options?: RenderLetterOptions): string {
  const parts = buildParts(paragraphs, ctx, options)
  const sections: string[] = []
  sections.push(
    `<header class="pir-letter__letterhead"><div class="pir-letter__office" style="font-weight:bold">${escapeHtml(parts.letterhead.officeName)}</div><div class="pir-letter__unit">${escapeHtml(parts.letterhead.unitName)}</div></header>`,
  )
  sections.push(
    `<div class="pir-letter__meta"><p class="pir-letter__date">${escapeHtml(parts.dateLine)}</p><p class="pir-letter__case-number">${escapeHtml(parts.caseNumber)}</p></div>`,
  )
  if (parts.recipientLines.length > 0) {
    sections.push(`<div class="pir-letter__recipient" style="margin-left:50%"><p>${parts.recipientLines.map(escapeHtml).join('<br>')}</p></div>`)
  }
  if (parts.title) {
    sections.push(`<h1 class="pir-letter__title" style="text-align:center;font-size:inherit">${escapeHtml(parts.title)}</h1>`)
  }
  if (parts.salutation) sections.push(`<p class="pir-letter__salutation">${escapeHtml(parts.salutation)}</p>`)
  sections.push(
    `<div class="pir-letter__body">${parts.body
      .map((paragraph) => `<p data-paragraph-id="${escapeHtml(paragraph.id)}" data-paragraph-kind="${paragraph.kind}">${htmlLines(paragraph.text)}</p>`)
      .join('')}</div>`,
  )
  if (parts.attachmentsLabel) {
    const list =
      parts.attachments.length === 1
        ? `<p>${escapeHtml(parts.attachmentsLabel)} ${escapeHtml(parts.attachments[0])}</p>`
        : `<p>${escapeHtml(parts.attachmentsLabel)}</p><ol>${parts.attachments.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ol>`
    sections.push(`<div class="pir-letter__attachments">${list}</div>`)
  }
  sections.push(
    `<div class="pir-letter__closing" style="margin-left:50%">${parts.closing.map((line) => `<p>${htmlLines(line)}</p>`).join('')}<p class="pir-letter__signature">${parts.signature.map(escapeHtml).join('<br>')}</p></div>`,
  )
  sections.push(`<footer class="pir-letter__footer">${escapeHtml(parts.letterhead.address)}</footer>`)
  return `<article class="pir-letter" lang="pl">${sections.join('')}</article>`
}

export function renderLetterText(paragraphs: DraftParagraph[], ctx: LetterContext, options?: RenderLetterOptions): string {
  const parts = buildParts(paragraphs, ctx, options)
  const blocks: string[] = []
  blocks.push(`${parts.letterhead.officeName}\n${parts.letterhead.unitName}`)
  blocks.push(`${parts.dateLine}\n${parts.caseNumber}`)
  if (parts.recipientLines.length > 0) blocks.push(parts.recipientLines.join('\n'))
  if (parts.title) blocks.push(parts.title)
  const body = parts.body.map((paragraph) => paragraph.text)
  if (parts.salutation) {
    const [first, ...rest] = body
    blocks.push(first ? `${parts.salutation}\n${first}` : parts.salutation)
    blocks.push(...rest)
  } else {
    blocks.push(...body)
  }
  if (parts.attachmentsLabel) {
    blocks.push(
      parts.attachments.length === 1
        ? `${parts.attachmentsLabel} ${parts.attachments[0]}`
        : [parts.attachmentsLabel, ...parts.attachments.map((entry, index) => `${index + 1}. ${entry}`)].join('\n'),
    )
  }
  blocks.push([...parts.closing, ...parts.signature].join('\n'))
  blocks.push(parts.letterhead.address)
  return `${blocks.join('\n\n')}\n`
}
