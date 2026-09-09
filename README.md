# Koreacars Analyzer → mobile.de

Lokales Tool, das Fahrzeuge aus dem **koreacars.de-Katalog** lädt, daraus die **mobile.de-Schreibweise** (Marke / Modell / Motorisierung / Variante / Fahrzeugtyp / Kraftstoff / Jahr / km) ableitet, **vergleichbare Angebote auf mobile.de** sucht und **Wiederverkaufs-Margen** berechnet.

Zwei Oberflächen, eine gemeinsame Logik:

- **Web-App** unter `http://127.0.0.1:8787` (Suchformular mit allen Filtern, Tabellen, CSV-Export)
- **Telegram-Bot** (Auto-Details, Vergleiche, Margen, KI-Assistent)
- **Optional: lokales LLM** (Ollama) verbessert automatisch Modell-Zerlegung, Suchplan und Treffer-Qualität – sonst greifen eingebaute Regeln.

---

## Features

- Fahrzeug-Extraktion per **koreacars.de-Seite (Headless-Chrome)** + **Encar-API**: Titel, Erstzulassung, km, Motor/Kraftstoff, Getriebe, Antrieb, Farbe, FIN, Ausstattung, Preise (Korea/DE) und Historie (Vorbesitzer, Versicherungsfälle).
- **Zwischenfilter (KR → DE)**: koreanische Namen → deutsche mobile.de-Bezeichnungen (BMW 5-Series → 5er, Mercedes C클래스 → C-Klasse, „E63 AMG“ → Modell `E`, Motorisierung `63`, Variante `AMG` …).
- **mobile.de-Suche**:
  - Modell-/Markenlogik je Marke (BMW 1er–8er/X/i/M, Mercedes A–S/CLA/GLC/EQ/AMG, Audi A/Q/S/RS/e-tron, Hyundai/Kia/Genesis/VW …)
  - Feste Regeln: **EZ = Baujahr ± 1 Jahr** (wird nie automatisch erweitert), km-Fenster ~80 % bis +30.000 km (Anzeige in netten Stufen 10k/25k), Kraftstoff-/Typ-/Varianten-Filter
  - Bei 0 Treffern wird nur **km/Variante/Typ** gelockert (mit Hinweis) – das **Baujahr bleibt** erhalten
  - Laden mehrerer Ergebnisseiten (bis 6) bis genug Treffer im passenden Baujahr da sind
  - Falsche Baureihen (z. B. Coupé statt Gran Turismo) und falsche Motorcodes werden herausgefiltert
- **Margen-Analyse**: Spanne gegen den Koreacars-Endpreis DE (brutto/netto, +700-€-Hafenpauschale), Kern-Vergleichsfahrzeuge (⭐), CSV-Export, Link-Kopie.
- **Telegram-Bot**: `/auto`, `/details`, `/preis`, `/ausstattung`, `/historie`, `/vergleich` (mit Filtern), `/marge`, `/export`, `/autos`, `/ki` (Frage an das lokale LLM), Inline-Buttons.
- **Lokales LLM (optional)**: zerlegt Fahrzeugnamen in den Suchplan (Marke/Modell/Motorisierung/Varianten/Typ/Kraftstoff/Jahr/km + Suchbegriffe) und prüft Treffer gegen das Ziel-Fahrzeug.

---

## Voraussetzungen

| | |
|---|---|
| Node.js | ≥ 20 (getestet mit 24) |
| Chrome/Edge | für das Rendern der koreacars.de-Seite (Headless) |
| Telegram-Token | nur für den Bot: bei **@BotFather** holen |
| Ollama + Modell | **optional** (Empfehlung `qwen2.5:7b`) |

Abhängigkeiten installieren:

```bash
npm install
```

---

## Schnellstart Web-App

```bash
npm run web        # oder: .\run_web.ps1  /  node server.mjs
# öffne http://127.0.0.1:8787
```

- koreacars.de-ID oder -URL oben eingeben (z. B. `41838631`) → **Fahrzeug laden**
- Formularfelder (Marke, Modell, Variante, Motorisierung, Fahrzeugtyp, EZ, km) sind vorbelegt und editierbar
- **Vergleichsfahrzeuge auf mobile.de suchen** → Treffer prüfen → **Margen für Auswahl berechnen**

