# EV Analytics PWA — Änderungen vor der Migration

## Ziel dieses Dokuments

Dieses Dokument beschreibt die technischen Änderungen, die **vor der einmaligen Migration der bestehenden Apple-Numbers-Daten** umgesetzt werden müssen. Zielgruppe ist ein Coding Agent, der die Änderungen im bestehenden React/TypeScript/Dexie/Supabase-Projekt implementieren soll.

Die Migration soll nicht einfach historische Daten in das heutige Modell pressen. Stattdessen soll das Datenmodell zuerst so erweitert werden, dass die realen historischen Fälle korrekt abgebildet werden können:

- Normale Tarife mit AC- und DC-Preis.
- Roaming-Preise innerhalb eines Tarifs, z. B. EWE Go Partnerpreise als Roaming des EWE-Go-Tarifs.
- Subscription-Tarife mit monatlicher Grundgebühr, z. B. EnBW L.
- Einmalige/fixe Tarifkosten, z. B. SWM-Ladekarten-Gebühr und EnBW-Monatsgebühr.
- Ad-hoc-Kreditkartenzahlungen an einer Ladesäule, z. B. Eliso.
- Historische Sessions ohne SoC-Angaben.

Die App bleibt weiterhin eine offline-first PWA. Normale App-Schreibvorgänge müssen weiterhin zuerst lokal in Dexie passieren und danach über die Sync-Outbox nach Supabase synchronisiert werden. Die **einmalige Migration selbst** wird später direkt nach Supabase importieren und anschließend per Initial Sync in Dexie hydratisiert.

## Bestehender Projektkontext

Stack:

- React 19
- TypeScript
- Vite
- Dexie / IndexedDB
- Supabase / PostgreSQL
- Vitest, React Testing Library, MSW

Bestehende Architekturregeln:

- Dateneingabe muss offline immer funktionieren.
- Normale lokale Writes gehen nach Dexie und erzeugen Sync-Outbox-Einträge.
- Die Sync-Outbox replayed später nach Supabase.
- Geldbeträge werden als Integer-Cents gespeichert.
- Datumswerte sollen UTC-sicher gespeichert werden.
- Tarifwerte müssen auf Sessions gesnapshottet werden, damit historische Korrektheit erhalten bleibt.
- Supabase ist privat/single-user mit default-deny RLS.

Aktuelle relevante Dateien laut Projektkontext:

- `src/infra/db/db.ts`
- `src/features/tariffs/services/tariffService.ts`
- `src/features/tariffs/services/providerService.ts`
- `src/features/charging-sessions/services/sessionService.ts`
- `src/features/offline-sync/services/syncEngine.ts`
- `IMPLEMENTATION_PLAN.md`

## Aktuelles Zielmodell nach Anpassung

### Provider

Provider bleiben im Wesentlichen unverändert.

```ts
type Provider = {
  id: string;
  user_id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
};
```

### Tariff

Tarife sollen künftig pro Provider weiterhin erstmal **ein aktiver Tarif** sein. Mehrere parallele Tarife pro Provider sind ein späteres Backlog-Feature.

Wichtig: Ein Tarif kann mehrere Preisarten enthalten:

- Standard-AC-Preis
- Standard-DC-Preis
- Roaming-AC-Preis
- Roaming-DC-Preis
- Session Fee
- Monatliche Grundgebühr
- Tarifart: Standard, Subscription oder Ad-hoc

Vorgeschlagener TypeScript-Typ:

```ts
type TariffKind = 'standard' | 'subscription' | 'ad_hoc';

type Tariff = {
  id: string;
  user_id: string;
  provider_id: string;
  tariff_name: string;

  tariff_kind: TariffKind;

  ac_price_per_kwh?: number;
  dc_price_per_kwh?: number;

  roaming_ac_price_per_kwh?: number;
  roaming_dc_price_per_kwh?: number;

  session_fee: number;
  monthly_base_fee?: number;

  valid_from: Date;
  valid_to?: Date;

  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
};
```

### Wichtige Modellierungsentscheidung zu optionalen Preisen

AC/DC-Preise und Roaming-Preise sollen optional beziehungsweise nullable sein. `0` darf nur bedeuten: wirklich kostenlos. Es darf nicht verwendet werden, um „nicht vorhanden“, „nicht anwendbar“ oder „unbekannt“ auszudrücken.

Beispiele:

