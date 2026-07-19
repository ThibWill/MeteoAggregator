# Plan — Observations réelles + fiabilité des prévisions

> Plan d'implémentation destiné à un agent. Lire `CLAUDE.md` d'abord :
> **pas de migrations Prisma** (`npm run db:reset` / `db:push`), commentaires minimaux.

## 1. Objectif

Deux features, dans cet ordre (B dépend de A) :

- **A. Connecteur d'observations réel** : remplacer `ObservationStubConnector`
  (`src/connectors/observation/stub.ts`) par un connecteur branché sur l'API
  Météo-France **Données Climatologiques** (DPClim), pour écrire des lignes
  `kind = OBSERVATION` dans `weather_measurement`.
- **B. Service de fiabilité** : comparer prévisions vs observations et produire
  des statistiques de fiabilité par **source × ville × plage horaire (time_range)
  × paramètre/catégorie**, sur 3 fenêtres glissantes : **7 jours, 30 jours, 365 jours**.

L'infrastructure existe déjà :
- `weather_measurement` a un discriminant `kind` (FORECAST/OBSERVATION) et une
  clé naturelle `(sourceId, kind, townId, targetDate, timeRangeId, referenceTime)`.
- La vue SQL `forecast_vs_observed` (`prisma/sql/forecast_vs_observed.sql`)
  joint déjà forecast et observation par (town, target_date, time_range).
- `dailyRun` (`src/tasks/dailyRun.ts`) appelle déjà `writeObservations(...)`,
  tolérant au stub vide.
- `aggregate()` et `categorize()` (`src/domain/`) sont réutilisables tels quels
  pour agréger les heures observées en fenêtres et les catégoriser.

## 2. L'API Données Climatologiques — ce qu'il faut savoir

Réfs : `doc/Données_Climatologiques_swagger.json` et
`doc/OpenDataMeteoFrance-🔎 API Données Climatologiques-*.pdf`.

- Base URL : `https://public-api.meteofrance.fr/public/DPClim/v1`
- Auth : header `apikey: <JWT>` (même portail que AROME).
  **⚠️ La clé actuelle du `.env` (`METEOFRANCE_API_KEY`) renvoie 403 sur DPClim :
  elle n'est souscrite qu'à AROME. Il faut souscrire l'API « Données
  Climatologiques » sur portail-api.meteofrance.fr.** Prévoir une variable
  d'env dédiée `METEOFRANCE_CLIM_API_KEY` (fallback sur `METEOFRANCE_API_KEY`
  si identique).
- **Archive qualifiée, pas de temps réel** : les données du jour J ne sont pas
  fiables/complètes le jour même → viser **J-1 et antérieur**.
- Workflow **asynchrone** en 3 temps :
  1. `GET /liste-stations/horaire?id-departement=NN` → stations du département
     (id 8 chiffres basé code INSEE, lat/lon, `posteOuvert`, types).
  2. `GET /commande-station/horaire?id-station=X&date-deb-periode=...&date-fin-periode=...`
     → HTTP 202, corps `{"elaboreProduitAvecDemandeResponse":{"return":"<id-cmde>"}}`.
     Dates ISO 8601 UTC (`...T00:00:00Z`). **Période max : 1 an glissant.**
     Délai d'élaboration typique horaire/quotidien : 1–5 s.
  3. `GET /commande/fichier?id-cmde=X` → **201** = CSV prêt (séparateur `;`),
     **204** = pas prêt, ré-essayer plus tard (attendre quelques secondes entre
     commande et téléchargement ; la commande est conservée plusieurs minutes).
- `GET /information-station?id-station=X` → métadonnées : périodes d'activité de
  chaque capteur/paramètre. Utile pour choisir une station qui mesure bien
  précipitations/température/vent/nébulosité sur la période visée.
