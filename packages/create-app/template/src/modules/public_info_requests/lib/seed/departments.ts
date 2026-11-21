import type { DepartmentKind } from '../routing/keywords'

export type DepartmentSeed = {
  name: string
  symbol: string
  kind: DepartmentKind
  competenceScope: string
  keywords: string[]
  contractCodes: string[]
  contactHint: string | null
}

export const DEPARTMENT_SEEDS: DepartmentSeed[] = [
  {
    name: 'Wydział Edukacji i Sportu',
    symbol: 'WES',
    kind: 'department',
    competenceScope:
      'Prowadzenie spraw oświaty: szkoły podstawowe i ponadpodstawowe, przedszkola, liczba uczniów i oddziałów, uczniowie cudzoziemcy, kadra nauczycielska, rekrutacja, dowozy uczniów, stypendia oraz sport i rekreacja, kluby sportowe, dotacje sportowe.',
    keywords: [
      'edukacja', 'oświata', 'oświatowe', 'szkoła', 'szkoły', 'szkół', 'szkołach', 'szkole', 'szkoła podstawowa',
      'szkoły podstawowe', 'szkołach podstawowych', 'liceum', 'technikum', 'przedszkole', 'przedszkola', 'przedszkoli',
      'żłobek', 'uczeń', 'uczniów', 'uczniowie', 'uczniach', 'uczennic', 'liczba uczniów', 'cudzoziemcy', 'cudzoziemców',
      'obcokrajowcy', 'obcokrajowców', 'oddziały klasowe', 'klasa', 'klasy', 'nauczyciel', 'nauczyciele', 'nauczycieli',
      'dyrektor szkoły', 'rekrutacja', 'stypendium', 'stypendia', 'dowóz uczniów', 'subwencja oświatowa', 'sport',
      'sportowe', 'klub sportowy', 'kluby sportowe', 'dotacje sportowe', 'hala sportowa', 'orlik', 'zawody sportowe',
    ],
    contractCodes: ['WES', 'WEIS'],
    contactHint: null,
  },
  {
    name: 'Wydział Spraw Obywatelskich',
    symbol: 'WSO',
    kind: 'department',
    competenceScope:
      'Ewidencja ludności i meldunki, dowody osobiste, rejestr wyborców, zezwolenia na sprzedaż napojów alkoholowych i punkty sprzedaży alkoholu, zgromadzenia publiczne, imprezy masowe, ewidencja działalności gospodarczej.',
    keywords: [
      'alkohol', 'alkoholu', 'alkoholowych', 'napoje alkoholowe', 'napojów alkoholowych', 'sprzedaż alkoholu',
      'punkty sprzedaży', 'punktów sprzedaży', 'punkty sprzedaży alkoholu', 'zezwolenie na sprzedaż', 'zezwolenia na sprzedaż',
      'zezwoleń na sprzedaż', 'koncesja', 'koncesje', 'ewidencja ludności', 'meldunek', 'meldunki', 'zameldowanie',
      'zameldowanych', 'wymeldowanie', 'dowód osobisty', 'dowody osobiste', 'dowodów osobistych', 'pesel',
      'rejestr wyborców', 'spis wyborców', 'zgromadzenie publiczne', 'zgromadzenia', 'impreza masowa', 'imprezy masowe',
      'działalność gospodarcza', 'ceidg', 'stan cywilny',
    ],
    contractCodes: ['WSO'],
    contactHint: null,
  },
  {
    name: 'Wydział Gospodarki Odpadami',
    symbol: 'WGO',
    kind: 'department',
    competenceScope:
      'System gospodarowania odpadami komunalnymi: deklaracje o wysokości opłaty, opłaty za gospodarowanie odpadami, liczba mieszkańców według deklaracji, odbiór i wywóz odpadów, segregacja, PSZOK, umowy na odbiór odpadów.',
    keywords: [
      'odpady', 'odpadów', 'odpadami', 'odpady komunalne', 'odpadami komunalnymi', 'gospodarowanie odpadami',
      'gospodarowania odpadami', 'śmieci', 'śmieciowa', 'deklaracja', 'deklaracje', 'deklaracji', 'deklaracjach',
      'opłata za gospodarowanie', 'opłaty za gospodarowanie', 'opłat za gospodarowanie', 'opłata śmieciowa',
      'liczba mieszkańców', 'liczby mieszkańców', 'mieszkańców według deklaracji', 'wywóz odpadów', 'odbiór odpadów',
      'segregacja', 'pszok', 'kontenery', 'pojemniki na odpady', 'nieruchomości zamieszkałe', 'harmonogram odbioru',
    ],
    contractCodes: ['WGO'],
    contactHint: null,
  },
  {
    name: 'Wydział Zieleni i Gospodarki Komunalnej',
    symbol: 'WZiGK',
    kind: 'department',
    competenceScope:
      'Utrzymanie zieleni miejskiej, drzewa i nasadzenia, parki i skwery, gospodarka komunalna, cmentarze komunalne, szalety, place zabaw, realizacja zadania opieki nad bezdomnymi zwierzętami i ich wyłapywania, umowy na odławianie zwierząt i opiekę weterynaryjną.',
    keywords: [
      'zieleń', 'zieleni', 'zielone', 'tereny zielone', 'drzewa', 'drzew', 'drzewo', 'wycinka', 'wycinki', 'nasadzenia',
      'park', 'parki', 'skwer', 'skwery', 'trawniki', 'gospodarka komunalna', 'cmentarz komunalny', 'szalety',
      'place zabaw', 'bezdomne zwierzęta', 'bezdomnych zwierząt', 'bezdomnymi zwierzętami', 'bezdomnym zwierzętom',
      'zwierzęta', 'zwierząt', 'ochrona zwierząt', 'ochronie zwierząt', 'opieka nad zwierzętami', 'odławianie',
      'odłowienie', 'odławiania', 'wyłapywanie', 'wyłapywania', 'usługi weterynaryjne', 'dokarmianie', 'koty wolno żyjące',
      'psy', 'koty', 'gołębie', 'zadanie gminy', 'program opieki',
    ],
    contractCodes: ['WGK', 'WZIGK'],
    contactHint: null,
  },
  {
    name: 'Wydział Administracji Budowlanej',
    symbol: 'WAB',
    kind: 'department',
    competenceScope:
      'Pozwolenia na budowę i rozbiórkę, zgłoszenia robót, projekty budowlane i dokumentacja budowlana inwestycji prywatnych, projekt zagospodarowania terenu, decyzje o warunkach zabudowy w zakresie administracji architektoniczno-budowlanej.',
    keywords: [
      'pozwolenie na budowę', 'pozwolenia na budowę', 'pozwoleniu na budowę', 'projekt budowlany', 'projektu budowlanego',
      'dokumentacja budowlana', 'dokumentacji budowlanej', 'dokumentacja budynku', 'dokumentacji dotyczącej budynku',
      'projekt zagospodarowania', 'projekt zagospodarowania terenu', 'zagospodarowania terenu', 'zagospodarowania zieleni',
      'apartamentowiec', 'apartamentowca', 'budynek mieszkalny', 'budynku', 'budynek', 'wizualizacje', 'wizualizacja',
      'parametry techniczne', 'parametrów technicznych', 'zgłoszenie robót', 'rozbiórka', 'warunki zabudowy',
      'decyzja o warunkach zabudowy', 'samowola budowlana', 'architektura', 'inwestor', 'inwestora', 'deweloper',
    ],
    contractCodes: ['WAB'],
    contactHint: null,
  },
  {
    name: 'Wydział Inwestycji Miasta',
    symbol: 'WIM',
    kind: 'department',
    competenceScope:
      'Realizacja inwestycji miejskich: budowa i przebudowa obiektów, rewitalizacja, kompleksy sportowe i baseny, nadzór nad robotami budowlanymi, dziennik budowy, kierownik budowy i kierownicy robót, przebudowa bulwarów i nabrzeży, umowy z wykonawcami inwestycji.',
    keywords: [
      'inwestycja', 'inwestycji', 'inwestycje', 'inwestycja miejska', 'budowa kompleksu', 'budowy kompleksu',
      'kompleks sportowy', 'dziennik budowy', 'dziennika budowy', 'kierownik budowy', 'kierownika budowy', 'kierownik robót',
      'kierownika robót', 'roboty budowlane', 'robót budowlanych', 'nadzór inwestorski', 'inspektor nadzoru', 'basen',
      'basenu', 'pływalnia', 'rewitalizacja', 'rewitalizacji', 'przebudowa', 'przebudowy', 'bulwar', 'bulwary',
      'bulwarów', 'bulwaru', 'nabrzeże', 'nabrzeża', 'modernizacja', 'termomodernizacja', 'wykonawca inwestycji',
      'odbiór inwestycji',
    ],
    contractCodes: ['WIM', 'WIN'],
    contactHint: null,
  },
  {
    name: 'Biuro Komunikacji Społecznej',
    symbol: 'BKS',
    kind: 'office',
    competenceScope:
      'Obsługa wniosków o udostępnienie informacji publicznej, kontakty z mediami, rzecznik prasowy, kampanie informacyjne i promocyjne miasta, konsultacje społeczne, strona internetowa i media społecznościowe urzędu.',
    keywords: [
      'rzecznik prasowy', 'media', 'mediów', 'konferencja prasowa', 'kampania informacyjna', 'kampanie promocyjne',
      'promocja miasta', 'reklama', 'media społecznościowe', 'facebook', 'strona internetowa', 'konsultacje społeczne',
      'komunikacja społeczna', 'wnioski o informację publiczną', 'biuletyn informacji publicznej',
    ],
    contractCodes: ['BKS'],
    contactHint: null,
  },
  {
    name: 'Biuro Rady Miasta',
    symbol: 'BRM',
    kind: 'office',
    competenceScope:
      'Obsługa Rady Miasta Bydgoszczy: sesje i komisje, uchwały rady, interpelacje i zapytania radnych, protokoły z sesji, wyniki głosowań, diety radnych.',
    keywords: [
      'rada miasta', 'rady miasta', 'radny', 'radna', 'radni', 'radnych', 'sesja', 'sesji', 'sesje', 'komisja rady',
      'komisji rady', 'uchwała', 'uchwały', 'uchwał', 'projekt uchwały', 'interpelacja', 'interpelacje', 'zapytanie radnego',
      'protokół z sesji', 'protokoły z sesji', 'głosowanie', 'głosowania', 'diety radnych', 'przewodniczący rady',
    ],
    contractCodes: ['BRM'],
    contactHint: null,
  },
  {
    name: 'Schronisko dla Zwierząt w Bydgoszczy',
    symbol: 'SDZ',
    kind: 'municipal_unit',
    competenceScope:
      'Miejska jednostka budżetowa zapewniająca opiekę bezdomnym zwierzętom: przyjmowanie i odławianie zwierząt, opieka weterynaryjna, adopcje, ewidencja psów i kotów przebywających w schronisku, koszty utrzymania zwierząt.',
    keywords: [
      'schronisko', 'schroniska', 'schronisku', 'schronisko dla zwierząt', 'bezdomne zwierzęta', 'bezdomnych zwierząt',
      'bezdomnymi zwierzętami', 'bezdomnym zwierzętom', 'opieka nad zwierzętami', 'opieki bezdomnym zwierzętom',
      'zapewnianie opieki', 'adopcja', 'adopcje', 'adopcji', 'psy', 'psów', 'koty', 'kotów', 'z podziałem na psy i koty',
      'weterynaryjne', 'weterynarz', 'leczenie zwierząt', 'sterylizacja', 'kastracja', 'czipowanie', 'odłowione',
      'wyłapywanie', 'wyłapywania', 'odławianie', 'odławiania',
    ],
    contractCodes: ['SDZ', 'SCHR'],
    contactHint: 'ul. Grunwaldzka 298, 85-438 Bydgoszcz',
  },
  {
    name: 'Zarząd Dróg Miejskich i Komunikacji Publicznej',
    symbol: 'ZDMiKP',
    kind: 'municipal_unit',
    competenceScope:
      'Miejska jednostka zarządzająca drogami publicznymi i komunikacją zbiorową: remonty i utrzymanie ulic, chodników i mostów, organizacja ruchu, sygnalizacja, transport publiczny, rozkłady jazdy, bilety, strefa płatnego parkowania, umowy na systemy transportowe.',
    keywords: [
      'drogi publiczne', 'drogi gminne', 'droga publiczna', 'remont drogi', 'remont ulicy', 'remont ulic', 'remontu ulicy',
      'nawierzchnia', 'nawierzchni', 'chodnik', 'chodniki', 'chodnika', 'most', 'mosty', 'wiadukt', 'organizacja ruchu',
      'sygnalizacja świetlna', 'oznakowanie', 'pas drogowy', 'pasa drogowego', 'zajęcie pasa drogowego',
      'komunikacja publiczna', 'komunikacji publicznej', 'komunikacja miejska', 'transport publiczny', 'transport zbiorowy',
      'autobus', 'autobusy', 'tramwaj', 'tramwaje', 'tramwajowa', 'przystanek', 'przystanki', 'rozkład jazdy', 'bilety',
      'bilet', 'biletowy', 'strefa płatnego parkowania', 'parkowanie', 'parkingi', 'ścieżki rowerowe', 'drogowe',
      'inteligentny system transportowy', 'system transportowy', 'zarząd dróg',
    ],
    contractCodes: ['TT', 'ZDMIKP'],
    contactHint: 'ul. Toruńska 174a, 85-844 Bydgoszcz, e-mail: zarzad@zdmikp.bydgoszcz.pl',
  },
  {
    name: 'Kujawsko-Pomorski Wojewódzki Konserwator Zabytków — Delegatura w Bydgoszczy',
    symbol: 'WKZ',
    kind: 'external',
    competenceScope:
      'Organ ochrony zabytków (administracja rządowa): rejestr zabytków, ochrona i konserwacja zabytków, pomników, rzeźb i dzieł sztuki w przestrzeni publicznej, pozwolenia konserwatorskie, przemieszczanie i demontaż obiektów zabytkowych.',
    keywords: [
      'zabytek', 'zabytki', 'zabytków', 'zabytkowy', 'zabytkowa', 'zabytkowej', 'rejestr zabytków', 'ochrona zabytków',
      'konserwator', 'konserwatora', 'konserwator zabytków', 'konserwacja', 'konserwatorskie', 'rzeźba', 'rzeźby',
      'rzeźbę', 'rzeźbą', 'rzeźbie', 'pomnik', 'pomnika', 'pomniki', 'monument', 'dzieło sztuki', 'dzieła sztuki',
      'płaskorzeźba', 'demontaż rzeźby', 'przechowywana rzeźba', 'mała architektura zabytkowa',
    ],
    contractCodes: ['WKZ'],
    contactHint: 'Delegatura w Bydgoszczy, 85-102 Bydgoszcz, e-mail: bydgoszcz@torun.wkz.gov.pl',
  },
]