```ts
// DC-only Tarif
ac_price_per_kwh: undefined;
dc_price_per_kwh: 49;

// kostenloser AC-Tarif, falls wirklich kostenlos
ac_price_per_kwh: 0;
dc_price_per_kwh: undefined;
```

In Supabase sollten diese Felder daher nullable Integer-Spalten sein.

### ChargingSession

Sessions sollen weiterhin die jeweils angewendeten Tarifwerte snapshotten. Das ist keine neue Produktidee, sondern die vorhandene historische Korrektheitsregel. Neu ist, dass der Snapshot um Roaming-, Subscription- und Ad-hoc-Kontext erweitert wird.

Vorgeschlagener TypeScript-Typ:

```ts
type TariffKind = 'standard' | 'subscription' | 'ad_hoc';
type PricingContext = 'standard' | 'roaming' | 'ad_hoc';

type ChargingSession = {
  id: string;
  user_id: string;

  session_timestamp: Date;

  provider_id: string;
  provider_name: string;

  tariff_id: string;
  tariff_name: string;

  location_type: 'Home' | 'Work' | 'Public' | 'Fast Charger';
  charging_type: 'AC' | 'DC';

  pricing_context: PricingContext;

  kwh_billed: number;
  kwh_added?: number;
  total_cost: number;

  odometer_km?: number;

  start_soc_percentage?: number;
  end_soc_percentage?: number;

  notes?: string;

  applied_price_per_kwh: number;

  applied_ac_price_per_kwh?: number;
  applied_dc_price_per_kwh?: number;
  applied_roaming_ac_price_per_kwh?: number;
  applied_roaming_dc_price_per_kwh?: number;

  applied_session_fee: number;
  applied_monthly_base_fee?: number;
  applied_tariff_kind: TariffKind;

  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
};
```

### Wichtige Modellierungsentscheidung zu SoC

`start_soc_percentage` und `end_soc_percentage` müssen optional werden.

Begründung:

- Die historische Numbers-Datei enthält keine SoC-Daten.
- Historische Werte dürfen nicht künstlich mit `0` oder einem Sentinel gefüllt werden.
- Analytics und UI müssen unbekannte SoC-Werte korrekt behandeln.

Akzeptanzkriterien:

- Neue Sessions können weiterhin SoC enthalten.
- Historische importierte Sessions können SoC leer lassen.
- UI und Analytics zeigen bei fehlendem SoC nicht fälschlich `0 %` an.
- Validierungen erlauben fehlende SoC-Werte.

### FixedTariffCost

Für Kosten, die keine konkrete Ladesession sind, wird eine neue Entity benötigt.

Beispiele aus der historischen Datei:

- SWM Ladekarte: 10,00 EUR, keine kWh.
- EnBW L monatliche Subscription-Gebühr: 11,99 EUR, keine kWh.

Diese dürfen nicht als ChargingSession importiert werden, weil sie sonst kWh- und Preis-pro-kWh-Analytics verfälschen würden.

Vorgeschlagener TypeScript-Typ:

```ts
type FixedTariffCostType =
  | 'subscription'
  | 'card_fee'
  | 'activation_fee'
  | 'roaming_fee'
  | 'other';

type FixedTariffCost = {
  id: string;
  user_id: string;

  cost_date: Date;

  provider_id: string;
  provider_name: string;

  tariff_id?: string;
  tariff_name?: string;

  amount: number; // integer cents

  cost_type: FixedTariffCostType;

  notes?: string;

  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
};
```

## Supabase-Änderungen

### Tariffs-Tabelle erweitern

Bestehende Tabelle `tariffs` erweitern:

```sql
alter table tariffs
  add column if not exists tariff_kind text not null default 'standard',
  add column if not exists roaming_ac_price_per_kwh integer null,
  add column if not exists roaming_dc_price_per_kwh integer null,
  add column if not exists monthly_base_fee integer null;
```

Falls `ac_price_per_kwh` und `dc_price_per_kwh` aktuell `not null` sind, müssen sie nullable werden:

```sql
alter table tariffs
  alter column ac_price_per_kwh drop not null,
  alter column dc_price_per_kwh drop not null;
```

Empfohlene Check Constraints:

```sql
alter table tariffs
  add constraint tariffs_tariff_kind_check
  check (tariff_kind in ('standard', 'subscription', 'ad_hoc'));

alter table tariffs
  add constraint tariffs_non_negative_prices_check
  check (
    (ac_price_per_kwh is null or ac_price_per_kwh >= 0) and
    (dc_price_per_kwh is null or dc_price_per_kwh >= 0) and
    (roaming_ac_price_per_kwh is null or roaming_ac_price_per_kwh >= 0) and
    (roaming_dc_price_per_kwh is null or roaming_dc_price_per_kwh >= 0) and
    session_fee >= 0 and
    (monthly_base_fee is null or monthly_base_fee >= 0)
  );
```