- Erreurs à gérer :
  - 500 « production en échec (plage d'absence de données) » : la période
    demandée ne recouvre aucune mesure → traiter comme « pas de données », pas
    comme une erreur fatale.
  - 400 : station inexistante ou date de fin dans le futur.
  - Erreur 303001 : la passerelle suspend l'API 30 s si le backend est
    injoignable → backoff.
  - 429 : respecter le rate limit (~50 req/min sur le tier public ; réutiliser
    `src/lib/ratelimit.ts`).

### Colonnes CSV horaires utiles (fréquence horaire)

Le CSV « tous paramètres » contient notamment (à **vérifier sur le premier CSV
réel** et documenter dans le code — c'est le genre de commentaire utile) :

| Colonne | Signification | Unité source | Param canonique |
|---|---|---|---|
| `RR1` | précip. de l'heure | mm | `precipitation_mm` (déjà par pas → pas de différenciation, comme AROME PT1H) |
| `T` | température | °C | `temperature_c` |
| `FF` | vent moyen 10 min | m/s | `wind_speed_ms` |
| `FXI` (ou `FXY`) | rafale max | m/s | `wind_gust_ms` |
| `N` | nébulosité totale | **octas (0–8)** | `cloud_cover_pct` = N/8×100 ; valeur 9 = ciel invisible → ignorer |
| `U` | humidité | % | (non mappé aujourd'hui) |

- `cape_jkg` n'existe pas en observation → laisser absent (le champ est
  nullable ; `categorize()` gère l'absence — STORMY observé reposera sur les
  rafales uniquement, limitation acceptée).
- Valeurs manquantes = champ vide dans le CSV → omettre le param (ne pas mettre 0).
- Chaque valeur est accompagnée d'un code qualité (`Q<col>`) ; en première
  itération, accepter toutes les valeurs non vides (améliorable plus tard).
- Les heures du CSV sont en **UTC** — cohérent avec les `TimeRange` du projet
  (offsets minutes depuis minuit UTC) et avec `aggregate()`.

## 3. Étape A — connecteur observation DPClim

### A.1 Sélection de station par ville (une fois, persistée)

- Pour chaque ville (lat/lon déjà géocodés dans `town`) :
  1. Déterminer le département : via l'API adresse déjà utilisée par le
     géocodeur (`api-adresse.data.gouv.fr` renvoie `citycode` INSEE → 2 premiers
     chiffres), ou en réutilisant/étendant `src/geocoding/geocoder.ts`.
  2. `GET /liste-stations/horaire?id-departement=NN`, choisir la station
     **ouverte** (`posteOuvert: true`) la plus proche du centroïde (distance
     haversine), en préférant celles de type ≠ 5 (type 5 = non expertisée).
  3. Optionnel mais recommandé : valider via `/information-station` que
     précipitations + température y sont actives actuellement ; sinon prendre la
     suivante.
- **Persistance du mapping** : ajouter `stationId String?` + `stationMeta Json?`
  (nom, distance, lat/lon) sur `TownSource` dans `prisma/schema.prisma`
  (appliquer avec `npm run db:push`, ou `db:reset:seed` si besoin de repartir
  propre). Le lien ville↔station est propre au couple ville × source
  d'observation, d'où `TownSource` plutôt que `Town`.
- La résolution se fait lazily au premier fetch (comme `ensureGeocoded`) et est
  réutilisée ensuite.

### A.2 Connecteur `src/connectors/climatologie/`

Créer un module (miroir de la structure `arome/`) :

- `client.ts` : appels HTTP DPClim (via `src/lib/http.ts` + `ratelimit.ts`) :
  `listeStationsHoraire(dept)`, `informationStation(id)`,
  `commandeHoraire(id, debut, fin)`, `telechargerCommande(idCmde)` avec polling
  (attendre ~5 s, retenter sur 204, timeout ~60 s, backoff sur 429/303001).
- `csv.ts` : parse du CSV `;` → `ForecastSample[]` (une entrée par heure,
  `validTime` UTC, `params` canoniques selon le tableau §2). Pas de nouvelle
  dépendance nécessaire : un split `;` suffit (guillemets absents des CSV MF),
  sinon rester minimal.
- `connector.ts` : `ClimatologieObservationConnector implements ObservationConnector`
  (`src/connectors/types.ts`), `code = 'mf-climatologie'`.
  `fetchObservations(point, day, opts)` : résout la station (A.1), commande la
  journée `day` (00:00:00Z → 23:59:59Z), télécharge, parse, renvoie les samples.
  - Mutualiser : si plusieurs jours sont demandés pour une même station
    (backfill), une seule commande couvrant la plage est préférable → exposer
    aussi une méthode `fetchObservationsRange(point, from, to, opts)` et faire
    de `fetchObservations` un cas particulier.
- Enregistrer dans `buildDefaultRegistry()` (`src/connectors/registry.ts`).

### A.3 Intégration au `dailyRun`

Aujourd'hui `writeObservations` cible `runDate` (le jour même) — invalide pour
une archive non temps réel. Modifier `src/tasks/dailyRun.ts` :

- Les observations sont écrites pour **J-1 à J-N** (N = lookback configurable,
  défaut 3 : rattrape les trous si le batch a sauté un jour ou si l'archive
  était en retard). Pour chaque jour de ce lookback **manquant en base**
  (vérifier l'existence de lignes OBSERVATION pour (town, jour)), fetch + pour
  chaque `TimeRange` : `aggregate()` → `categorize()` → `upsertMeasurement`
  avec `kind: 'OBSERVATION'`, `targetDate = jour observé`,
  `referenceTime = début de fenêtre` (convention existante), `leadDays: 0`.
- Idempotent grâce à la clé naturelle : relancer le daily ré-upserte sans
  dupliquer.
- Garder la tolérance actuelle : échec observation ≠ échec du report forecast
  (log warn, on continue).

### A.4 Seed et source

Dans `src/cli/seed.ts` :
- Ajouter la source `{ code: 'mf-climatologie', name: 'Meteo-France Climatologie (stations)', kind: 'OBSERVATION', maxHorizonDays: 0 }`.
- Désactiver `observation-stub` (`active: false`) — conserver la ligne pour les
  mesures éventuelles déjà rattachées.
- `dailyRun` : passer `observationSourceCode` par défaut à `'mf-climatologie'`.

### A.5 Config (`src/config/env.ts`)

```
METEOFRANCE_CLIM_API_KEY   (optionnel, fallback METEOFRANCE_API_KEY)
METEOFRANCE_CLIM_BASE_URL  (défaut https://public-api.meteofrance.fr/public/DPClim/v1)
CLIM_MAX_REQ_PER_MIN       (défaut 45)
OBS_LOOKBACK_DAYS          (défaut 3)
```
Mettre à jour `.env.example`.

## 4. Étape B — backfill des observations (CLI)

`src/cli/backfillObs.ts` + script npm `backfill:obs` :

- Args : `--days 365` (ou `--from/--to`), `--town <nom>` optionnel.
- Pour chaque ville active : une commande `/commande-station/horaire` couvrant
  toute la plage (≤ 1 an, donc 365 j passe en une commande), parse, puis
  agrège/écrit jour par jour × time_range comme en A.3.
- Attention : sur une longue plage, la station choisie doit avoir des capteurs
  actifs sur toute la période (sinon 500 « plage d'absence de données ») →
  en cas de 500, retenter en découpant la plage, ou tronquer aux périodes
  d'activité renvoyées par `/information-station`.
- **Limite assumée** : on ne peut backfiller que les observations. Les
  prévisions n'existent que depuis la mise en route du projet, donc la fenêtre
  « 1 an » de fiabilité ne devient significative qu'avec l'accumulation des runs
  quotidiens. Le backfill sert surtout à ce que chaque forecast déjà en base ait
  son observation en face.

## 5. Étape C — service de fiabilité

### C.1 Métriques

Par groupe **(source forecast × ville × time_range × fenêtre)** — et une
variante agrégée toutes villes / toutes plages :

- `n` : nombre de paires forecast/observation appariées (via la vue
  `forecast_vs_observed`, en ne gardant que les lignes où l'observation existe).
- **Catégorie** : taux d'accord `forecast_category = observed_category` (+
  matrice de confusion au niveau global : lignes = catégorie prévue, colonnes =
  observée — répond à « fiabilité par catégorie »).
- **Précipitations** : accord `precip_level`, MAE et biais (moyenne de
  forecast − observed) sur `precipitation_mm`.
- **Température** : MAE + biais sur `temperature_c`.
- **Vent / rafales / nébulosité** : MAE + biais.
- Décliner par `lead_days` (J+0, J+1, J+2) : c'est la vraie mesure « la
  prévision à N jours est-elle fiable ? ».

Fenêtres : `target_date >= now - 7j / 30j / 365j` (sur `target_date`, pas
`run_date`).

### C.2 Implémentation

- `src/domain/reliability.ts` : types des stats + logique de calcul.
  Le calcul peut se faire en **une requête SQL groupée** sur la vue (rapide,
  volumes faibles : 4 villes × 4 plages × ~3 lead days × 365 j ≈ 17k lignes/an)
  via `prisma.$queryRaw`, groupée par (source_id, town_id, time_range_id,
  lead_days) avec `FILTER (WHERE ...)` par fenêtre — ou 3 requêtes, une par
  fenêtre. Pas de table de stats persistée : calcul à la demande (pré-prod,
  inutile de matérialiser).
- Adapter la vue si besoin : `forecast_vs_observed` joint aujourd'hui sans
  filtrer la source d'observation ; ajouter `o.source_id AS observed_source_id`
  à la vue (fichier `prisma/sql/forecast_vs_observed.sql`, idempotent,
  ré-appliqué par `db:reset`) pour pouvoir filtrer sur `mf-climatologie`.
- `src/cli/reliability.ts` + script npm `reliability` :
  - `npm run reliability` → tableau texte lisible par fenêtre : lignes =
    (ville, time_range, lead_days), colonnes = n, accord catégorie %, accord
    precip %, MAE temp, biais temp, MAE precip, MAE vent…
  - `--json` pour sortie machine ; `--window 7|30|365` pour filtrer ;
    `--town`, `--source` optionnels.
  - Afficher la matrice de confusion des catégories (globale par fenêtre).
- Ne pas surinterpréter les petits `n` : afficher `n` partout et ne rien
  masquer.

## 6. Tests (vitest, comme l'existant `test/`)

- `test/climCsv.test.ts` : parsing d'un extrait CSV horaire réel (fixture dans
  `test/fixtures/`) → `ForecastSample[]` (unités converties, heures UTC, valeurs
  vides omises, N=9 ignoré).
- `test/stationSelect.test.ts` : choix de la station la plus proche
  ouverte/expertisée à partir d'un JSON `liste-stations` en fixture.
- `test/reliability.test.ts` : métriques (accord, MAE, biais, confusion) sur un
  petit jeu de paires synthétiques.
- Le polling commande/fichier (202→204→201) peut être testé avec un client HTTP
  mocké.

## 7. Ordre d'implémentation suggéré

1. Config env + client DPClim + parsing CSV (+ fixtures/tests) — testable dès
   que la clé est souscrite.
2. Sélection de station + champ `stationId` sur `TownSource` (`db:push`).
3. Connecteur + registry + seed source + branchement dailyRun (J-1, lookback).
4. Backfill CLI.
5. Vue enrichie + module reliability + CLI.

## 8. Points de vigilance

- **Clé API** : souscrire « Données Climatologiques » sur
  portail-api.meteofrance.fr — la clé AROME actuelle donne 403 sur DPClim.
  (Testé le 2026-07-19 : 403 « Resource forbidden » avec la clé du `.env`.)
- **Unités** : vérifier `FF`/`FXI` (m/s) et `N` (octas) sur le premier CSV réel
  avant de figer `csv.ts` ; noter la conversion en commentaire (gotcha d'unité —
  autorisé par CLAUDE.md).
- Certaines stations ne mesurent pas la nébulosité → `cloud_cover_pct` null →
  la catégorie observée retombe sur CLEAR par défaut dans `categorize()`
  (`cloud ?? 0`). Si la station choisie n'a pas de capteur N, l'accord de
  catégorie sera biaisé : préférer une station avec N actif quand possible
  (check `/information-station` en A.1).
- Pas de migrations Prisma ; tout objet SQL non-Prisma reste dans `prisma/sql/`
  en `CREATE OR REPLACE`.
- Respecter le rate limit et le caractère asynchrone (pauses entre commande et
  téléchargement) ; en backfill, séquencer les villes.

## 9. Questions ouvertes (défauts retenus si pas de réponse)

1. **Fréquence source** : horaire retenu (nécessaire pour les 4 plages
   intra-journée). La quotidienne ne permettrait pas le découpage par
   time_range.
2. **Stockage des stats** : calcul à la demande (CLI), pas de table dédiée.
   Si un dashboard/API arrive plus tard, matérialiser à ce moment-là.
3. **Backfill par défaut** : 365 jours (une commande par station), lancé
   manuellement une fois.
4. **Codes qualité CSV** : ignorés en v1 (toutes valeurs non vides acceptées).
