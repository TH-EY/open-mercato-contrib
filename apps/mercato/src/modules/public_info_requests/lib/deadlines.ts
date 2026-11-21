export type IsoDate = string
export type DeadlineMode = 'calendar' | 'working'
export type DeadlineTone = 'overdue' | 'today' | 'tomorrow' | 'paused' | 'normal' | 'done'
export type ShiftedDate = { due: IsoDate; shiftedFrom: IsoDate | null }

const MS_PER_DAY = 86_400_000
const STATUTORY_DAYS = 14
const EXTENSION_MONTHS = 2
const CHRISTMAS_EVE_HOLIDAY_FROM_YEAR = 2025
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const DONE_STATUSES = new Set(['sent', 'left_unprocessed'])
const PAUSED_STATUS = 'awaiting_clarification'

const POLISH_WEEKDAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota']

const FIXED_HOLIDAYS: { monthDay: string; name: string; fromYear?: number }[] = [
  { monthDay: '01-01', name: 'Nowy Rok' },
  { monthDay: '01-06', name: 'Trzech Króli' },
  { monthDay: '05-01', name: 'Święto Pracy' },
  { monthDay: '05-03', name: 'Święto Konstytucji 3 Maja' },
  { monthDay: '08-15', name: 'Wniebowzięcie Najświętszej Maryi Panny' },
  { monthDay: '11-01', name: 'Wszystkich Świętych' },
  { monthDay: '11-11', name: 'Narodowe Święto Niepodległości' },
  { monthDay: '12-24', name: 'Wigilia Bożego Narodzenia', fromYear: CHRISTMAS_EVE_HOLIDAY_FROM_YEAR },
  { monthDay: '12-25', name: 'Boże Narodzenie (pierwszy dzień)' },
  { monthDay: '12-26', name: 'Boże Narodzenie (drugi dzień)' },
]

const MOVEABLE_HOLIDAYS: { offsetFromEaster: number; name: string }[] = [
  { offsetFromEaster: 0, name: 'Wielkanoc' },
  { offsetFromEaster: 1, name: 'Poniedziałek Wielkanocny' },
  { offsetFromEaster: 49, name: 'Zielone Świątki' },
  { offsetFromEaster: 60, name: 'Boże Ciało' },
]

type DateParts = { year: number; month: number; day: number }

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0')
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function parseParts(date: IsoDate): DateParts {
  const match = ISO_DATE_PATTERN.exec(date)
  if (!match) throw new Error(`[internal] Invalid ISO date: ${date}`)
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > daysInMonth(parts.year, parts.month)) {
    throw new Error(`[internal] Invalid ISO date: ${date}`)
  }
  return parts
}