Wichtig: Constraint-Namen prüfen, damit keine Duplikate entstehen, falls Migrationen mehrfach lokal ausgeführt werden.

### Sessions-Tabelle erweitern

Bestehende Tabelle `sessions` erweitern:

```sql
alter table sessions
  add column if not exists pricing_context text not null default 'standard',
  add column if not exists applied_price_per_kwh integer null,
  add column if not exists applied_ac_price_per_kwh integer null,
  add column if not exists applied_dc_price_per_kwh integer null,
  add column if not exists applied_roaming_ac_price_per_kwh integer null,
  add column if not exists applied_roaming_dc_price_per_kwh integer null,
  add column if not exists applied_monthly_base_fee integer null,
  add column if not exists applied_tariff_kind text not null default 'standard';
```

Falls bisherige Snapshot-Spalten so heißen:

```text
applied_ac_price
applied_dc_price
applied_session_fee
```

muss Codex entscheiden, ob sie umbenannt oder parallel weitergeführt werden.

Empfehlung:

- Für Klarheit langfristig auf `*_per_kwh` umbenennen.
- Falls der Code stark auf die alten Namen angewiesen ist, kann zunächst eine Übergangsphase mit beiden Namen genutzt werden.
- Zielzustand sollte klar dokumentiert sein.

SoC-Spalten nullable machen, falls sie `not null` sind:

```sql
alter table sessions
  alter column start_soc_percentage drop not null,
  alter column end_soc_percentage drop not null;
```

Check Constraints:

```sql
alter table sessions
  add constraint sessions_pricing_context_check
  check (pricing_context in ('standard', 'roaming', 'ad_hoc'));

alter table sessions
  add constraint sessions_applied_tariff_kind_check
  check (applied_tariff_kind in ('standard', 'subscription', 'ad_hoc'));

alter table sessions
  add constraint sessions_optional_soc_range_check
  check (
    (start_soc_percentage is null or (start_soc_percentage >= 0 and start_soc_percentage <= 100)) and
    (end_soc_percentage is null or (end_soc_percentage >= 0 and end_soc_percentage <= 100))
  );
```

### Neue Tabelle `fixed_tariff_costs`

```sql
create table if not exists fixed_tariff_costs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,

  cost_date timestamptz not null,

  provider_id uuid not null references providers(id),
  provider_name text not null,

  tariff_id uuid null references tariffs(id),
  tariff_name text null,

  amount integer not null,
  cost_type text not null,

  notes text null,

  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz null,

  constraint fixed_tariff_costs_amount_non_negative_check check (amount >= 0),
  constraint fixed_tariff_costs_cost_type_check check (
    cost_type in ('subscription', 'card_fee', 'activation_fee', 'roaming_fee', 'other')
  )
);
```

Empfohlene Indizes:

```sql
create index if not exists fixed_tariff_costs_user_cost_date_idx
  on fixed_tariff_costs(user_id, cost_date);

create index if not exists fixed_tariff_costs_provider_id_idx
  on fixed_tariff_costs(provider_id);

create index if not exists fixed_tariff_costs_tariff_id_idx
  on fixed_tariff_costs(tariff_id);

create index if not exists fixed_tariff_costs_deleted_at_idx
  on fixed_tariff_costs(deleted_at);
```

### RLS für `fixed_tariff_costs`

Default-deny beibehalten. Policies analog zu bestehenden privaten Tabellen.

Beispiel:

```sql
alter table fixed_tariff_costs enable row level security;

create policy "Users can select own fixed tariff costs"
  on fixed_tariff_costs for select
  using (auth.uid() = user_id);

create policy "Users can insert own fixed tariff costs"
  on fixed_tariff_costs for insert
  with check (auth.uid() = user_id);

create policy "Users can update own fixed tariff costs"
  on fixed_tariff_costs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own fixed tariff costs"
  on fixed_tariff_costs for delete
  using (auth.uid() = user_id);
```

Falls das Projekt bewusst Soft Delete verwendet, prüfen, ob echte Deletes überhaupt genutzt werden oder ob DELETE-Policies entfallen können.

## Dexie-Änderungen