## Schnellstart Telegram-Bot

1. Token bei @BotFather holen und als Datei `bot_token.txt` ablegen (nur der Token, keine Leerzeile) oder als Umgebungsvariable setzen.
2. Starten:

```bash
npm run bot        # oder: .\run_bot.ps1  /  node bot.mjs
```

Wichtige Befehle:

```
/auto <ID>            Fahrzeug laden (oder einfach die ID schicken)
/vergleich            Suchplan anzeigen + Vergleich starten
/vergleich BMW, 5er; Variante: M Paket; Motor: Benzin; Typ: Limousine; Jahr: 2017-2019; km: 100k-150k
/marge                Margen-Analyse
/export               CSV
/ki <Frage>           KI-Assistent (lokales LLM, mit Fahrzeug-Kontext)
```

---

## Lokales LLM (Ollama)

```bash
# Ollama installieren (https://ollama.com), dann:
ollama pull qwen2.5:7b
ollama serve          # Port 11434
```

Danach nutzen Web & Bot das Modell automatisch:
- **Suchplan**: Das LLM liest die Fahrzeugdaten und erstellt Marke/Modell/Motorisierung/Varianten/Typ/Kraftstoff/Jahr/km + mobile.de-Suchbegriffe.
- **Treffer-Check**: Die KI prüft die gefundenen Inserate und verwirft grobe Fehlpassungen.

Steuerung:

```bash
LLM_DISABLE=1          # LLM ausschalten (reine Regeln)
LLM_MODEL=qwen2.5:7b   # anderes Ollama-Modell
```

Wenn Ollama nicht läuft, arbeitet das Tool ohne KI weiter.

---

## Umgebungsvariablen

| Variable | Bedeutung | Default |
|---|---|---|
| `PORT` | Web-Port | `8787` |
| `TELEGRAM_BOT_TOKEN` | Bot-Token (oder Datei `bot_token.txt`) | – |
| `LLM_DISABLE` | `1` deaktiviert das lokale LLM | `0` |
| `LLM_MODEL` | Ollama-Modellname | `qwen2.5:7b` |

---

## Daten & Cache

- Fahrzeug-Extraktionen werden unter `results/<ID>/` gecacht (mit Versionsnummer; alte Stände werden automatisch neu geladen).
- mobile.de-Seiten liegen im Cache unter `cache/`.
- Beides ist in `.gitignore` ausgenommen und **bleibt lokal**.

## Hinweise & Grenzen

- mobile.de blockiert direkte automatisierte Zugriffe (WAF/403). Die Suchergebnisseiten werden deshalb über einen **Render-Proxy** geholt (derselbe Inhalt, den Suchmaschinen sehen). Bitte die **Nutzungsbedingungen von mobile.de** beachten und das Tool nur in vernünftigem Umfang verwenden.
- Preise sind **Angebotspreise zum Abrufzeitpunkt** und ändern sich täglich.
- Die Treffer-Suche ist **keywordbasiert** (mobile.de-Filter-IDs sind von außen nicht erreichbar); die Modell-/Typ-/Varianten-Filter laufen clientseitig anhand der Inserattexte.
- Baujahr-Filter: ± 1 Jahr wird **streng** eingehalten; wird nichts gefunden, erscheint ein klarer Hinweis (Jahr kann manuell erweitert werden).
- Chrome muss für neue Fahrzeuge (Seiten-Render) installiert sein; bereits gecachte Autos kommen aus dem Cache.

## Testen

```bash
npm run check      # Syntax aller Module
npm run selftest   # Offline-Selbsttest des Bots (Formatierung/Hilfe)
```

## Projektstruktur

```
lib/          Logik: extract (koreacars/Encar), search (mobile.de), analyze (Margen),
              templates (KR→DE-Regeln), llm (Ollama-Anbindung)
public/       Web-Oberfläche (index.html, static/app.js, style.css)
server.mjs    Web-Server + API
bot.mjs       Telegram-Bot
mobilede_search.mjs  Render-Proxy-Fetcher + SRP-Parser
run_web.ps1 / run_bot.ps1   PowerShell-Starter
```

## Lizenz

MIT – siehe [LICENSE](LICENSE).
