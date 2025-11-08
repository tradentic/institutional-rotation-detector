alter table filings
  add column if not exists cadence text check (
    cadence is null
    or cadence in ('annual', 'semiannual', 'quarterly', 'monthly', 'event', 'adhoc')
  ),
  add column if not exists expected_publish_at timestamptz,
  add column if not exists published_at timestamptz,
  add column if not exists is_amendment boolean not null default false,
  add column if not exists amendment_of_accession text references filings(accession);

create index if not exists idx_filings_cadence on filings (cadence);
create index if not exists idx_filings_expected_publish_pending on filings (expected_publish_at)
  where published_at is null;
create index if not exists idx_filings_published_at on filings (published_at);
create index if not exists idx_filings_amendment_of_accession on filings (amendment_of_accession);
