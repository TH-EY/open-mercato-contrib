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
    symbol: 'WE',
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
    contactHint: 'we@um.bydgoszcz.pl · tel. (52) 58 58 136 · ul. Grudziądzka 9-15',
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
    contactHint: 'wso@um.bydgoszcz.pl · tel. (52) 58 58 264 · ul. Przyrzecze 13',
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
    contactHint: 'odpady@um.bydgoszcz.pl · tel. (52) 58 59 134 · ul. Wojska Polskiego 65',
  },
  {
    name: 'Wydział Zieleni i Gospodarki Komunalnej',
    symbol: 'WGK',
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
    contactHint: 'wgk@um.bydgoszcz.pl · tel. (52) 58 58 394 · ul. Jezuicka 4A',
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
    contactHint: 'wab@um.bydgoszcz.pl · tel. (52) 58 58 181 · ul. Grudziądzka 9-15',
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
    contactHint: 'wim@um.bydgoszcz.pl · tel. (52) 58 58 151 · ul. Grudziądzka 9-15',
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
    contactHint: 'bks@um.bydgoszcz.pl · tel. (52) 58 58 365 · ul. Niedźwiedzia 4',
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
    contactHint: 'brm@um.bydgoszcz.pl · tel. (52) 58 58 342 · ul. Jezuicka 1',
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
  {
    name: 'Wydział Funduszy Europejskich',
    symbol: 'WF',
    kind: 'department',
    competenceScope:
      'Pozyskiwanie i rozliczanie funduszy europejskich dla projektów Miasta: wnioski o dofinansowanie, wdrażanie i trwałość projektów unijnych, informacja zbiorcza o projektach, strategia rozwoju miasta i raport o stanie gminy, monitoring sytuacji społeczno-gospodarczej.',
    keywords: [
      'fundusze europejskie', 'funduszy europejskich', 'środki unijne', 'środków unijnych', 'dofinansowanie unijne', 'projekt unijny',
      'projekty unijne', 'dotacja unijna', 'unia europejska', 'raport o stanie gminy', 'strategia rozwoju miasta', 'wniosek o dofinansowanie',
    ],
    contractCodes: ['WF'],
    contactHint: 'wf@um.bydgoszcz.pl · tel. (52) 58 58 091 · ul. Grudziądzka 9-15',
  },
  {
    name: 'Wydział Informatyki',
    symbol: 'WI',
    kind: 'department',
    competenceScope:
      'Informatyzacja Urzędu, systemy teleinformatyczne, sprzęt komputerowy i oprogramowanie, umowy z dostawcami rozwiązań informatycznych, licencje, projekty teleinformatyczne, bezpieczeństwo danych w systemach Urzędu.',
    keywords: [
      'informatyka', 'informatyzacja', 'system informatyczny', 'systemy informatyczne', 'oprogramowanie', 'licencja na oprogramowanie',
      'licencje', 'sprzęt komputerowy', 'komputery', 'serwery', 'teleinformatyczny', 'dostawca oprogramowania', 'koszty informatyczne',
    ],
    contractCodes: ['WI'],
    contactHint: 'informatyka@um.bydgoszcz.pl · tel. (52) 58 58 289 · ul. Niedźwiedzia 4',
  },
  {
    name: 'Wydział Księgowości',
    symbol: 'WK',
    kind: 'department',
    competenceScope:
      'Obsługa finansowo-księgowa wydatków i niepodatkowych dochodów Urzędu Miasta, płatności faktur, rozliczenia podatku VAT Miasta, rozliczenia finansowo-księgowe w ramach ZIT BydOF.',
    keywords: [
      'księgowość', 'faktura', 'faktury', 'płatność faktur', 'wydatki urzędu', 'koszty urzędu', 'podatek vat', 'rozliczenie vat',
      'wynagrodzenie wykonawcy', 'wypłacone kwoty', 'kwota wydatkowana',
    ],
    contractCodes: ['WK'],
    contactHint: 'wk@um.bydgoszcz.pl · tel. (52) 58 58 622 · ul. Jezuicka 6–14',
  },
  {
    name: 'Wydział Mienia i Geodezji',
    symbol: 'WMG',
    kind: 'department',
    competenceScope:
      'Gospodarowanie nieruchomościami Miasta i Skarbu Państwa: sprzedaż, dzierżawa, najem i użyczenie gruntów, ewidencja majątku nieruchomego, ewidencja gruntów i budynków, kataster, taksacja nieruchomości, ewidencja miejscowości, ulic i adresów, nazewnictwo ulic i placów.',
    keywords: [
      'nieruchomości miejskie', 'nieruchomość gminna', 'grunty miejskie', 'działka', 'działki', 'działki gminne', 'sprzedaż nieruchomości',
      'dzierżawa gruntu', 'dzierżawa terenu', 'użytkowanie wieczyste', 'mienie komunalne', 'skarb państwa', 'ewidencja gruntów',
      'ewidencja gruntów i budynków', 'geodezja', 'nazwa ulicy', 'nazewnictwo ulic', 'numeracja porządkowa', 'przetarg na sprzedaż nieruchomości',
    ],
    contractCodes: ['WMG'],
    contactHint: 'wmg@um.bydgoszcz.pl · tel. (52) 58 58 413 · ul. Grudziądzka 9-15',
  },
  {
    name: 'Wydział Ochrony Środowiska',
    symbol: 'WOŚ',
    kind: 'department',
    competenceScope:
      'Program Ochrony Środowiska i Plan Adaptacji do zmian klimatu, zadania z ustawy Prawo ochrony środowiska, decyzje środowiskowe i oceny oddziaływania na środowisko, jakość powietrza i hałas, prawo geologiczne, odpady inne niż komunalne, dotacje na inwestycje proekologiczne (np. wymiana pieców), opłaty za korzystanie ze środowiska.',
    keywords: [
      'ochrona środowiska', 'środowisko', 'decyzja środowiskowa', 'decyzja o środowiskowych uwarunkowaniach', 'ocena oddziaływania na środowisko',
      'jakość powietrza', 'smog', 'hałas', 'emisja', 'zmiany klimatu', 'adaptacja do zmian klimatu', 'wymiana pieców', 'piece węglowe',
      'dotacja ekologiczna', 'odpady niebezpieczne', 'azbest', 'prawo geologiczne', 'informacja o środowisku',
    ],
    contractCodes: ['WOŚ', 'WOS'],
    contactHint: 'wos@um.bydgoszcz.pl · tel. (52) 58 58 070 · ul. Grudziądzka 9-15',
  },
  {
    name: 'Wydział Organizacyjno-Administracyjny',
    symbol: 'WOA',
    kind: 'department',
    competenceScope:
      'Organizacja Urzędu: statut i regulaminy, rejestr zarządzeń Prezydenta, instrukcja kancelaryjna, sprawy kadrowe i szkoleniowe pracowników Urzędu, zatrudnienie i wynagrodzenia, kierownicy jednostek organizacyjnych, interpelacje i zapytania radnych, skargi i wnioski mieszkańców, obsługa administracyjna i gospodarcza Urzędu.',
    keywords: [
      'zatrudnienie w urzędzie', 'pracownicy urzędu', 'liczba pracowników', 'liczba etatów', 'etaty', 'wynagrodzenia pracowników',
      'nagrody dla pracowników', 'premie', 'kadry', 'regulamin organizacyjny', 'zarządzenie prezydenta', 'zarządzenia prezydenta',
      'rejestr zarządzeń', 'interpelacja', 'interpelacje radnych', 'skargi i wnioski', 'samochody służbowe', 'telefony służbowe',
      'szkolenia pracowników', 'struktura organizacyjna urzędu',
    ],
    contractCodes: ['WOA'],
    contactHint: 'woa@um.bydgoszcz.pl · tel. (52) 58 58 453 · ul. Niedźwiedzia 4',
  },
  {
    name: 'Wydział Podatków i Opłat Lokalnych',
    symbol: 'WPL',
    kind: 'department',
    competenceScope:
      'Wymiar podatków i opłat lokalnych: podatek od nieruchomości, rolny, leśny, od środków transportowych, opłata skarbowa i targowa, ulgi i umorzenia podatkowe, pomoc publiczna w podatkach lokalnych, interpretacje indywidualne.',
    keywords: [
      'podatek od nieruchomości', 'podatku od nieruchomości', 'podatki lokalne', 'opłaty lokalne', 'podatek rolny', 'podatek leśny',
      'podatek od środków transportowych', 'opłata skarbowa', 'opłata targowa', 'stawki podatku', 'umorzenie podatku', 'ulga podatkowa',
      'wpływy z podatków', 'interpretacja podatkowa',
    ],
    contractCodes: ['WPL'],
    contactHint: 'wpl@um.bydgoszcz.pl · tel. (52) 58 58 309 · ul. Jezuicka 6-14',
  },
  {
    name: 'Wydział Świadczeń Rodzinnych',
    symbol: 'WSR',
    kind: 'department',
    competenceScope:
      'Dodatki mieszkaniowe i energetyczne, świadczenia rodzinne i zasiłki dla opiekunów, fundusz alimentacyjny, świadczenie wychowawcze, pomoc materialna dla uczniów, jednorazowe świadczenie „Za życiem”.',
    keywords: [
      'dodatek mieszkaniowy', 'dodatki mieszkaniowe', 'dodatek energetyczny', 'świadczenia rodzinne', 'zasiłek rodzinny', 'zasiłek dla opiekuna',
      'świadczenie pielęgnacyjne', 'fundusz alimentacyjny', 'świadczenia alimentacyjne', 'świadczenie wychowawcze', '500 plus', '800 plus',
      'becikowe', 'za życiem', 'pomoc materialna dla uczniów', 'stypendium socjalne',
    ],
    contractCodes: ['WSR'],
    contactHint: 'wsr@um.bydgoszcz.pl · tel. (52) 58 56 700',
  },
  {
    name: 'Wydział Uprawnień Komunikacyjnych',
    symbol: 'WUK',
    kind: 'department',
    competenceScope:
      'Rejestracja pojazdów, prawa jazdy, nadzór nad stacjami kontroli pojazdów i ośrodkami szkolenia kierowców, licencje i zezwolenia w transporcie drogowym, taksówki, usuwanie i przechowywanie pojazdów na parkingu strzeżonym.',
    keywords: [
      'rejestracja pojazdów', 'zarejestrowane pojazdy', 'liczba zarejestrowanych', 'prawo jazdy', 'prawa jazdy', 'stacja kontroli pojazdów',
      'ośrodek szkolenia kierowców', 'szkoła jazdy', 'licencja na taksówkę', 'taksówki', 'transport drogowy', 'przewoźnik drogowy',
      'usuwanie pojazdów', 'odholowane pojazdy', 'parking strzeżony', 'samochody elektryczne zarejestrowane',
    ],
    contractCodes: ['WUK'],
    contactHint: 'wuk@um.bydgoszcz.pl · tel. (52) 58 58 600 · ul. Grudziądzka 9-15',
  },
  {
    name: 'Wydział Windykacji',
    symbol: 'WW',
    kind: 'department',
    competenceScope:
      'Windykacja podatków i opłat lokalnych, opłat za gospodarowanie odpadami oraz niepodatkowych należności Miasta, powiatu i Skarbu Państwa, postępowania egzekucyjne i egzekucja administracyjna, zaległości i tytuły wykonawcze.',
    keywords: [
      'windykacja', 'zaległości', 'zaległości podatkowe', 'należności miasta', 'egzekucja', 'egzekucja administracyjna', 'postępowanie egzekucyjne',
      'tytuł wykonawczy', 'upomnienia', 'dłużnicy', 'zadłużenie wobec miasta',
    ],
    contractCodes: ['WW'],
    contactHint: 'ww@um.bydgoszcz.pl · tel. (52) 58 59 222 · ul. Jezuicka 2-14',
  },
  {
    name: 'Wydział Zamówień Publicznych',
    symbol: 'WZP',
    kind: 'department',
    competenceScope:
      'Postępowania o udzielenie zamówienia publicznego prowadzone przez Urząd na podstawie ustawy Prawo zamówień publicznych: przetargi, oferty, wybór wykonawcy, rejestr postępowań i umów, plan postępowań.',
    keywords: [
      'zamówienie publiczne', 'zamówienia publiczne', 'zamówień publicznych', 'przetarg', 'przetargi', 'postępowanie przetargowe', 'oferty',
      'złożone oferty', 'wybór wykonawcy', 'specyfikacja warunków zamówienia', 'swz', 'plan postępowań', 'prawo zamówień publicznych',
    ],
    contractCodes: ['WZP'],
    contactHint: 'wzp@um.bydgoszcz.pl · tel. (52) 58 58 124 · ul. Grudziądzka 9-15',
  },
  {
    name: 'Wydział Zarządzania Budżetem Miasta',
    symbol: 'WZB',
    kind: 'department',
    competenceScope:
      'Planowanie budżetu Miasta i wieloletnia prognoza finansowa, płynność budżetu, zadłużenie i kredyty Miasta, sprawozdawczość budżetowa i finansowa, wykonanie budżetu, ewidencja księgowa budżetu.',
    keywords: [
      'budżet miasta', 'budżetu miasta', 'wieloletnia prognoza finansowa', 'wpf', 'wykonanie budżetu', 'sprawozdanie z wykonania budżetu',
      'zadłużenie miasta', 'dług miasta', 'kredyty', 'obligacje', 'deficyt', 'dochody budżetu', 'wydatki budżetu', 'uchwała budżetowa',
    ],
    contractCodes: ['WZB'],
    contactHint: 'wzb@um.bydgoszcz.pl · tel. (52) 58 58 816 · ul. Jezuicka 6–14',
  },
  {
    name: 'Wydział Zarządzania Kryzysowego i Ochrony Ludności',
    symbol: 'WZK',
    kind: 'department',
    competenceScope:
      'Zarządzanie kryzysowe, obrona cywilna i ochrona ludności, schrony i miejsca ukrycia, ochrona przeciwpowodziowa i przeciwpożarowa, Bydgoskie Centrum Zarządzania Kryzysowego i monitoring wizyjny miasta, Komisja Bezpieczeństwa i Porządku, łowiectwo, dzikie zwierzęta i martwe zwierzęta.',
    keywords: [
      'zarządzanie kryzysowe', 'obrona cywilna', 'ochrona ludności', 'schron', 'schrony', 'miejsca ukrycia', 'powódź', 'ochrona przeciwpowodziowa',
      'monitoring miejski', 'monitoring wizyjny', 'kamery monitoringu', 'bezpieczeństwo miasta', 'dzikie zwierzęta', 'dziki', 'łowiectwo',
      'martwe zwierzęta', 'syreny alarmowe',
    ],
    contractCodes: ['WZK'],
    contactHint: 'wzk@um.bydgoszcz.pl · tel. (52) 58 58 970 · ul. Grudziądzka 9-15',
  },
  {
    name: 'Biuro Aktywności Społecznej',
    symbol: 'BAS',
    kind: 'office',
    competenceScope:
      'Współpraca z organizacjami pozarządowymi i ich wsparcie finansowe, otwarte konkursy ofert i dotacje dla NGO, wolontariat, polityka senioralna, promocja rodziny, polityka równościowa i wielokulturowość, Centrum Organizacji Pozarządowych „Gdańska 5”, Centrum Seniorów, rady i organy doradcze.',
    keywords: [
      'organizacje pozarządowe', 'organizacji pozarządowych', 'ngo', 'stowarzyszenia', 'fundacje', 'dotacje dla organizacji', 'konkurs ofert',
      'otwarty konkurs ofert', 'wolontariat', 'seniorzy', 'polityka senioralna', 'rada seniorów', 'rada młodzieżowa', 'karta rodziny', 'równość',
    ],
    contractCodes: ['BAS'],
    contactHint: 'bas@um.bydgoszcz.pl · ul. Gdańska 5',
  },
  {
    name: 'Biuro Cyfryzacji i Bezpieczeństwa Informacji',
    symbol: 'BCB',
    kind: 'office',
    competenceScope:
      'System zgłoszeń „Dbamy o Bydgoszcz” i Platforma Miejska, e-usługi dla mieszkańców, cyfryzacja obsługi, bezpieczeństwo informacji i ciągłość działania, ochrona danych osobowych (wsparcie Inspektora Ochrony Danych), lobbing i przeciwdziałanie praniu pieniędzy.',
    keywords: [
      'dbamy o bydgoszcz', 'zgłoszenia mieszkańców', 'platforma miejska', 'e-usługi', 'usługi elektroniczne', 'cyfryzacja', 'aplikacja miejska',
      'bezpieczeństwo informacji', 'ochrona danych osobowych', 'inspektor ochrony danych', 'rodo', 'naruszenie danych',
    ],
    contractCodes: ['BCB'],
    contactHint: 'bcb@um.bydgoszcz.pl · tel. (52) 58 58 294',
  },
  {
    name: 'Biuro ds. Zdrowia i Polityki Społecznej',
    symbol: 'BZS',
    kind: 'office',
    competenceScope:
      'Polityka zdrowotna Miasta i programy polityki zdrowotnej (szczepienia, profilaktyka, in vitro), współpraca z placówkami ochrony zdrowia i pomocy społecznej (MOPS, DPS, żłobki miejskie), osoby z niepełnosprawnościami i dostępność, przewóz osób z niepełnosprawnościami, przeciwdziałanie uzależnieniom.',
    keywords: [
      'zdrowie', 'ochrona zdrowia', 'program polityki zdrowotnej', 'programy zdrowotne', 'profilaktyka', 'szczepienia', 'in vitro',
      'niepełnosprawności', 'osoby z niepełnosprawnościami', 'dostępność', 'przewóz osób niepełnosprawnych', 'żłobki miejskie',
      'pomoc społeczna', 'dom pomocy społecznej', 'uzależnienia', 'profilaktyka alkoholowa', 'bezdomność',
    ],
    contractCodes: ['BZS'],
    contactHint: 'bzs@um.bydgoszcz.pl · tel. (52) 58 58 904 · ul. Jagiellońska 61',
  },
  {
    name: 'Biuro Konserwatora Zabytków',
    symbol: 'BKZ',
    kind: 'office',
    competenceScope:
      'Miejski Konserwator Zabytków: ochrona zabytków i opieka nad zabytkami na terenie Miasta, gminna ewidencja zabytków nieruchomych, decyzje, opinie i postanowienia konserwatorskie, dotacje na prace przy zabytkach.',
    keywords: [
      'zabytek', 'zabytki', 'zabytków', 'miejski konserwator zabytków', 'gminna ewidencja zabytków', 'ewidencja zabytków', 'opinia konserwatorska',
      'dotacje na zabytki', 'prace konserwatorskie', 'kamienica zabytkowa',
    ],
    contractCodes: ['BKZ', 'MKZ'],
    contactHint: 'mkz@um.bydgoszcz.pl · tel. (52) 58 58 069 · ul. Jezuicka 2',
  },
  {
    name: 'Biuro Kultury Bydgoskiej',
    symbol: 'BKB',
    kind: 'office',
    competenceScope:
      'Rozwój i upowszechnianie kultury, miejskie instytucje kultury i ich rejestr, dotacje i konkursy na zadania kulturalne, wydarzenia i festiwale, stypendia i nagrody kulturalne, współpraca ze środowiskiem twórczym.',
    keywords: [
      'kultura', 'instytucje kultury', 'instytucja kultury', 'wydarzenia kulturalne', 'festiwal', 'festiwale', 'koncert', 'teatr', 'muzeum',
      'biblioteka', 'stypendia kulturalne', 'nagrody kulturalne', 'dotacje na kulturę', 'mecenat kulturalny',
    ],
    contractCodes: ['BKB'],
    contactHint: 'bkb@um.bydgoszcz.pl · tel. (52) 58 58 189 · ul. Sielanka 8A',
  },
  {
    name: 'Biuro Prasowe',
    symbol: 'BPR',
    kind: 'office',
    competenceScope:
      'Polityka informacyjna Miasta: rzecznik prasowy, komunikaty i informacje dla mediów, odpowiedzi na pytania dziennikarzy, media społecznościowe Miasta.',
    keywords: [
      'rzecznik prasowy', 'biuro prasowe', 'komunikat prasowy', 'media', 'dziennikarze', 'konferencja prasowa', 'media społecznościowe',
      'polityka informacyjna',
    ],
    contractCodes: ['BPR'],
    contactHint: 'rzecznik@um.bydgoszcz.pl · tel. (52) 58 58 851 · ul. Niedźwiedzia 4',
  },
  {
    name: 'Biuro Promocji Miasta i Współpracy z Zagranicą',
    symbol: 'BP',
    kind: 'office',
    competenceScope:
      'Budowa wizerunku i promocja Miasta Bydgoszczy, kampanie promocyjne i reklamowe, wydatki na promocję, sponsoring i umowy promocyjne, gadżety, miasta partnerskie i współpraca międzynarodowa.',
    keywords: [
      'promocja miasta', 'promocji miasta', 'kampania promocyjna', 'kampania reklamowa', 'reklama', 'wydatki na promocję', 'koszty promocji',
      'sponsoring', 'umowy promocyjne', 'gadżety', 'wizerunek miasta', 'miasta partnerskie', 'współpraca zagraniczna', 'delegacje zagraniczne',
    ],
    contractCodes: ['BP'],
    contactHint: 'bp@um.bydgoszcz.pl · tel. (52) 58 58 446 · ul. Niedźwiedzia 4',
  },
  {
    name: 'Biuro ZIT',
    symbol: 'BZIT',
    kind: 'office',
    competenceScope:
      'Zintegrowane Inwestycje Terytorialne Bydgoskiego Obszaru Funkcjonalnego (ZIT BydOF): nabory i wybór projektów, porozumienia gmin obszaru funkcjonalnego, rozliczanie środków ZIT.',
    keywords: [
      'zit', 'zintegrowane inwestycje terytorialne', 'bydgoski obszar funkcjonalny', 'bydof', 'nabór wniosków zit', 'projekty zit',
    ],
    contractCodes: ['BZIT', 'ZIT'],
    contactHint: 'zit@um.bydgoszcz.pl · tel. (52) 58 59 446 · ul. Jagiellońska 61',
  },
]
