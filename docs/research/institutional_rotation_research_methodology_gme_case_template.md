# Institutional Rotation Research Methodology

*A reusable, step‑by‑step process based on the GameStop (GME) case study, designed so you can repeat the same style of deep research for any company in your Institutional Rotation Detector stack.*

---
## 0. Objectives & Scope

**Goal:** Build an evidence‑based picture of **who rotated into and out of a stock**, **when**, and **how early** you could have known from public filings.

You want to:

1. Identify **entry, accumulation, distribution, and exit** by:
   - Activist investors
   - Large institutions (13D/13G filers)
   - Passive/index funds
   - Insiders (officers/directors)
2. Focus on **primary filings**, not news/speculation.
3. Record both:
   - **Transaction dates** (when trades happened, if disclosed), and
   - **Filing dates** (earliest date you could have known and acted).
4. End up with:
   - A **chronological rotation timeline** (table or structured data), and
   - A set of **design patterns** you can bake into your repo’s models.

---
## 1. Setup & Inputs

For each company, collect:

- **Ticker** (e.g., `GME`)
- **Company name** (e.g., `GameStop Corp.`)
- **CIK** (can be looked up on SEC EDGAR)
- **Investor Relations (IR) URL** (e.g., `https://investor.company.com/…`)

Create a simple workspace (could be a markdown file, notebook, or DB table) with these sections:

- `Company Overview`
- `Key Filers (Activists / Institutions / Insiders)`
- `Raw Filings (13D/13G/4/8‑K/DEF 14A/10‑K/10‑Q)`
- `Rotation Events Timeline`
- `Patterns & Insights`

This mirrors the structure used for the GME report.

---
## 2. Map the Investor Relations (IR) Site

**Objective:** Discover all the IR sub‑sections that might link to primary filings or summarize ownership.

1. Start at the **IR overview page**.
2. Enumerate and visit these common sections (names vary slightly per company):
   - `SEC Filings`
   - `Financials / Annual Reports`
   - `Quarterly Results / Earnings`
   - `Press Releases`
   - `Corporate Governance`
   - `Stock Information`
3. For each section, note any **direct EDGAR links** or PDF archives that matter for ownership / governance, e.g.:
   - Links to SEC **10‑K/10‑Q/8‑K** filings
   - Links to **proxy statements (DEF 14A)**
   - Any **“Ownership”** or **“Major shareholders”** summaries

> **Rule:** Treat IR pages as **navigation aids**; the **gold‑standard truth is always the SEC filing itself.**

---
## 3. Establish SEC EDGAR Baseline

**Objective:** Get a clean set of SEC filings to work from.

Using the ticker/CIK, query EDGAR for the company and focus on:

1. **Ownership & activism:**
   - **Schedule 13D** (active) and **13D/A** (amendments)
   - **Schedule 13G** (passive) and **13G/A**
2. **Insider activity:**
   - **Form 4** (insider buys/sells)
   - **Form 3** (initial insider holdings)
   - **Form 144** (planned insider sales)
3. **Governance & board changes:**
   - **8‑K** (especially Items 1.01, 5.02, 5.07)
   - **DEF 14A / DEFA14A / PREC14A** (proxy materials)
4. **Base financials & share counts:**
   - **10‑K / 10‑Q** (number of shares outstanding, share issuances, buybacks, etc.)

Create a raw index like:

```text
YYYY‑MM‑DD  Filing Type  Filer / Subject         Short note
2020‑04‑10  SC 13D       Scion Asset Mgmt       Crossed 5%, activist letter attached
2020‑05‑06  SC 13D/A     Scion Asset Mgmt       Reduced below 5% (exit as 5% owner)
2020‑12‑21  SC 13D/A     RC Ventures           Increased stake, activist language
...
```

This index is your **spine** for the rotation timeline.

---
## 4. Deep‑Dive on 13D / 13G (Big Holders)

**Objective:** Identify major **entries, accumulations, and exits** by external institutions.

For each **13D / 13D/A / 13G / 13G/A**:

1. Note **Filing Date**.
2. Extract key fields:
   - `Reporting Person` (filer name)
   - `Number of Shares` and `Percent of Class`
   - `Date of Event` (date of crossing threshold)
   - `Type of Filer`: activist (13D) vs passive (13G)
