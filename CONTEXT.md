# Paper Reader

Paper Reader is a single-owner academic reading system. One owner pairs trusted devices to a private server and reads, translates, searches, annotates, and reviews papers across those devices.

## Language

**Owner**:
The one person whose papers, vocabulary, reading history, model settings, and paired devices belong to this installation.
_Avoid_: User, tenant, account

**Paired Device**:
A trusted client installation holding a revocable device token issued by the owner's server.
_Avoid_: User session, login

**Paper**:
An uploaded academic PDF together with its metadata and processing state.
_Avoid_: Document, file

**Paper Ingestion**:
The durable workflow that validates a Paper, parses it through a parser Adapter, persists reading blocks, and prepares retrieval data.
_Avoid_: PDF processing, upload handler

**Reading Block**:
An ordered piece of a Paper shown in reflow mode, such as text, a formula, a table, or an image.
_Avoid_: Paragraph when the content may be non-text

**Paper Snapshot**:
An atomic offline copy of a Paper's reading blocks, translations, and assets at one content version.
_Avoid_: Cache dump, download

**Review Event**:
An idempotent record of one vocabulary review result that may be created offline and synchronized later.
_Avoid_: Review request

**Retrieval Query**:
One normalized and optionally expanded representation of a question, reused across full-text and semantic retrieval.
_Avoid_: Per-paper query

## Flagged ambiguities

- Historical code uses “user” for both username accounts and devices. The product model is single-owner: authentication identifies a Paired Device, while all domain data belongs to the Owner.
- Historical code uses “paragraph” for reading progress even when the stream contains formulas and images. Reading Block is the general term.

## Example dialogue

> Developer: When the Owner asks a global question, do we create one Retrieval Query per Paper?
>
> Domain expert: No. Create one Retrieval Query, rank Reading Blocks across all ready Papers, and return citations grouped by Paper.
>
> Developer: What happens when a Paired Device reviews a word offline?
>
> Domain expert: It records a Review Event locally and synchronizes it idempotently when connectivity returns.
