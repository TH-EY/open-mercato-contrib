"use client"
import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { getJson } from './api'
import { SimilarMatchCard } from './CreateRequestWizard'

type Result = { matches: Parameters<typeof SimilarMatchCard>[0]['match'][]; searched: number }

export default function ArchiveSearch() {
  const t = useT()
  const [query, setQuery] = React.useState('')
  const [result, setResult] = React.useState<Result | null>(null)
  const [loading, setLoading] = React.useState(false)

  const [browsing, setBrowsing] = React.useState(true)

  const load = React.useCallback(async (text: string) => {
    setLoading(true)
    try {
      const path = text.length >= 2 ? `/archive?text=${encodeURIComponent(text)}` : '/archive?limit=100'
      setResult(await getJson<Result>(path))
      setBrowsing(text.length < 2)
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load('')
  }, [load])

  const search = async () => {
    await load(query.trim())
  }

  return (
    <div className="space-y-4" data-testid="udip-archive">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{t('public_info_requests.archive.title', 'Answer archive')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('public_info_requests.archive.subtitle', 'Anonymised past requests and answers — search by meaning, not exact words.')}</p>
      </div>
      <div className="flex gap-2">
        <div className="flex-1" onKeyDown={(event) => { if (event.key === 'Enter') void search() }}>
          <SearchInput value={query} onChange={setQuery} placeholder={t('public_info_requests.archive.placeholder', 'e.g. number of foreign pupils in primary schools')} />
        </div>
        <Button type="button" onClick={() => { void search() }}>{t('public_info_requests.archive.search', 'Search')}</Button>
      </div>
      {loading ? <LoadingMessage label={t('public_info_requests.common.loading', 'Loading…')} /> : null}
      {result ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {browsing
              ? t('public_info_requests.archive.all', 'All archived cases ({count}), newest first', { count: result.searched })
              : t('public_info_requests.archive.count', '{count} results in {searched} archived cases', { count: result.matches.length, searched: result.searched })}
          </p>
          {result.matches.map((match) => (
            <Link key={match.requestId} href={`/backend/public_info_requests/${match.requestId}`} className="block">
              <SimilarMatchCard match={match} />
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  )
}