In `src/infra/db/db.ts`:

1. Dexie-Version erhöhen.
2. `tariffs` Schema um neue Felder erweitern.
3. `sessions` Schema um neue Felder erweitern.
4. Neue Tabelle `fixed_tariff_costs` hinzufügen.
5. `syncOutbox.table_name` um `fixed_tariff_costs` erweitern.

Beispielhafte Store-Indizes, je nach bestehender Dexie-Syntax anpassen:

```ts
this.version(nextVersion).stores({
  providers: 'id, user_id, name, deleted_at',
  tariffs: 'id, user_id, provider_id, tariff_name, tariff_kind, valid_from, valid_to, deleted_at',
  sessions: 'id, user_id, session_timestamp, provider_id, tariff_id, pricing_context, charging_type, deleted_at',
  fixed_tariff_costs: 'id, user_id, cost_date, provider_id, tariff_id, cost_type, deleted_at',
  syncOutbox: '++id, table_name, action, timestamp, next_attempt_at'
});
```

Migration bestehender lokaler Daten:

- Existierende Tarife erhalten `tariff_kind = 'standard'`.
- Existierende Sessions erhalten `pricing_context = 'standard'` und `applied_tariff_kind = 'standard'`.
- Falls alte Snapshot-Spalten vorhanden sind, Werte in neue Snapshot-Spalten kopieren.
- Falls `applied_price_per_kwh` aus bestehender Session berechnet werden kann, anhand `charging_type` und bestehendem applied AC/DC-Wert setzen.

Pseudocode:

```ts
await db.transaction('rw', db.tariffs, db.sessions, async () => {
  await db.tariffs.toCollection().modify((tariff) => {
    tariff.tariff_kind ??= 'standard';
  });

  await db.sessions.toCollection().modify((session) => {
    session.pricing_context ??= 'standard';
    session.applied_tariff_kind ??= 'standard';

    if (session.applied_price_per_kwh == null) {
      if (session.charging_type === 'AC') {
        session.applied_price_per_kwh = session.applied_ac_price_per_kwh ?? session.applied_ac_price;
      }
      if (session.charging_type === 'DC') {
        session.applied_price_per_kwh = session.applied_dc_price_per_kwh ?? session.applied_dc_price;
      }
    }
  });
});
```

Codex muss die tatsächlichen alten Feldnamen im Repo prüfen.

## Sync-Outbox und Sync Engine

### SyncOutbox Type erweitern

Aktuell:

```ts
table_name: 'providers' | 'tariffs' | 'sessions'
```

Ziel:

```ts
table_name: 'providers' | 'tariffs' | 'sessions' | 'fixed_tariff_costs'
```

### Sync Engine erweitern

`src/features/offline-sync/services/syncEngine.ts` muss `fixed_tariff_costs` unterstützen:

- INSERT
- UPDATE
- DELETE beziehungsweise Soft Delete
- Retry-Metadaten unverändert
- älteste Outbox-Einträge zuerst
- idempotentes Verhalten analog zu bestehenden Tabellen

Akzeptanzkriterien:

- Lokales Erstellen eines FixedTariffCost erzeugt Outbox-Eintrag.
- Sync replayed den Eintrag nach Supabase.
- Wiederholte Replay-Versuche sind idempotent oder sicher.
- Fehler werden wie bei anderen Tabellen in `last_error`, `retry_count`, `last_attempt_at`, `next_attempt_at` dokumentiert.

## Services

### Tariff Service

`tariffService.ts` muss neue Felder unterstützen:

- `tariff_kind`
- `roaming_ac_price_per_kwh`
- `roaming_dc_price_per_kwh`
- `monthly_base_fee`
- optionale Standard-AC/DC-Preise

Validierung:

- `tariff_kind` muss einer der erlaubten Werte sein.
- Geldwerte sind Integer-Cents.
- Preise und Gebühren dürfen nicht negativ sein.
- Mindestens eine sinnvolle Preis-/Gebühreninformation sollte vorhanden sein:
  - Standardpreis AC oder DC
  - Roamingpreis AC oder DC
  - monatliche Grundgebühr
  - Session Fee
- `ad_hoc`-Tarife dürfen normale Preise haben, müssen aber nicht zwingend vollständig sein.

### Session Service

`sessionService.ts` muss beim Anlegen/Aktualisieren einer Session den passenden Preis snapshotten.

Inputs, die eine Session braucht:

