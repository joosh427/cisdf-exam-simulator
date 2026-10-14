# CIS-DF Exam Simulator

Lekki symulator egzaminów certyfikacyjnych (pisany pod ServiceNow CIS-DF, ale działa z dowolnym zestawem pytań).
Jeden plik serwera w Node.js i jedna strona HTML — bez `npm install`, bez bazy danych.

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

Albo bez skryptu: `APP_PASSWORD=haslo PORT=3000 node server.js` i wejdź na `http://localhost:3000`.

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

## Struktura

```
server.js          serwer HTTP, parser pytań, ocena, API
public/index.html  cały interfejs (vanilla JS)
questions/         arkusze .md (+ img/)
start.sh           start/stop w tle
.env.example       przykładowa konfiguracja
```