3. Read **Item 4 – Purpose of Transaction** (for 13D):
   - Are they intending to seek board seats, M&A, strategic changes?
   - Any explicit or implied activism?
4. Check **Item 6 – Contracts, Arrangements, Understandings**:
   - Any group agreements, voting arrangements, or derivatives?
5. Review **Exhibits**:
   - Activist letters
   - Cooperation agreements
   - Nomination notices

Create a structured record per filing, e.g.:

```text
Filing Type: SC 13D
Filing Date: 2020‑12‑21
Filer: RC Ventures, LLC (Ryan Cohen)
Event Date: 2020‑12‑16
Stake: 12.9%
Intent (Item 4): Engaging board, may take actions incl. board changes
Early Signal: Activist entry / escalation, board rotation likely
```

> **Heuristic:**
> - **First 13D** = *“Entry / Accumulation above 5%”*.
> - **13D/A increasing stake** = *“Further Accumulation / Stronger Conviction”*.
> - **13D/A stating they dropped below 5%** = *“Exit as reportable holder”*.
> - **Switch 13G → 13D** = *“Passive → Active (activist flip)”*.

---
## 5. Deep‑Dive on Insider Filings (Forms 3, 4, 144)

**Objective:** Track **insider accumulation vs distribution** and how quickly that’s visible.

For each **Form 4**:

1. Capture:
   - `Reporting Person` (insider name + title)
   - `Transaction Date`
   - `Filing Date`
   - `Transaction Type` (buy, sell, option exercise, RSU vesting, etc.)
   - `Shares Transacted` and `Price`
   - `Shares Owned After` transaction
2. Categorise:
   - **Open‑market buys** → insider **accumulation**
   - **Open‑market sells** → insider **distribution**
   - **Automatic sales on vesting / tax** → often neutral but still relevant for float
3. Note **patterns over time**:
   - Many insiders selling around same window?
   - Any insider buying into weakness?

For **Form 144**:

- Treat as **advance warning** of insider sales.
- Link each Form 144 to the later Form 4(s) where the actual sale is reported.

> **Heuristic:**
> - Repeated **net selling** by multiple insiders = strong distribution pattern.
> - Rare or zero insider buys during a hype phase = insiders not adding conviction.

---
## 6. Board & Governance Events (8‑K and Proxy)

**Objective:** Connect ownership shifts to **board rotation and control changes**.

### 6.1 8‑K Events

For each relevant **8‑K**:

- Check **Item 5.02** for:
  - Director appointments / resignations
  - CEO/CFO changes
- Check **Item 1.01** for:
  - Cooperation agreements with activists
  - Standstill agreements, board expansion deals
- Check **Item 5.07** for:
  - Voting results of annual/special meetings, especially where activists proposed nominees or resolutions.

Record these with dates and link them back to earlier 13D/13G events.

### 6.2 Proxy Statements (DEF 14A, etc.)

For each **annual proxy**:

1. Extract the **“Principal Stockholders”** table:
   - List each 5%+ holder, shares, and percent.
   - Note changes year‑over‑year (who vanished, who appeared, who grew/shrank).
2. Extract **beneficial ownership of directors/officers**:
   - See how insider holdings trend over years.
3. Read **board composition & changes**:
   - Which directors are new or retiring?
   - Any narrative about activist settlements or governance changes?
4. Note **disclosures about pledges, lockups, or unusual ownership structures**.

> **Heuristic:**
> - New 5% holders in proxy with no prior 13D/13G history may have sat just under 5% or used non‑reportable periods → silent accumulators.
> - Activists appearing one year and gone the next = rotation out.

---
## 7. Financials, Share Count & Issuance (10‑K / 10‑Q)

**Objective:** Understand **denominator changes** so percentage ownership moves make sense.

From each **10‑K / 10‑Q**:

- Note:
  - `Shares Outstanding` at period end
  - Significant **equity issuances** (ATMs, follow‑on offerings)
  - **Buybacks** and cancellations
- Correlate with 13D/13G changes:
  - If a holder’s **percent of class drops**, is it because they sold or because the company **issued more shares**?

