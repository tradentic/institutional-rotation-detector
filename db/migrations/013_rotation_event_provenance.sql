-- Add rotation_event_provenance table to track all contributing accessions
-- and their roles in a rotation event

create table if not exists rotation_event_provenance (
  cluster_id uuid references rotation_events(cluster_id) on delete cascade,
  accession text references filings(accession),
  role text check (role in ('anchor', 'seller', 'buyer', 'uhf', 'context')) not null,
  entity_id uuid references entities,
  contribution_weight numeric default 0,
  primary key (cluster_id, accession, role)
);

create index if not exists idx_provenance_cluster on rotation_event_provenance(cluster_id);
create index if not exists idx_provenance_accession on rotation_event_provenance(accession);
create index if not exists idx_provenance_entity on rotation_event_provenance(entity_id);
