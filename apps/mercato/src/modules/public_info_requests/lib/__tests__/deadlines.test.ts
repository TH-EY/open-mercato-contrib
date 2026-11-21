import {
  addCalendarDays,
  addCalendarMonths,
  addWorkingDays,
  clarificationDueDate,
  daysRemaining,
  deadlineTone,
  easterSunday,
  formatPlDate,
  holidaySetForDates,
  internalDueDate,
  isIsoDate,
  isNonWorkingDay,
  listPolishPublicHolidays,
  maxExtensionDate,
  polishPublicHolidays,
  shiftToWorkingDay,
  statutoryDueDate,
  subtractWorkingDays,
  todayIso,
  weekdayIndex,
} from '../deadlines'

describe('public_info_requests deadlines', () => {
  describe('isIsoDate', () => {
    it('accepts valid ISO dates and rejects invalid values', () => {
      expect(isIsoDate('2026-11-21')).toBe(true)
      expect(isIsoDate('2028-02-29')).toBe(true)
      expect(isIsoDate('2027-02-29')).toBe(false)
      expect(isIsoDate('2026-13-01')).toBe(false)
      expect(isIsoDate('21.11.2026')).toBe(false)
      expect(isIsoDate(20261121)).toBe(false)
      expect(isIsoDate(null)).toBe(false)
    })
  })

  describe('easterSunday', () => {
    it('computes Easter Sunday with the anonymous Gregorian algorithm', () => {
      expect(easterSunday(2024)).toBe('2024-03-31')
      expect(easterSunday(2025)).toBe('2025-04-20')
      expect(easterSunday(2026)).toBe('2026-04-05')
      expect(easterSunday(2027)).toBe('2027-03-28')
    })
  })

  describe('polishPublicHolidays', () => {
    it('includes Easter Monday 2027 and the other moveable holidays', () => {
      const holidays = polishPublicHolidays(2027)
      expect(holidays.has('2027-03-28')).toBe(true)
      expect(holidays.has('2027-03-29')).toBe(true)
      expect(holidays.has('2027-05-16')).toBe(true)
      expect(holidays.has('2027-05-27')).toBe(true)
    })

    it('treats Christmas Eve as a holiday only from 2025', () => {
      expect(polishPublicHolidays(2024).has('2024-12-24')).toBe(false)
      expect(polishPublicHolidays(2025).has('2025-12-24')).toBe(true)
      expect(polishPublicHolidays(2026).has('2026-12-24')).toBe(true)
    })

    it('merges valid extra holidays', () => {
      const holidays = polishPublicHolidays(2026, ['2026-11-02', 'not-a-date'])
      expect(holidays.has('2026-11-02')).toBe(true)
      expect(holidays.has('not-a-date')).toBe(false)
    })

    it('lists holidays with Polish names in date order', () => {
      const list = listPolishPublicHolidays(2026)
      expect(list).toHaveLength(14)
      expect(list[0]).toEqual({ date: '2026-01-01', name: 'Nowy Rok' })
      expect(list.find((holiday) => holiday.date === '2026-06-04')?.name).toBe('Boże Ciało')
      const dates = list.map((holiday) => holiday.date)
      expect([...dates].sort()).toEqual(dates)
      expect(listPolishPublicHolidays(2024)).toHaveLength(13)
    })

    it('builds a holiday set covering every touched year plus the following one', () => {
      const holidays = holidaySetForDates(['2026-11-23'], ['2027-06-01'])
      expect(holidays.has('2026-12-25')).toBe(true)
      expect(holidays.has('2027-01-06')).toBe(true)
      expect(holidays.has('2027-06-01')).toBe(true)
      expect(holidays.has('2025-12-25')).toBe(false)
    })
  })

  describe('calendar arithmetic', () => {
    it('adds calendar days across month and year boundaries', () => {
      expect(addCalendarDays('2026-12-25', 10)).toBe('2027-01-04')
      expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28')
    })

    it('clamps the day of month when adding months', () => {
      expect(addCalendarMonths('2027-01-31', 1)).toBe('2027-02-28')
      expect(addCalendarMonths('2028-01-31', 1)).toBe('2028-02-29')
      expect(addCalendarMonths('2026-11-23', 2)).toBe('2027-01-23')
      expect(addCalendarMonths('2027-03-31', -1)).toBe('2027-02-28')
    })

    it('returns weekday indexes with Sunday as 0', () => {
      expect(weekdayIndex('2026-11-22')).toBe(0)
      expect(weekdayIndex('2026-11-23')).toBe(1)
      expect(weekdayIndex('2026-11-21')).toBe(6)
    })

    it('treats Saturdays, Sundays and holidays as non-working', () => {
      const holidays = polishPublicHolidays(2026)
      expect(isNonWorkingDay('2026-11-21', holidays)).toBe(true)
      expect(isNonWorkingDay('2026-11-22', holidays)).toBe(true)
      expect(isNonWorkingDay('2026-11-11', holidays)).toBe(true)
      expect(isNonWorkingDay('2026-11-23', holidays)).toBe(false)
    })

    it('shifts to the next working day only when needed', () => {
      const holidays = polishPublicHolidays(2026)
      expect(shiftToWorkingDay('2026-11-21', holidays)).toEqual({ due: '2026-11-23', shiftedFrom: '2026-11-21' })
      expect(shiftToWorkingDay('2026-11-23', holidays)).toEqual({ due: '2026-11-23', shiftedFrom: null })
    })

    it('adds and subtracts working days', () => {
      const holidays = holidaySetForDates(['2026-11-01'])
      expect(addWorkingDays('2026-11-23', 14, holidays)).toBe('2026-12-11')
      expect(addWorkingDays('2026-11-23', 0, holidays)).toBe('2026-11-23')
      expect(subtractWorkingDays('2026-12-07', 5, holidays)).toBe('2026-11-30')
      expect(addWorkingDays('2026-12-07', -5, holidays)).toBe('2026-11-30')
    })
  })

  describe('statutoryDueDate', () => {
    it('shifts a Saturday deadline to Monday (art. 57 §4)', () => {
      const result = statutoryDueDate('2026-11-07')
      expect(result.due).toBe('2026-11-23')
      expect(result.shiftedFrom).toBe('2026-11-21')
      expect(result.explanation).toBe('07.11.2026 + 14 dni = 21.11.2026 (sobota) → 23.11.2026 (poniedziałek)')
    })

    it('skips the Christmas holiday chain', () => {
      const result = statutoryDueDate('2026-12-10', 'calendar')
      expect(result.due).toBe('2026-12-28')
      expect(result.shiftedFrom).toBe('2026-12-24')
    })

    it('keeps a working-day deadline unchanged', () => {
      const result = statutoryDueDate('2026-11-23')
      expect(result.due).toBe('2026-12-07')
      expect(result.shiftedFrom).toBeNull()
      expect(result.explanation).toBe('23.11.2026 + 14 dni = 07.12.2026 (poniedziałek)')
    })

    it('counts working days in working mode', () => {
      const result = statutoryDueDate('2026-11-23', 'working')
      expect(result.due).toBe('2026-12-11')
      expect(result.shiftedFrom).toBeNull()
      expect(result.explanation).toBe('23.11.2026 + 14 dni roboczych = 11.12.2026 (piątek)')
    })

    it('honours extra holidays', () => {
      const result = statutoryDueDate('2026-11-23', 'calendar', ['2026-12-07'])
      expect(result.due).toBe('2026-12-08')
      expect(result.shiftedFrom).toBe('2026-12-07')
    })
  })

  describe('maxExtensionDate', () => {
    it('shifts an extension landing on Saturday', () => {
      expect(maxExtensionDate('2026-11-23')).toEqual({ due: '2027-01-25', shiftedFrom: '2027-01-23' })
    })

    it('keeps an extension landing on a working day', () => {
      expect(maxExtensionDate('2026-11-05')).toEqual({ due: '2027-01-05', shiftedFrom: null })
    })
  })

  describe('internalDueDate', () => {
    it('subtracts working days from the current due date', () => {
      expect(internalDueDate('2026-12-07', 5)).toBe('2026-11-30')
      expect(internalDueDate('2027-01-07', 2)).toBe('2027-01-04')
    })
  })

  describe('clarificationDueDate', () => {
    it('adds calendar days and shifts to a working day', () => {
      expect(clarificationDueDate('2026-11-23', 7)).toEqual({ due: '2026-11-30', shiftedFrom: null })
      expect(clarificationDueDate('2026-11-24', 7)).toEqual({ due: '2026-12-01', shiftedFrom: null })
      expect(clarificationDueDate('2026-11-14', 7)).toEqual({ due: '2026-11-23', shiftedFrom: '2026-11-21' })
    })
  })

  describe('daysRemaining and deadlineTone', () => {
    it('counts calendar days, negative when overdue', () => {
      expect(daysRemaining('2026-11-21', '2026-11-23')).toBe(2)
      expect(daysRemaining('2026-11-21', '2026-11-21')).toBe(0)
      expect(daysRemaining('2026-11-21', '2026-11-18')).toBe(-3)
      expect(daysRemaining('2026-12-31', '2027-01-01')).toBe(1)
    })

    it('derives the tone from status and due date', () => {
      const today = '2026-11-21'
      expect(deadlineTone(today, { status: 'sent', currentDueDate: '2026-11-01' })).toBe('done')
      expect(deadlineTone(today, { status: 'left_unprocessed', currentDueDate: null })).toBe('done')
      expect(deadlineTone(today, { status: 'awaiting_clarification', currentDueDate: '2026-11-01' })).toBe('paused')
      expect(deadlineTone(today, { status: 'new', currentDueDate: null })).toBe('normal')
      expect(deadlineTone(today, { status: 'new', currentDueDate: '2026-11-20' })).toBe('overdue')
      expect(deadlineTone(today, { status: 'new', currentDueDate: '2026-11-21' })).toBe('today')
      expect(deadlineTone(today, { status: 'in_preparation', currentDueDate: '2026-11-22' })).toBe('tomorrow')
      expect(deadlineTone(today, { status: 'new', currentDueDate: '2026-11-25' })).toBe('normal')
    })
  })

  describe('formatting', () => {
    it('formats dates in the Polish DD.MM.YYYY style', () => {
      expect(formatPlDate('2026-01-05')).toBe('05.01.2026')
    })

    it('returns today in UTC', () => {
      expect(todayIso(new Date('2026-11-21T23:30:00.000Z'))).toBe('2026-11-21')
      expect(todayIso(new Date('2026-11-21T00:10:00.000+02:00'))).toBe('2026-11-20')
    })
  })
})