> **Heuristic:**
> - Percentage drops with roughly constant share count for the holder = likely **selling**.
> - Percentage drops while company issues many new shares = **dilution**, not necessarily a bearish signal from that holder.

---
## 8. Build the Rotation Events Timeline

**Objective:** Convert raw filings into a **chronological, rotation‑focused timeline**.

For each company, build a table like:

```text
Date (Filing) | Filing Type | Filer / Actor       | Rotation Event                  | Earliest Actionable Insight
--------------|------------|---------------------|---------------------------------|-----------------------------
2020‑04‑10    | SC 13D     | Activist Fund X     | Entry: crosses 5%               | 13D filed – activist present
2020‑05‑06    | SC 13D/A   | Activist Fund X     | Exit: drops below 5%            | 13D/A – early distribution
2020‑12‑21    | SC 13D/A   | RC Ventures         | Accumulation: stake ↑ to 12.9%  | Activism escalates
2021‑01‑11    | 8‑K        | Company             | Board change: activist joins    | Confirmed control shift
...           | 4          | CFO                 | Insiders sell post‑rally        | Distribution by insiders
```

For each row, explicitly capture:

- **Filing date** (what you can trade/act on)
- **Event date** (when the actual transaction happened, if disclosed)
- **Event type** (Entry / Accumulation / Distribution / Exit / Governance Change)
- **Size/magnitude** (shares, % of class, qualitative significance)

---
## 9. Derive Patterns & Design Signals

**Objective:** Turn the timeline into **reusable detection rules** for your repo.

From the timeline, identify patterns such as:

- `first_13d_entry`: new activist crosses 5%.
- `activist_ups_stake`: 13D/A with material increase.
- `activist_exit`: 13D/A dropping below 5%.
- `insider_cluster_selling`: >N insiders selling within window T.
- `passive_index_growth`: large 13G filers (e.g. BLK/Vanguard) steadily increasing.
- `board_rotation_event`: activist gets board seats or leadership role (8‑K + proxy).
- `denominator_dilution`: company issues new shares; percentages change accordingly.

Document for each pattern:

- **How to detect from filings** (which forms, which fields)
- **Earliest detection time** (filing vs transaction date lag)
- **Interpretation** (what it says about rotation / smart money behavior)

These become the conceptual basis for your **Institutional Rotation Detector features and labels**.

---
## 10. Guardrails: No Fabrication & Source Discipline

To keep the methodology rigorous and reproducible:

1. **Never invent dates or positions.** If a filing doesn’t state it, mark as `unknown`.
2. **Prefer filing text over tertiary sources.** Headlines can inform where to look, but your truth comes from:
   - The actual SEC form
   - The company’s own filed exhibits and proxies
3. **Log missing or ambiguous data.** If a filer clearly exited but never filed a final 13D/A (because they drifted below 5% gradually), record:
   - The last date they were confirmed as >5%
   - The first proxy/13F where they no longer appear
   - Label the exact exit date as unknown.
4. **Always separate:**
   - `What the filing explicitly states`
   - `Your inference from comparing multiple filings`

This ensures your repo can later distinguish **hard facts** from **derived signals**.

---
## 11. Applying the Methodology to New Names

To reuse this process for any ticker in your Institutional Rotation Detector:

1. **Initial Setup**
   - Record `ticker`, `company`, `CIK`, `IR URL`.
2. **Crawl IR + EDGAR**
   - Map IR sections.
   - Pull raw SEC filing index (13D/G, 4, 8‑K, DEF 14A, 10‑K/10‑Q).
3. **Annotate Filings**
   - For each key filing, create a structured summary row (as above).
4. **Build Timeline**
   - Sort events by filing date and label each as entry/exit/accumulation/distribution/governance change.
5. **Pattern Extraction**
   - Identify recurring behaviors (activist cycles, insider selling regimes, passive growth, etc.).
6. **Feed into Repo Design**
   - Map patterns to model features / labels.
   - Use the same structure across names so you can compare rotation behaviors between companies.

Follow these steps and you’ll be able to replicate the same depth of analysis you used for the GME case study across your entire universe of stocks, in a way that is **consistent, evidence‑backed, and implementation‑ready** for the Institutional Rotation Detector.