function formatParts(parts: DateParts): IsoDate {
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`
}

function toEpochDay(date: IsoDate): number {
  const { year, month, day } = parseParts(date)
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY)
}

function fromEpochDay(epochDay: number): IsoDate {
  const value = new Date(epochDay * MS_PER_DAY)
  return formatParts({ year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() })
}

function yearOf(date: IsoDate): number {
  return parseParts(date).year
}

function describeDate(date: IsoDate): string {
  return `${formatPlDate(date)} (${POLISH_WEEKDAYS[weekdayIndex(date)]})`
}

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) return false
  try {
    parseParts(value)
    return true
  } catch {
    return false
  }
}

export function easterSunday(year: number): IsoDate {
  const golden = year % 19
  const century = Math.floor(year / 100)
  const yearOfCentury = year % 100
  const leapCenturies = Math.floor(century / 4)
  const centuryRemainder = century % 4
  const correction = Math.floor((century + 8) / 25)
  const moonCorrection = Math.floor((century - correction + 1) / 3)
  const epact = (19 * golden + century - leapCenturies - moonCorrection + 15) % 30
  const leapYears = Math.floor(yearOfCentury / 4)
  const yearRemainder = yearOfCentury % 4
  const weekdayOffset = (32 + 2 * centuryRemainder + 2 * leapYears - epact - yearRemainder) % 7
  const lateCorrection = Math.floor((golden + 11 * epact + 22 * weekdayOffset) / 451)
  const sum = epact + weekdayOffset - 7 * lateCorrection + 114
  return formatParts({ year, month: Math.floor(sum / 31), day: (sum % 31) + 1 })
}

export function listPolishPublicHolidays(year: number): { date: IsoDate; name: string }[] {
  const fixed = FIXED_HOLIDAYS
    .filter((holiday) => holiday.fromYear === undefined || year >= holiday.fromYear)
    .map((holiday) => ({ date: `${pad(year, 4)}-${holiday.monthDay}`, name: holiday.name }))
  const easter = easterSunday(year)
  const moveable = MOVEABLE_HOLIDAYS.map((holiday) => ({
    date: addCalendarDays(easter, holiday.offsetFromEaster),
    name: holiday.name,
  }))
  return [...fixed, ...moveable].sort((left, right) => left.date.localeCompare(right.date))
}

export function polishPublicHolidays(year: number, extra: IsoDate[] = []): Set<IsoDate> {
  const holidays = new Set(listPolishPublicHolidays(year).map((holiday) => holiday.date))
  for (const date of extra) {
    if (isIsoDate(date)) holidays.add(date)
  }
  return holidays
}

export function holidaySetForDates(dates: IsoDate[], extra: IsoDate[] = []): Set<IsoDate> {
  const years = new Set<number>()
  for (const date of dates) {
    const year = yearOf(date)
    years.add(year)
    years.add(year + 1)
  }
  const holidays = new Set<IsoDate>()
  for (const year of years) {
    for (const date of polishPublicHolidays(year)) holidays.add(date)
  }
  for (const date of extra) {
    if (isIsoDate(date)) holidays.add(date)
  }
  return holidays
}

export function addCalendarDays(date: IsoDate, days: number): IsoDate {
  return fromEpochDay(toEpochDay(date) + days)
}

export function addCalendarMonths(date: IsoDate, months: number): IsoDate {
  const { year, month, day } = parseParts(date)
  const monthIndex = year * 12 + (month - 1) + months
  const targetYear = Math.floor(monthIndex / 12)
  const targetMonth = monthIndex - targetYear * 12 + 1
  return formatParts({
    year: targetYear,
    month: targetMonth,
    day: Math.min(day, daysInMonth(targetYear, targetMonth)),
  })
}

export function weekdayIndex(date: IsoDate): number {
  const { year, month, day } = parseParts(date)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

export function isNonWorkingDay(date: IsoDate, holidays: Set<IsoDate>): boolean {
  const weekday = weekdayIndex(date)
  return weekday === 0 || weekday === 6 || holidays.has(date)
}

export function shiftToWorkingDay(date: IsoDate, holidays: Set<IsoDate>): ShiftedDate {
  let due = date
  while (isNonWorkingDay(due, holidays)) due = addCalendarDays(due, 1)
  return { due, shiftedFrom: due === date ? null : date }
}

export function addWorkingDays(date: IsoDate, days: number, holidays: Set<IsoDate>): IsoDate {
  if (days < 0) return subtractWorkingDays(date, -days, holidays)
  let current = date
  let remaining = days
  while (remaining > 0) {
    current = addCalendarDays(current, 1)
    if (!isNonWorkingDay(current, holidays)) remaining -= 1
  }
  return current
}

export function subtractWorkingDays(date: IsoDate, days: number, holidays: Set<IsoDate>): IsoDate {
  if (days < 0) return addWorkingDays(date, -days, holidays)
  let current = date
  let remaining = days
  while (remaining > 0) {
    current = addCalendarDays(current, -1)
    if (!isNonWorkingDay(current, holidays)) remaining -= 1
  }
  return current
}

export function statutoryDueDate(
  receivedAt: IsoDate,
  mode: DeadlineMode = 'calendar',
  extraHolidays: IsoDate[] = [],
): ShiftedDate & { explanation: string } {
  const holidays = holidaySetForDates([receivedAt], extraHolidays)
  if (mode === 'working') {
    const due = addWorkingDays(receivedAt, STATUTORY_DAYS, holidays)
    return {
      due,
      shiftedFrom: null,
      explanation: `${formatPlDate(receivedAt)} + ${STATUTORY_DAYS} dni roboczych = ${describeDate(due)}`,
    }
  }
  const raw = addCalendarDays(receivedAt, STATUTORY_DAYS)
  const shifted = shiftToWorkingDay(raw, holidays)
  const base = `${formatPlDate(receivedAt)} + ${STATUTORY_DAYS} dni = ${describeDate(raw)}`
  const explanation = shifted.shiftedFrom ? `${base} → ${describeDate(shifted.due)}` : base
  return { ...shifted, explanation }
}

export function maxExtensionDate(receivedAt: IsoDate, extraHolidays: IsoDate[] = []): ShiftedDate {
  const raw = addCalendarMonths(receivedAt, EXTENSION_MONTHS)
  return shiftToWorkingDay(raw, holidaySetForDates([receivedAt, raw], extraHolidays))
}

export function internalDueDate(currentDue: IsoDate, offsetWorkingDays: number, extraHolidays: IsoDate[] = []): IsoDate {
  const holidays = holidaySetForDates([addCalendarDays(currentDue, -366), currentDue], extraHolidays)
  return subtractWorkingDays(currentDue, offsetWorkingDays, holidays)
}

export function clarificationDueDate(deliveredAt: IsoDate, days: number, extraHolidays: IsoDate[] = []): ShiftedDate {
  const raw = addCalendarDays(deliveredAt, days)
  return shiftToWorkingDay(raw, holidaySetForDates([deliveredAt, raw], extraHolidays))
}

export function daysRemaining(today: IsoDate, due: IsoDate): number {
  return toEpochDay(due) - toEpochDay(today)
}

export function deadlineTone(today: IsoDate, input: { status: string; currentDueDate: IsoDate | null }): DeadlineTone {
  if (DONE_STATUSES.has(input.status)) return 'done'
  if (input.status === PAUSED_STATUS) return 'paused'
  if (!input.currentDueDate) return 'normal'
  const remaining = daysRemaining(today, input.currentDueDate)
  if (remaining < 0) return 'overdue'
  if (remaining === 0) return 'today'
  if (remaining === 1) return 'tomorrow'
  return 'normal'
}

export function formatPlDate(date: IsoDate): string {
  const { year, month, day } = parseParts(date)
  return `${pad(day, 2)}.${pad(month, 2)}.${pad(year, 4)}`
}

export function todayIso(now: Date = new Date()): IsoDate {
  return now.toISOString().slice(0, 10)
}
