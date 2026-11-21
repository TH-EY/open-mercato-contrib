import { assembleTesseractTsv, extractDocumentText, needsTranscriptionFallback, normalizeExtractedText, type ScanImage } from '../textExtraction'

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

const BLANK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAMgAAABkCAAAAAD0q6whAAAAJElEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAzwZKzAABPt3sAwAAAABJRU5ErkJggg==', 'base64')

describe('needsTranscriptionFallback', () => {
  it('asks for a fallback when local OCR returns little text or a low score', () => {
    expect(needsTranscriptionFallback({ text: null, confidence: null })).toBe(true)
    expect(needsTranscriptionFallback({ text: 'JERZY', confidence: 0.9 })).toBe(true)
    expect(needsTranscriptionFallback({ text: 'Ile punktów sprzedaży alkoholu przybyło w Bydgoszczy od czasu objęcia funkcji', confidence: 0.35 })).toBe(true)
  })

  it('keeps a confident local OCR result', () => {
    expect(needsTranscriptionFallback({ text: 'Ile punktów sprzedaży alkoholu przybyło w Bydgoszczy od czasu objęcia funkcji', confidence: 0.92 })).toBe(false)
  })
})

describe('extractDocumentText transcription fallback', () => {
  it('sends an unreadable scan to the transcriber and uses its text', async () => {
    const received: ScanImage[] = []
    const result = await extractDocumentText({
      buffer: BLANK_PNG,
      fileName: 'skan.png',
      mimeType: 'image/png',
      transcribe: async (images) => {
        received.push(...images)
        return { text: 'Prezydent Bydgoszczy\n\nIle punktów sprzedaży alkoholu przybyło?  ', confidence: 0.85 }
      },
    })
    expect(received).toHaveLength(1)
    expect(received[0].mediaType).toBe('image/png')
    expect(result).toEqual({ text: 'Prezydent Bydgoszczy\n\nIle punktów sprzedaży alkoholu przybyło?', source: 'ocr_llm', ocrConfidence: 0.85 })
  }, 60_000)

  it('falls back to the local result when the transcriber gives up', async () => {
    const result = await extractDocumentText({ buffer: BLANK_PNG, fileName: 'skan.png', mimeType: 'image/png', transcribe: async () => null })
    expect(result.source).not.toBe('ocr_llm')
  }, 60_000)
})

