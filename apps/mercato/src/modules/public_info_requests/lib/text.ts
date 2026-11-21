const SPECIAL_LETTERS: Record<string, string> = {
  ł: 'l',
  Ł: 'l',
  đ: 'd',
  ß: 'ss',
}

const STEM_LENGTH = 6

export const POLISH_STOPWORDS: ReadonlySet<string> = new Set([
  'aby', 'ale', 'albo', 'ani', 'bez', 'bardzo', 'byl', 'byla', 'bylo', 'byly', 'bedzie', 'beda', 'byc',
  'czy', 'dla', 'gdy', 'gdzie', 'jak', 'jaki', 'jaka', 'jakie', 'jakim', 'jakiej', 'jest', 'jego', 'jej',
  'ich', 'juz', 'kto', 'ktore', 'ktory', 'ktora', 'ktorzy', 'ktorej', 'ktorych', 'ktorym', 'lub', 'maja',
  'moze', 'mnie', 'moj', 'moja', 'moje', 'nad', 'nie', 'niz', 'oraz', 'pod', 'przez', 'przy', 'sie',
  'sobie', 'tak', 'takze', 'tez', 'tego', 'tej', 'ten', 'tym', 'tylko', 'tych', 'wraz', 'wiec', 'zeby',
  'jezeli', 'jesli', 'rowniez', 'wszystkie', 'wszystkich', 'ponadto', 'ww', 'pan', 'pani', 'panstwa',
  'panstwo', 'prosze', 'prosimy', 'wnosze', 'wnosimy', 'wnioskuje', 'informacji', 'informacje',
  'informacja', 'publicznej', 'publiczna', 'dostepu', 'dostepie', 'udostepnienie', 'udostepnienia',
  'udzielenie', 'wniosek', 'wniosku', 'trybie', 'podstawie', 'ustawy', 'ustawa', 'ustawie', 'art', 'ust',
  'pkt', 'dnia', 'roku', 'bydgoszcz', 'bydgoszczy', 'miasta', 'miasto', 'miastem', 'urzad', 'urzedu',
  'oto', 'czym', 'jako', 'tam', 'tutaj', 'teraz', 'obecnie', 'wszelkie', 'swoje',
  'nasze', 'naszej', 'nasz', 'mojej', 'moim', 'dzien', 'dobry', 'witam', 'szanowni', 'szanowny',
  'szanowna', 'uprzejmie', 'uprzejma', 'prosba', 'prosbe', 'zwracam', 'zwraca', 'zwracamy',
  'podanie', 'przeslanie', 'przekazanie', 'niniejszym', 'dot', 'nastepujacej', 'nastepujacych',
  'zakresie', 'temat', 'odnosnie', 'zgodnie', 'tzn', 'itd', 'itp', 'wzgledu',
])

export function normalizePolish(text: string): string {
  const replaced = text.replace(/[łŁđß]/g, (letter) => SPECIAL_LETTERS[letter] ?? letter)
  return replaced
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenizePolish(text: string): string[] {
  return normalizePolish(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !POLISH_STOPWORDS.has(word))
}

export function stemPolish(word: string): string {
  const normalized = normalizePolish(word)
  return normalized.length <= STEM_LENGTH ? normalized : normalized.slice(0, STEM_LENGTH)
}

export function stemSet(text: string): Set<string> {
  return new Set(tokenizePolish(text).map((word) => stemPolish(word)))
}

export function overlapScore(first: string, second: string): number {
  const firstStems = stemSet(first)
  const secondStems = stemSet(second)
  if (firstStems.size === 0 || secondStems.size === 0) return 0
  let shared = 0
  for (const stem of firstStems) {
    if (secondStems.has(stem)) shared += 1
  }
  const union = firstStems.size + secondStems.size - shared
  return union === 0 ? 0 : shared / union
}
