import type { PublicInfoRedactionMark, StoredDraftParagraph } from '../../../data/entities'
import { contentHash } from '../../drafting/grounding'
import { assertDraftExportable, readPiiChecked } from '../redaction'

function paragraph(id: string, text: string, kind: StoredDraftParagraph['kind'] = 'point'): StoredDraftParagraph {
  return { id, kind, text, contentHash: contentHash(text), sources: [], flags: [], confirmedBy: null }
}

function mark(values: Partial<PublicInfoRedactionMark>): PublicInfoRedactionMark {
  return { targetKind: 'draft', state: 'accepted', startOffset: 0, endOffset: 0, sourceHash: '', textExcerpt: '', ...values } as PublicInfoRedactionMark
}

function codeOf(run: () => void): string | null {
  try {
    run()
    return null
  } catch (error) {
    return (error as { body?: { code?: string } }).body?.code ?? 'unknown'
  }
}

describe('assertDraftExportable', () => {
  const point = paragraph('p1', 'Jan Kowalski, tel. 601 234 567, pełnił funkcję kierownika robót.')
  const closing = paragraph('c1', 'Z poważaniem', 'closing')
  const checked = { piiChecked: { paragraphs: { p1: point.contentHash } } }

  it('rejects a draft that is not marked as prepared', () => {
    expect(codeOf(() => assertDraftExportable({ status: 'draft', paragraphs: [point], letterOptions: checked }, []))).toBe('draft_not_ready')
  })

  it('rejects paragraphs whose current text was not checked for personal data', () => {
    const edited = { ...point, text: `${point.text} Nowe zdanie.`, contentHash: contentHash(`${point.text} Nowe zdanie.`) }
    expect(codeOf(() => assertDraftExportable({ status: 'ready', paragraphs: [edited, closing], letterOptions: checked }, []))).toBe('pii_not_checked')
  })

  it('rejects undecided suggestions', () => {
    const marks = [mark({ state: 'suggested', paragraphId: 'p1' })]
    expect(codeOf(() => assertDraftExportable({ status: 'ready', paragraphs: [point, closing], letterOptions: checked }, marks))).toBe('pii_undecided')
  })

  it('rejects accepted marks that no longer match the text', () => {
    const marks = [mark({ paragraphId: 'p1', startOffset: 0, endOffset: 12, sourceHash: point.contentHash, textExcerpt: 'Anna Nowak, ' })]
    expect(codeOf(() => assertDraftExportable({ status: 'ready', paragraphs: [point], letterOptions: checked }, marks))).toBe('pii_marks_stale')
  })

  it('accepts a prepared, checked draft with decided marks and ignores the closing paragraph', () => {
    const marks = [mark({ paragraphId: 'p1', startOffset: 0, endOffset: 12, sourceHash: point.contentHash, textExcerpt: 'Jan Kowalski' })]
    expect(codeOf(() => assertDraftExportable({ status: 'ready', paragraphs: [point, closing], letterOptions: checked }, marks))).toBeNull()
  })
})

describe('readPiiChecked', () => {
  it('returns an empty record for missing or malformed options', () => {
    expect(readPiiChecked(null)).toEqual({})
    expect(readPiiChecked({ piiChecked: 'yes' })).toEqual({})
  })
})
