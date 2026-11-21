import { assembleTesseractTsv, normalizeExtractedText } from '../textExtraction'

const HEADER = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext'

function row(block: number, paragraph: number, line: number, word: number, text: string, confidence = 95): string {
  return ['5', '1', String(block), String(paragraph), String(line), String(word), '0', '0', '10', '10', String(confidence), text].join('\t')
}

describe('normalizeExtractedText', () => {
  it('keeps line breaks, turns page breaks into blank lines and collapses runs of empty lines', () => {
    expect(normalizeExtractedText('Wniosek  \r\nPytanie 1\fStrona 2\n\n\n\nBudowlanka S.A.\n')).toBe('Wniosek\nPytanie 1\n\nStrona 2\n\nBudowlanka S.A.')
  })
})

describe('assembleTesseractTsv', () => {
  it('keeps lines within a paragraph and separates paragraphs with a blank line', () => {
    const tsv = [
      HEADER,
      row(1, 1, 1, 1, 'Szanowni'),
      row(1, 1, 1, 2, 'Państwo,'),
      row(1, 2, 1, 1, 'proszę', 80),
      row(1, 2, 1, 2, 'o'),
      row(1, 2, 2, 1, 'informację.'),
      row(2, 1, 1, 1, 'Budowlanka'),
      row(2, 1, 1, 2, 'S.A.'),
    ].join('\n')
    const result = assembleTesseractTsv(tsv)
    expect(result.text).toBe('Szanowni Państwo,\n\nproszę o\ninformację.\n\nBudowlanka S.A.')
    expect(result.confidences).toHaveLength(7)
  })
})
