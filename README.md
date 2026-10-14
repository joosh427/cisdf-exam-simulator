# CIS-DF Exam Simulator

Lekki symulator egzaminów certyfikacyjnych (pisany pod ServiceNow CIS-DF, ale działa z dowolnym zestawem pytań).
Node.js bez żadnych zależności i jedna strona HTML — bez `npm install`, bez bazy danych. Kod podzielony na warstwy, pokryty testami (`npm test`).

*A lightweight, dependency-free exam simulator (Node.js + single HTML page). Questions are plain Markdown files in LearnWise format.*

## Co potrafi

- **Arkusze** z katalogu `questions/` (każdy plik `.md` = jeden arkusz), licznik czasu pilnowany przez serwer, próg zaliczenia.
- **Dwa tryby** przy każdym arkuszu:
  - **Nauka** — zaznaczasz odpowiedź, klikasz **Zatwierdź** i od razu widzisz: zielone (dobrze), czerwone (źle), przerywana ramka (pominięta poprawna) + wyjaśnienie. Licznik ✓/✗, przycisk „↺ Od początku”.
  - **Egzamin** — jak na prawdziwym egzaminie, wynik dopiero na końcu.
- **Przegląd przed zakończeniem** — plansza wszystkich numerów pytań (dobrze / źle / z odpowiedzią / bez odpowiedzi / ★ oznaczone), klik przenosi do pytania.
- **Ocena jak na egzaminie** — pytanie wielokrotnego wyboru i matching liczą się tylko przy w pełni poprawnej odpowiedzi.
- Odpowiedzi zapisują się na serwerze na bieżąco (odświeżenie strony ani zmiana urządzenia niczego nie psują).
- **Po egzaminie**: przegląd z filtrem „tylko błędne”, historia podejść, czas i tempo (średnio na pytanie, „w tempie / za wolno”).
- **Moje błędy** i **powtórka błędów** (w trybie nauki albo egzaminu) z pytań, na które ostatnio odpowiedziałeś źle.
- Logowanie jednym hasłem (ciasteczko podpisane HMAC).

## Uruchomienie

Wymaga Node.js ≥ 18.

```bash
cp .env.example .env      # ustaw APP_PASSWORD i PORT
./start.sh                # start w tle; restart: ./start.sh, stop: ./start.sh stop
```

Albo bez skryptu: `APP_PASSWORD=haslo PORT=3000 npm start` i wejdź na `http://localhost:3000`.

Zmienne środowiskowe: `APP_PASSWORD` (wymagane), `PORT` (domyślnie 3000), `DURATION_MIN` (90), `PASS_PCT` (80), `QUESTIONS_DIR`, `DATA_DIR`.

Dane (historia, odpowiedzi) trzymane są w `data/db.json` — kopia zapasowa to skopiowanie tego pliku.

## Format pytań (LearnWise)

```
# exam: Nazwa arkusza
# description: Opis

Treść pytania (może mieć wiele linii, obrazki ![alt](img/plik.png))
+ poprawna odpowiedź
- błędna odpowiedź
> wyjaśnienie pokazywane po zatwierdzeniu / w przeglądzie

Dopasuj elementy
{"type": "matching"}
+ lewa strona == prawa strona
```

Więcej odpowiedzi z `+` = pytanie wielokrotnego wyboru. Obrazki wrzuć do `questions/img/`.
W repo jest tylko `questions/cis_df_przyklad.md` z kilkoma przykładowymi pytaniami — własne arkusze dodaj obok i zrestartuj serwer.

## Architektura

Kod jest podzielony na warstwy — każda zna tylko te pod sobą, a logika biznesowa nie wie nic o HTTP:

```
                ┌──────────────────────────────────────────────┐
 przeglądarka ─▶│ http.js   routing, JSON, pliki statyczne     │  warstwa HTTP
                ├──────────────────────┬───────────────────────┤
                │ auth.js  hasło,      │ attempts.js  podejścia│  logika
                │ ciasteczko HMAC      │ tryby, ocena, statyst.│
                ├──────────────────────┼───────────────────────┤
                │                      │ grading.js  czyste    │  reguły oceny
                │                      │ funkcje oceny         │
                ├──────────────────────┼───────────────────────┤
                │ store.js  db.json    │ questions.js  parser  │  dane
                └──────────────────────┴───────────────────────┘
   app.js składa warstwy w całość, server.js tylko uruchamia nasłuch
```

| Plik | Odpowiedzialność |
|---|---|
| `server.js` | punkt wejścia: konfiguracja → `createApp` → `listen` |
| `src/config.js` | zmienne środowiskowe i wartości domyślne |
| `src/app.js` | kompozycja zależności (łatwa podmiana w testach: katalogi, zegar) |
| `src/http.js` | trasy API (lista w komentarzu na górze pliku), zamiana `AppError` na kod HTTP |
| `src/auth.js` | logowanie jednym hasłem, sesja w podpisanym ciasteczku, opóźnienie po złym haśle |
| `src/attempts.js` | tworzenie podejść, odpowiedzi, Zatwierdź (nauka), reset, ocena, limit czasu, powtórka błędów, statystyki |
| `src/grading.js` | czy odpowiedź jest poprawna, feedback, pytanie bez klucza dla przeglądarki |
| `src/questions.js` | parser formatu LearnWise i wczytywanie arkuszy |
| `src/store.js` | baza w jednym pliku JSON z atomowym zapisem |
| `public/index.html` · `style.css` · `app.js` | interfejs (vanilla JS, bez frameworka) |

Każda funkcja ma komentarz JSDoc z opisem parametrów — edytor (VS Code) podpowiada typy bez TypeScriptu.

## Testy

```bash
npm test        # = node --test test/*.test.js   (wbudowany runner Node.js, zero zależności)
```

| Plik | Co sprawdza |
|---|---|
| `test/questions.test.js` | parser: konfiguracja, odpowiedzi, JSON, wielolinijkowa treść, typy pytań, klucz treści |
| `test/grading.test.js` | ocena single / multi / matching, feedback, brak klucza w danych dla przeglądarki |
| `test/attempts.test.js` | tryby nauka / egzamin, Zatwierdź i blokada zmiany, reset, limit czasu (sterowany zegar), powtórka błędów, statystyki |
| `test/http.test.js` | end-to-end: prawdziwy serwer na losowym porcie, logowanie, pełny przebieg podejścia, kody błędów |

Testy działają na tymczasowych katalogach — nie dotykają `data/` ani Twoich pytań.

## Struktura katalogów

```
server.js          punkt wejścia
src/               warstwy aplikacji (opis wyżej)
public/            interfejs: index.html, style.css, app.js
test/              testy node:test (+ helpers.js)
questions/         arkusze .md (+ img/)
start.sh           start/stop w tle
.env.example       przykładowa konfiguracja
package.json       skrypty npm start / npm test (bez zależności)
```