- `tariff_id`
- `charging_type`: AC oder DC
- `pricing_context`: standard, roaming oder ad_hoc
- `kwh_billed`
- optional manuell überschreibbarer `total_cost`, falls historische Importdaten oder Sonderfälle existieren

Preislogik:

```ts
function resolveAppliedPricePerKwh(tariff: Tariff, chargingType: ChargingType, pricingContext: PricingContext): number {
  if (pricingContext === 'roaming') {
    if (chargingType === 'AC' && tariff.roaming_ac_price_per_kwh != null) return tariff.roaming_ac_price_per_kwh;
    if (chargingType === 'DC' && tariff.roaming_dc_price_per_kwh != null) return tariff.roaming_dc_price_per_kwh;
    throw new Error('Selected roaming pricing but tariff has no matching roaming price');
  }

  if (pricingContext === 'standard' || pricingContext === 'ad_hoc') {
    if (chargingType === 'AC' && tariff.ac_price_per_kwh != null) return tariff.ac_price_per_kwh;
    if (chargingType === 'DC' && tariff.dc_price_per_kwh != null) return tariff.dc_price_per_kwh;
    throw new Error('Tariff has no matching standard/ad-hoc price');
  }

  throw new Error('Unsupported pricing context');
}
```

Snapshot-Felder beim Speichern:

```ts
session.applied_price_per_kwh = resolvedPrice;
session.applied_ac_price_per_kwh = tariff.ac_price_per_kwh;
session.applied_dc_price_per_kwh = tariff.dc_price_per_kwh;
session.applied_roaming_ac_price_per_kwh = tariff.roaming_ac_price_per_kwh;
session.applied_roaming_dc_price_per_kwh = tariff.roaming_dc_price_per_kwh;
session.applied_session_fee = tariff.session_fee;
session.applied_monthly_base_fee = tariff.monthly_base_fee;
session.applied_tariff_kind = tariff.tariff_kind;
```

Berechnung von `total_cost`:

- Für normale UI-Eingabe kann `total_cost` aus `kwh_billed * applied_price_per_kwh + applied_session_fee` berechnet werden.
- Bei der Migration wird `total_cost` aus der Quelle übernommen und gerundet. Dadurch bleiben historische Rundungen aus Numbers erhalten.
- Die Migration soll trotzdem den angewendeten Preis snapshotten.

Wichtig: Monatliche Grundgebühr wird **nicht** in jede Session eingerechnet. Sie wird separat als `FixedTariffCost` gespeichert.

### Neuer FixedTariffCost Service

Neuen Service anlegen, z. B.:

```text
src/features/tariffs/services/fixedTariffCostService.ts
```

Funktionen:

- `createFixedTariffCost(input)`
- `updateFixedTariffCost(id, patch)`
- `softDeleteFixedTariffCost(id)`
- optional `listFixedTariffCostsByDateRange(start, end)`

Der Service soll analog zu bestehenden Services:

- lokal in Dexie schreiben
- transaktional Outbox-Eintrag erzeugen
- Soft Delete unterstützen
- Validierung durchführen

## UI-Minimum vor Migration

Da die Migration direkt nach Supabase läuft, ist keine Import-UI nötig. Trotzdem sollte die App die neuen Daten zumindest korrekt lesen und anzeigen können.

Minimal erforderlich:

### Tariff UI

- Standard-AC-Preis anzeigen/bearbeiten.
- Standard-DC-Preis anzeigen/bearbeiten.
- Optional Roaming-AC-Preis anzeigen/bearbeiten.
- Optional Roaming-DC-Preis anzeigen/bearbeiten.
- Tarifart anzeigen/bearbeiten: Standard, Subscription, Ad-hoc.
- Monatliche Grundgebühr anzeigen/bearbeiten, mindestens für Subscription-Tarife.

### Session UI

- SoC-Felder optional machen.
- Pricing Context anzeigen/bearbeiten: Standard, Roaming, Ad-hoc.
- Bei Auswahl eines Tarifs und Pricing Context den passenden Preis verwenden.
- Bei fehlendem SoC nicht `0 %` anzeigen.
- Snapshot-Felder müssen nicht prominent editierbar sein, aber für Debug/Details hilfreich sein.

### Fixed Costs UI

Minimalvariante:

- Liste fixer Tarifkosten anzeigen.
- Betrag, Datum, Provider, Tarif, Typ, Notizen anzeigen.
- Optional später Bearbeiten/Erstellen.

