import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { PublicInfoRedactionMark, StoredDraftParagraph } from '../../data/entities'
import { applyRedactions, DEFAULT_REDACTION_REPLACEMENT, sha256 } from '../pii/redact'
import { contentHash } from '../drafting/grounding'

export function attachmentTextHash(text: string): string {
  return sha256(text)
}

export function assertMarksFresh(
  marks: PublicInfoRedactionMark[],
  paragraphs: StoredDraftParagraph[],
  documentTexts: Map<string, string>,
): void {
  const byParagraph = new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph]))
  for (const mark of marks) {
    if (mark.state !== 'accepted') continue
    if (mark.targetKind === 'draft') {
      const paragraph = mark.paragraphId ? byParagraph.get(mark.paragraphId) : undefined
      if (!paragraph) continue
      const hash = paragraph.contentHash || contentHash(paragraph.text)
      if (hash !== mark.sourceHash || paragraph.text.slice(mark.startOffset, mark.endOffset) !== mark.textExcerpt) {
        throw new CrudHttpError(409, { error: 'Redaction marks are stale', code: 'pii_marks_stale', markId: mark.id })
      }
    } else if (mark.attachmentId) {
      const text = documentTexts.get(mark.attachmentId)
      if (text === undefined) continue
      if (attachmentTextHash(text) !== mark.sourceHash || text.slice(mark.startOffset, mark.endOffset) !== mark.textExcerpt) {
        throw new CrudHttpError(409, { error: 'Redaction marks are stale', code: 'pii_marks_stale', markId: mark.id })
      }
    }
  }
}

export function assertMarksDecided(marks: PublicInfoRedactionMark[]): void {
  const undecided = marks.filter((mark) => mark.state === 'suggested')
  if (undecided.length > 0) {
    throw new CrudHttpError(409, { error: 'Anonymisation suggestions are not decided', code: 'pii_undecided', count: undecided.length })
  }
}

export function redactParagraphs(paragraphs: StoredDraftParagraph[], marks: PublicInfoRedactionMark[], replacement = DEFAULT_REDACTION_REPLACEMENT): StoredDraftParagraph[] {
  return paragraphs.map((paragraph) => {
    const ranges = marks
      .filter((mark) => mark.state === 'accepted' && mark.targetKind === 'draft' && mark.paragraphId === paragraph.id)
      .map((mark) => ({ start: mark.startOffset, end: mark.endOffset }))
    if (ranges.length === 0) return paragraph
    return { ...paragraph, text: applyRedactions(paragraph.text, ranges, replacement) }
  })
}

export function redactDocumentText(text: string, documentId: string, marks: PublicInfoRedactionMark[], replacement = DEFAULT_REDACTION_REPLACEMENT): string {
  const ranges = marks
    .filter((mark) => mark.state === 'accepted' && mark.targetKind === 'attachment' && mark.attachmentId === documentId)
    .map((mark) => ({ start: mark.startOffset, end: mark.endOffset }))
  return ranges.length > 0 ? applyRedactions(text, ranges, replacement) : text
}
