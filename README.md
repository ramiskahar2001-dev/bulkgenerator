# RK Bulkfile Generator – Web-App mit Login

Der Amazon-Ads-Bulkfile-Generator als Webseite: Erst nach der Anmeldung wird der Generator ausgeliefert.
Keine externen Pakete nötig – nur **Node.js 18 oder neuer**.

## Starten

```bash
node server.js
```

Danach im Browser öffnen: <http://localhost:3000>

**Start-Zugang:** Benutzer `admin` · Passwort `bulkgenerator`
Beim ersten Login wirst du direkt gebeten, ein eigenes Passwort zu vergeben (mind. 10 Zeichen). Bitte mach das, bevor die Seite öffentlich erreichbar ist.

## Funktionen

- Anmeldeseite (Gold & Grau, RK-Branding)
- Generator nur mit gültiger Sitzung erreichbar (`/app`)
- Passwort ändern (`/konto`) – meldet andere Geräte automatisch ab
- Benutzerverwaltung für Admins (`/admin`): Nutzer anlegen und löschen
- Sitzungen laufen nach 8 Stunden ab
- Nach 5 Fehlversuchen wird die IP für 15 Minuten gesperrt
- Passwörter werden nur als scrypt-Hash gespeichert (`data/users.json`), nie im Klartext

## Einstellungen (Umgebungsvariablen)

| Variable | Bedeutung | Standard |
|---|---|---|
| `PORT` | Port des Servers | `3000` |
| `DATA_DIR` | Ordner für `users.json` | `./data` |
| `COOKIE_SECURE` | `1` setzen, sobald die Seite über **HTTPS** läuft | aus |
| `TRUST_PROXY` | `1` setzen, wenn ein Reverse-Proxy (z. B. Nginx, Render) davor sitzt | aus |
| `ADMIN_PASSWORD` | Anderes Start-Passwort für den Admin (nur beim allerersten Start) | `bulkgenerator` |

## Online stellen

Die App läuft überall, wo Node.js läuft, z. B.:

- **Eigener Server / VPS** mit Nginx davor (HTTPS über Let's Encrypt), Start z. B. mit `pm2 start server.js`
- **Render, Railway, Fly.io** o. ä.: Start-Befehl `node server.js`, `COOKIE_SECURE=1` und `TRUST_PROXY=1` setzen

Wichtig:
- Die Seite **nur über HTTPS** betreiben – sonst gehen Passwörter unverschlüsselt durchs Netz.
- Der Ordner `data/` muss **dauerhaft gespeichert** werden (bei Render/Railway: persistentes Volume als `DATA_DIR`), sonst sind angelegte Benutzer und geänderte Passwörter nach einem Neustart weg.
- Sitzungen liegen im Arbeitsspeicher: Nach einem Neustart des Servers müssen sich alle neu anmelden.

## Passwort vergessen?

Server stoppen, `data/users.json` löschen und neu starten – dann wird der Admin mit dem Start-Passwort neu angelegt (alle anderen Benutzer gehen dabei verloren).

## Dateien

```
server.js              Server, Login, Sitzungen, Benutzerverwaltung
public/generator.html  der Bulkfile Generator
data/users.json        Benutzer (wird beim ersten Start angelegt)
```
