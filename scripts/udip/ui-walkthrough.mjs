#!/usr/bin/env node
// Drives the UDIP request desk UI through the jury walkthrough and saves screenshots.
// Usage: UDIP_BASE_URL=http://localhost:3210 UDIP_EMAIL=... UDIP_PASSWORD=... node scripts/udip/ui-walkthrough.mjs "<samples dir>" "<screenshot dir>"
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? 'playwright')

const baseUrl = process.env.UDIP_BASE_URL ?? 'http://localhost:3210'
const samplesDir = process.argv[2]
const shotsDir = process.argv[3] ?? 'udip-shots'
const sample = process.env.UDIP_SAMPLE ?? 'Wniosek - BKS.IV.1431.599.2026.docx'
const reply = process.env.UDIP_REPLY ?? ''

async function main() {
  await mkdir(shotsDir, { recursive: true })
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'pl-PL' })
  await context.addCookies([{ name: 'locale', value: 'pl', url: baseUrl }])
  await context.addInitScript(() => {
    const style = document.createElement('style')
    style.textContent = '.z-banner{display:none !important}'
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style))
  })
  const page = await context.newPage()
  page.setDefaultNavigationTimeout(240000)
  page.setDefaultTimeout(120000)
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  const shot = async (name) => {
    await page.waitForTimeout(800)
    await page.screenshot({ path: path.join(shotsDir, `${name}.png`), fullPage: true })
    console.log('shot', name)
  }

  await page.goto(`${baseUrl}/login`)
  await page.fill('input[name="email"]', process.env.UDIP_EMAIL)
  await page.fill('input[name="password"]', process.env.UDIP_PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/backend/, { timeout: 60000 })

  await page.goto(`${baseUrl}/backend/public_info_requests`)
  await page.waitForSelector('[data-testid="udip-calendar"] table', { timeout: 120000 })
  const cookies = page.getByRole('button', { name: /Zaakceptuj pliki cookie|Accept cookies/ })
  if (await cookies.count()) await cookies.first().click().catch(() => null)
  await shot('01-calendar-list')
  await page.getByRole('radio', { name: /Miesiąc|Month/ }).click()
  await page.waitForTimeout(1500)
  await shot('02-calendar-month')

  await page.goto(`${baseUrl}/backend/public_info_requests/create`)
  await page.waitForSelector('[data-testid="udip-create"]', { timeout: 120000 })
  const fileInput = page.locator('input[type="file"]').first()
  await fileInput.setInputFiles(path.join(samplesDir, sample))
  await page.waitForFunction(() => {
    const textarea = document.querySelector('#udip-text')
    return textarea && textarea.value.length > 20
  }, null, { timeout: 120000 }).catch(() => null)
  await shot('03-intake-ocr')
  await page.getByRole('button', { name: /Dalej: dane i termin|Next: data/ }).click()
  await page.waitForSelector('[data-testid="udip-deadline-preview"]', { timeout: 60000 })
  if (!(await page.inputValue('#udip-requester'))) await page.fill('#udip-requester', 'Wnioskodawca testowy')
  await shot('04-request-data')
  await page.getByRole('button', { name: /Zarejestruj i sprawdź podobne|Register and check/ }).click()
  await page.waitForSelector('text=/Przeszukano|Searched/', { timeout: 60000 })
  await shot('05-similar')
  await page.getByRole('button', { name: /Dalej: propozycja ścieżki|Next: routing/ }).click()
  await page.waitForSelector('[data-testid="udip-routing"]', { timeout: 120000 })
  await shot('06-routing')
  await page.getByRole('button', { name: /Akceptuj i przygotuj notatki|Accept and prepare/ }).click()
  await page.waitForSelector('[data-testid="udip-routing-notes"]', { timeout: 60000 })
  await shot('07-notes')
  await page.getByRole('button', { name: /Oznacz notatki jako wysłane|Mark notes as sent/ }).click()
  await page.waitForTimeout(1500)

  if (reply) {
    await page.getByRole('tab', { name: /Odpowiedzi wydziałów|Department replies/ }).click()
    await page.getByRole('button', { name: /Wgraj odpowiedź|Upload reply/ }).first().click()
    await page.locator('[role="dialog"] input[type="file"]').setInputFiles(reply)
    await page.waitForSelector('[role="dialog"] >> text=/OCR|DOCX|PDF|tekst/', { timeout: 120000 })
    await shot('08-reply-upload')
    await page.getByRole('button', { name: /Zapisz odpowiedź|Save reply/ }).click()
    await page.waitForTimeout(1500)
  }

  await page.getByRole('tab', { name: /Projekt i anonimizacja|Draft and anonymisation/ }).click()
  await page.getByRole('button', { name: /Wygeneruj projekt|Generate draft/ }).click()
  await page.waitForSelector('[data-testid="udip-letter"]', { timeout: 120000 })
  await shot('09-draft')
  await page.getByRole('button', { name: /Wykryj dane osobowe|Detect personal data/ }).click()
  await page.waitForTimeout(2500)
  await shot('10-anonymisation')
  const accept = page.getByRole('button', { name: /Akceptuj wszystkie sugestie|Accept all suggestions/ })
  if (await accept.count()) {
    await accept.click()
    await page.waitForTimeout(3000)
    await shot('11-anonymisation-accepted')
  }
  await page.getByRole('tab', { name: /Historia|History/ }).click()
  await shot('12-history')

  await page.goto(`${baseUrl}/backend/public_info_requests/archive`)
  await page.fill('input[type="search"], [data-testid="udip-archive"] input', 'liczba uczniów cudzoziemców w szkołach')
  await page.getByRole('button', { name: /^Szukaj$|^Search$/ }).click()
  await page.waitForTimeout(2000)
  await shot('13-archive')
  await page.goto(`${baseUrl}/backend/public_info_requests/settings`)
  await page.waitForSelector('[data-testid="udip-settings"]', { timeout: 60000 })
  await shot('14-settings')

  console.log('page errors:', errors.length ? errors.join('\n') : 'none')
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