Wenn keine UI für Fixed Costs vor Migration gebaut wird, muss zumindest sichergestellt sein, dass die Daten in Analytics und Sync nicht kaputtgehen. Besser ist eine einfache Read-only-Ansicht.

## Analytics-Auswirkungen

Analytics müssen künftig unterscheiden:

1. Ladesession-Kosten:
   - Summe aus `charging_sessions.total_cost`.
2. Fixe Tarifkosten:
   - Summe aus `fixed_tariff_costs.amount`.
3. Gesamte ladekostenbezogene Kosten:
   - Sessions + fixe Tarifkosten.
4. Preis pro kWh:
   - Für reine Energie-/Session-Analytics nur Sessions verwenden.
   - Fixe Kosten nicht ungefiltert in €/kWh einrechnen, sonst werden Zero-kWh-Gebühren falsch verteilt.

Für die Migration genügt, dass bestehende Analytics nicht crashen. Falls Dashboard noch nicht fertig ist, sollen spätere Dashboard-Queries diese Trennung von Anfang an berücksichtigen.

## Tests

Mindestens folgende Tests ergänzen oder anpassen:

### Unit Tests

- Tariff Validierung erlaubt optionale Preise.
- Tariff Validierung verhindert negative Preise/Gebühren.
- Session Service setzt `pricing_context` korrekt.
- Session Service löst Standard-AC/DC-Preise korrekt auf.
- Session Service löst Roaming-AC/DC-Preise korrekt auf.
- Session Service wirft Fehler, wenn Roaming gewählt ist, aber kein passender Roamingpreis existiert.
- Session Service erlaubt fehlenden SoC.
- FixedTariffCost Service validiert Betrag und Typ.

### Dexie Tests

- Schema-Version-Migration setzt Defaults für bestehende Tarife/Sessions.
- Neue Tabelle `fixed_tariff_costs` kann geschrieben/gelesen werden.
- Outbox unterstützt `fixed_tariff_costs`.

### Sync Tests

- `fixed_tariff_costs` INSERT wird nach Supabase replayed.
- UPDATE und DELETE/Soft Delete funktionieren analog zu bestehenden Tabellen.
- Retry-Metadaten funktionieren weiter.

### Regression Tests

- Bestehende Provider/Tariff/Session-Flows funktionieren weiter.
- Bestehende Outbox-Tests bleiben grün.

## Akzeptanzkriterien für dieses Arbeitspaket

Dieses Arbeitspaket ist abgeschlossen, wenn:

- Supabase-Schema unterstützt neue Tariffelder und `fixed_tariff_costs`.
- Dexie-Schema unterstützt neue Tariffelder und `fixed_tariff_costs`.
- TypeScript-Typen sind aktualisiert.
- SoC ist optional.
- Session Snapshot unterstützt Standard, Roaming und Ad-hoc.
- Subscription-Tarife können monatliche Grundgebühr speichern.
- FixedTariffCost kann lokal erstellt und synchronisiert werden.
- Bestehende App-Flows funktionieren weiterhin.
- Tests für neue Modelllogik und Sync sind vorhanden.
- Keine Import-UI wurde gebaut, da die Migration ein einmaliges Script wird.

## Offene Fragen für Codex / mit Matt zu klären

1. **Feldnamen für Snapshot-Spalten**  
   Sollen bestehende Felder `applied_ac_price` und `applied_dc_price` umbenannt werden zu `applied_ac_price_per_kwh` und `applied_dc_price_per_kwh`, oder sollen die alten Namen erhalten bleiben?

2. **Provider für Arbeit/VW**  
   In der Numbers-Datei gibt es `VW` als Anbieter und `AC: Arbeit` als Tarif. Soll der App-Provider `VW`, `Arbeit` oder etwas anderes heißen?

3. **UI-Tiefe vor Migration**  
   Reicht eine minimale Read-only-Anzeige für `fixed_tariff_costs`, oder soll direkt Erstellen/Bearbeiten möglich sein?

4. **Supabase User ID für Import**  
   Die Migration braucht eine konkrete `user_id`. Codex soll prüfen, wie diese im Projekt für Seed-/Admin-Skripte bereitgestellt wird.

5. **Soft Delete vs Hard Delete**  
   Bestehendes Modell hat `deleted_at`. Soll `fixed_tariff_costs` ausschließlich Soft Delete nutzen?

6. **Check Constraints in bestehenden Migrationen**  
   Codex muss prüfen, welche Constraints bereits existieren, um doppelte Constraint-Namen oder inkompatible Migrationen zu vermeiden.
